import * as THREE from "three";

import {
  defaultObjectId,
  minLoosePartTriangleCountToSeparate,
  separationProgressCheckInterval,
  collectSelectableMeshes,
  ensureVertexTopologyIds,
  getEdgeNormalAngle,
  getTriangleObjectIds,
  getVertexKey,
  getVertexPositionKey,
  type MeshTopology,
  type SeparationProgressReporter,
  type TriangleEdgeFace,
  type TriangleTopology,
  type TriangleVertex,
  type ObjectJoinPlan,
} from "./model-viewer-shared";
import {
  ensureMeshEditState,
  markMeshPartIdsChanged,
  rebuildMeshEditState,
  setEdgesCut,
} from "./mesh-edit-state";

export function colorTriangle(
  color: THREE.BufferAttribute,
  startIndex: number,
  triangleColor: THREE.Color,
) {
  color.setXYZ(startIndex, triangleColor.r, triangleColor.g, triangleColor.b);
  color.setXYZ(startIndex + 1, triangleColor.r, triangleColor.g, triangleColor.b);
  color.setXYZ(startIndex + 2, triangleColor.r, triangleColor.g, triangleColor.b);
}

export function getTriangleVertices(position: THREE.BufferAttribute, startIndex: number) {
  if (startIndex < 0 || startIndex + 2 >= position.count) {
    return null;
  }

  return [startIndex, startIndex + 1, startIndex + 2].map((index) => ({
    key: getVertexKey(position, index),
    point: new THREE.Vector3().fromBufferAttribute(position, index),
  }));
}

export function getTriangleNormal(vertices: TriangleVertex[]) {
  return new THREE.Vector3()
    .subVectors(vertices[1].point, vertices[0].point)
    .cross(new THREE.Vector3().subVectors(vertices[2].point, vertices[0].point));
}

export function getTriangleEdgeKeys(vertices: TriangleVertex[]) {
  return [
    [0, 1],
    [1, 2],
    [2, 0],
  ].map(([start, end]) => [vertices[start].key, vertices[end].key].sort().join("|"));
}

export function getTriangleEdgeFace(vertices: TriangleVertex[], edgeKey: string) {
  const normal = getTriangleNormal(vertices).normalize();

  if (normal.lengthSq() === 0) {
    return null;
  }

  const edgeIndexes = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];

  for (const [startIndex, endIndex] of edgeIndexes) {
    const start = vertices[startIndex];
    const end = vertices[endIndex];

    if ([start.key, end.key].sort().join("|") !== edgeKey) {
      continue;
    }

    return {
      direction: end.point.clone().sub(start.point).normalize(),
      normal,
    };
  }

  return null;
}

export function buildMeshTopology(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");
  const editState = ensureMeshEditState(mesh);

  if (!(position instanceof THREE.BufferAttribute) || !editState) {
    return null;
  }

  const edgeToTriangles = new Map<string, number[]>();
  const triangles: TriangleTopology[] = [];

  editState.faces.forEach((face, triangleIndex) => {
    const vertices = getTriangleVertices(position, triangleIndex * 3);

    if (!vertices) {
      return;
    }

    const edgeKeys = [...face.edgeKeys];

    triangles.push({ edgeKeys, vertices });
    edgeKeys.forEach((edgeKey) => {
      const edgeTriangles = edgeToTriangles.get(edgeKey);

      if (edgeTriangles) {
        edgeTriangles.push(triangleIndex);
      } else {
        edgeToTriangles.set(edgeKey, [triangleIndex]);
      }
    });
  });

  const topology: MeshTopology = {
    edgeCut: editState.edgeCut,
    edgeIdByKey: editState.edgeIdByKey,
    edgeNormalAngles: new Float32Array(editState.edges.map((edge) => edge.normalAngle)),
    edgeToTriangles,
    mesh,
    position,
    triangles,
  };

  return topology;
}

export function getTopologyEdgeNormalAngle(
  topology: MeshTopology,
  edgeKey: string,
  objectIds: Uint32Array | null = null,
  objectId = defaultObjectId,
) {
  const edgeId = topology.edgeIdByKey?.get(edgeKey);
  const edgeNormalAngles = topology.edgeNormalAngles;
  const edgeTriangleIndexes = topology.edgeToTriangles.get(edgeKey) ?? [];
  const canUseCachedAngle =
    edgeId != null &&
    edgeNormalAngles != null &&
    (!objectIds ||
      edgeTriangleIndexes.every(
        (edgeTriangleIndex) => (objectIds[edgeTriangleIndex] ?? defaultObjectId) === objectId,
      ));

  if (canUseCachedAngle && edgeId != null && edgeNormalAngles != null) {
    return edgeNormalAngles[edgeId] ?? 90;
  }

  const faces =
    edgeTriangleIndexes
      .map((edgeTriangleIndex) => {
        if (objectIds && objectIds[edgeTriangleIndex] !== objectId) {
          return null;
        }

        return getTriangleEdgeFace(topology.triangles[edgeTriangleIndex].vertices, edgeKey);
      })
      .filter((face): face is TriangleEdgeFace => face !== null) ?? [];

  return getEdgeNormalAngle(faces);
}

async function getObjectConnectedComponentsAsync(
  topology: MeshTopology,
  objectIds: Uint32Array,
  objectId: number,
  onProgress: SeparationProgressReporter,
) {
  const unvisitedTriangleIndexes = new Set<number>();
  const components: number[][] = [];

  for (let triangleIndex = 0; triangleIndex < objectIds.length; triangleIndex += 1) {
    if (objectIds[triangleIndex] === objectId && topology.triangles[triangleIndex]) {
      unvisitedTriangleIndexes.add(triangleIndex);
    }

    if (triangleIndex > 0 && triangleIndex % separationProgressCheckInterval === 0) {
      await onProgress(`Scanning object ${objectId}: ${triangleIndex}/${objectIds.length}`);
    }
  }

  const totalTriangles = unvisitedTriangleIndexes.size;
  let visitedTriangles = 0;

  while (unvisitedTriangleIndexes.size > 0) {
    const startTriangleIndex = unvisitedTriangleIndexes.values().next().value as number | undefined;

    if (startTriangleIndex == null) {
      break;
    }

    const component: number[] = [];
    const stack = [startTriangleIndex];

    unvisitedTriangleIndexes.delete(startTriangleIndex);

    for (let stackIndex = 0; stackIndex < stack.length; stackIndex += 1) {
      const triangleIndex = stack[stackIndex];
      const triangle = topology.triangles[triangleIndex];

      if (!triangle) {
        continue;
      }

      component.push(triangleIndex);
      visitedTriangles += 1;

      triangle.edgeKeys.forEach((edgeKey) => {
        const edgeId = topology.edgeIdByKey?.get(edgeKey);

        if (edgeId != null && topology.edgeCut?.[edgeId] === 1) {
          return;
        }

        topology.edgeToTriangles.get(edgeKey)?.forEach((edgeTriangleIndex) => {
          if (
            edgeTriangleIndex === triangleIndex ||
            objectIds[edgeTriangleIndex] !== objectId ||
            !unvisitedTriangleIndexes.has(edgeTriangleIndex)
          ) {
            return;
          }

          unvisitedTriangleIndexes.delete(edgeTriangleIndex);
          stack.push(edgeTriangleIndex);
        });
      });

      if (visitedTriangles % separationProgressCheckInterval === 0) {
        await onProgress(`Scanning object ${objectId}: ${visitedTriangles}/${totalTriangles}`);
      }
    }

    components.push(component);
  }

  return components;
}

export async function separateLooseObjectPartsAsync(
  topology: MeshTopology,
  objectIds: Uint32Array,
  objectIdsToScan: number[],
  getNextObjectId: () => number,
  onProgress: SeparationProgressReporter,
) {
  let changed = false;

  for (const objectId of new Set(objectIdsToScan)) {
    await onProgress(`Finding loose parts in object ${objectId}`);

    const components = await getObjectConnectedComponentsAsync(
      topology,
      objectIds,
      objectId,
      onProgress,
    );

    if (components.length <= 1) {
      continue;
    }

    const looseComponents = components
      .sort((first, second) => second.length - first.length)
      .slice(1);

    for (let componentIndex = 0; componentIndex < looseComponents.length; componentIndex += 1) {
      const component = looseComponents[componentIndex];

      if (component.length < minLoosePartTriangleCountToSeparate) {
        continue;
      }

      const nextObjectId = getNextObjectId();

      for (let index = 0; index < component.length; index += 1) {
        objectIds[component[index]] = nextObjectId;
        changed = true;

        if (index > 0 && index % separationProgressCheckInterval === 0) {
          await onProgress(
            `Separating loose part ${componentIndex + 1}/${looseComponents.length}: ${index}/${component.length}`,
          );
        }
      }
    }
  }

  if (changed) {
    markMeshPartIdsChanged(topology.mesh);
  }
}

export function addObjectJoinAdjacency(
  adjacency: Map<number, Set<number>>,
  firstObjectId: number,
  secondObjectId: number,
) {
  adjacency.get(firstObjectId)?.add(secondObjectId);
  adjacency.get(secondObjectId)?.add(firstObjectId);
}

export function getPositionEdgeKey(
  position: THREE.BufferAttribute,
  firstIndex: number,
  secondIndex: number,
) {
  return [getVertexPositionKey(position, firstIndex), getVertexPositionKey(position, secondIndex)]
    .sort()
    .join("|");
}

export function createSelectedObjectJoinPlan(
  modelRoot: THREE.Object3D,
  selectedObjectIds: Set<number>,
  primaryObjectId: number | null,
): ObjectJoinPlan | null {
  if (selectedObjectIds.size < 2) {
    return null;
  }

  const selectedIds = Array.from(selectedObjectIds);
  const adjacency = new Map<number, Set<number>>();

  selectedIds.forEach((objectId) => adjacency.set(objectId, new Set()));

  collectSelectableMeshes(modelRoot).forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const objectIds = getTriangleObjectIds(mesh);

    if (!(position instanceof THREE.BufferAttribute) || !objectIds) {
      return;
    }

    const objectIdsByPositionEdgeKey = new Map<string, Set<number>>();

    for (let startIndex = 0; startIndex < position.count; startIndex += 3) {
      const triangleIndex = startIndex / 3;
      const objectId = objectIds[triangleIndex] ?? defaultObjectId;

      if (!selectedObjectIds.has(objectId)) {
        continue;
      }

      [
        [startIndex, startIndex + 1],
        [startIndex + 1, startIndex + 2],
        [startIndex + 2, startIndex],
      ].forEach(([firstIndex, secondIndex]) => {
        const edgeKey = getPositionEdgeKey(position, firstIndex, secondIndex);
        let edgeObjectIds = objectIdsByPositionEdgeKey.get(edgeKey);

        if (!edgeObjectIds) {
          edgeObjectIds = new Set();
          objectIdsByPositionEdgeKey.set(edgeKey, edgeObjectIds);
        }

        edgeObjectIds.add(objectId);
      });
    }

    objectIdsByPositionEdgeKey.forEach((edgeObjectIds) => {
      const edgeIds = Array.from(edgeObjectIds);

      for (let firstIndex = 0; firstIndex < edgeIds.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < edgeIds.length; secondIndex += 1) {
          addObjectJoinAdjacency(adjacency, edgeIds[firstIndex], edgeIds[secondIndex]);
        }
      }
    });
  });

  const remainingObjectIds = new Set(selectedIds);
  const objectIdToTargetId = new Map<number, number>();
  const targetObjectIds = new Set<number>();

  selectedIds.forEach((objectId) => {
    if (!remainingObjectIds.has(objectId)) {
      return;
    }

    const component: number[] = [];
    const stack = [objectId];

    remainingObjectIds.delete(objectId);

    for (let stackIndex = 0; stackIndex < stack.length; stackIndex += 1) {
      const stackObjectId = stack[stackIndex];

      component.push(stackObjectId);
      adjacency.get(stackObjectId)?.forEach((adjacentObjectId) => {
        if (!remainingObjectIds.has(adjacentObjectId)) {
          return;
        }

        remainingObjectIds.delete(adjacentObjectId);
        stack.push(adjacentObjectId);
      });
    }

    if (component.length < 2) {
      return;
    }

    const targetObjectId =
      primaryObjectId != null && component.includes(primaryObjectId)
        ? primaryObjectId
        : (selectedIds.find((selectedId) => component.includes(selectedId)) ?? component[0]);

    targetObjectIds.add(targetObjectId);
    component.forEach((componentObjectId) => {
      if (componentObjectId !== targetObjectId) {
        objectIdToTargetId.set(componentObjectId, targetObjectId);
      }
    });
  });

  return objectIdToTargetId.size > 0 ? { objectIdToTargetId, targetObjectIds } : null;
}

export function applySelectedObjectJoinPlan(modelRoot: THREE.Object3D, plan: ObjectJoinPlan) {
  let changed = false;

  collectSelectableMeshes(modelRoot).forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const objectIds = getTriangleObjectIds(mesh);

    if (!(position instanceof THREE.BufferAttribute) || !objectIds) {
      return;
    }

    const edgeRefsByPositionEdgeKey = new Map<
      string,
      { objectId: number; vertexIndexes: [number, number] }[]
    >();

    for (let startIndex = 0; startIndex < position.count; startIndex += 3) {
      const triangleIndex = startIndex / 3;
      const objectId = objectIds[triangleIndex] ?? defaultObjectId;
      const targetObjectId = plan.objectIdToTargetId.get(objectId) ?? objectId;

      if (!plan.targetObjectIds.has(targetObjectId)) {
        continue;
      }

      [
        [startIndex, startIndex + 1],
        [startIndex + 1, startIndex + 2],
        [startIndex + 2, startIndex],
      ].forEach(([firstIndex, secondIndex]) => {
        const edgeKey = getPositionEdgeKey(position, firstIndex, secondIndex);
        let edgeRefs = edgeRefsByPositionEdgeKey.get(edgeKey);

        if (!edgeRefs) {
          edgeRefs = [];
          edgeRefsByPositionEdgeKey.set(edgeKey, edgeRefs);
        }

        edgeRefs.push({ objectId, vertexIndexes: [firstIndex, secondIndex] });
      });
    }

    const seamPositionEdgeKeys = new Set<string>();
    const seamVertexIndexes = new Set<number>();

    edgeRefsByPositionEdgeKey.forEach((edgeRefs, positionEdgeKey) => {
      const originalObjectIds = new Set(edgeRefs.map((edgeRef) => edgeRef.objectId));
      const targetObjectIds = new Set(
        edgeRefs.map(
          (edgeRef) => plan.objectIdToTargetId.get(edgeRef.objectId) ?? edgeRef.objectId,
        ),
      );

      if (originalObjectIds.size < 2 || targetObjectIds.size !== 1) {
        return;
      }

      seamPositionEdgeKeys.add(positionEdgeKey);
      edgeRefs.forEach((edgeRef) => {
        seamVertexIndexes.add(edgeRef.vertexIndexes[0]);
        seamVertexIndexes.add(edgeRef.vertexIndexes[1]);
      });
    });

    let meshChanged = false;

    for (let triangleIndex = 0; triangleIndex < objectIds.length; triangleIndex += 1) {
      const targetObjectId = plan.objectIdToTargetId.get(objectIds[triangleIndex]);

      if (targetObjectId == null) {
        continue;
      }

      objectIds[triangleIndex] = targetObjectId;
      meshChanged = true;
    }

    if (seamVertexIndexes.size > 0) {
      const topologyIds = ensureVertexTopologyIds(position);

      seamVertexIndexes.forEach((vertexIndex) => {
        if (topologyIds[vertexIndex] === 0) {
          return;
        }

        topologyIds[vertexIndex] = 0;
        meshChanged = true;
      });

      if (meshChanged) {
        rebuildMeshEditState(mesh);
      }
    }

    if (seamPositionEdgeKeys.size > 0) {
      const editState = ensureMeshEditState(mesh);
      const seamEdgeIds =
        editState?.edges
          .filter((edge) => seamPositionEdgeKeys.has(edge.positionEdgeKey))
          .map((edge) => edge.id) ?? [];

      if (setEdgesCut(mesh, seamEdgeIds, false)) {
        meshChanged = true;
      }
    }

    if (!meshChanged) {
      return;
    }

    markMeshPartIdsChanged(mesh);
    changed = true;
  });

  return changed;
}
