import * as THREE from "three";

import {
  defaultObjectId,
  exportMergeDistance,
  collectSelectableMeshes,
  getSeparatedObjectColor,
  getSeparatedObjectLabel,
  getTriangleObjectIds,
  type LooseEdgeLoop,
  type ExportObjectGeometry,
  type LooseEdgeLoopCapState,
  type ObjectNameMap,
} from "./model-viewer-shared";
import {
  editorGeneratedLoopMaterialPrefix,
  editorGeneratedLoopMeshKey,
  editorGlbMetadataKey,
  editorGlbMetadataVersion,
  type EditorGlbLoopCapState,
  type EditorGlbMetadata,
  type EditorGlbMeshState,
} from "./editor-metadata";
import { createLooseEdgeGeometry, getLooseEdgePositionEdgeKey } from "./loose-edge-geometry";
import { getLooseEdgeLoopCacheKey } from "./loose-edge-loops";

type ExportedBaseMesh = {
  mesh: THREE.Mesh;
  objectId: number;
};

type ExportedLoopReference = {
  loop: LooseEdgeLoop;
  meshIndex: number;
};

export function getSafeExportName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Object";
}

export function getBlenderExportFileName(sourceName: string) {
  const baseName = sourceName.replace(/\.[^/.]+$/, "");

  return `${getSafeExportName(baseName || "model")}-blender.glb`;
}

export function getThreeMfExportFileName(sourceName: string) {
  const baseName = sourceName.replace(/\.[^/.]+$/, "");

  return `${getSafeExportName(baseName || "model")}.3mf`;
}

export function createExportMaterial(name: string, color: THREE.Color) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    name,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
}

export function getExportObjectGeometry(
  exportObjects: Map<number, ExportObjectGeometry>,
  objectId: number,
) {
  let objectGeometry = exportObjects.get(objectId);

  if (!objectGeometry) {
    objectGeometry = { basePositions: [], generatedGroups: [] };
    exportObjects.set(objectId, objectGeometry);
  }

  return objectGeometry;
}

export function appendExportGeometryPositions(
  positions: number[],
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const point = new THREE.Vector3();

  if (!(position instanceof THREE.BufferAttribute)) {
    return;
  }

  if (index) {
    for (let itemIndex = 0; itemIndex < index.count; itemIndex += 1) {
      point.fromBufferAttribute(position, index.getX(itemIndex)).applyMatrix4(matrixWorld);
      positions.push(point.x, point.y, point.z);
    }

    return;
  }

  for (let itemIndex = 0; itemIndex < position.count; itemIndex += 1) {
    point.fromBufferAttribute(position, itemIndex).applyMatrix4(matrixWorld);
    positions.push(point.x, point.y, point.z);
  }
}

export function addBaseObjectGeometryToExportObjects(
  exportObjects: Map<number, ExportObjectGeometry>,
  modelRoot: THREE.Object3D,
) {
  const point = new THREE.Vector3();

  modelRoot.updateMatrixWorld(true);

  collectSelectableMeshes(modelRoot).forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const objectIds = getTriangleObjectIds(mesh);

    if (!(position instanceof THREE.BufferAttribute)) {
      return;
    }

    mesh.updateMatrixWorld(true);

    for (let index = 0; index < position.count; index += 3) {
      const triangleIndex = index / 3;
      const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;
      const positions = getExportObjectGeometry(exportObjects, objectId).basePositions;

      for (let offset = 0; offset < 3; offset += 1) {
        point.fromBufferAttribute(position, index + offset).applyMatrix4(mesh.matrixWorld);
        positions.push(point.x, point.y, point.z);
      }
    }
  });
}

export function addGeneratedLoopGeometryToExportObjects(
  exportObjects: Map<number, ExportObjectGeometry>,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
  objectNames: ObjectNameMap,
) {
  const generatedGroupCountByObjectId = new Map<number, number>();

  loopCapStates.forEach((state) => {
    const fill = state.fill;

    if (!fill || state.mode === "none") {
      return;
    }

    const positions: number[] = [];

    fill.updateMatrixWorld(true);
    appendExportGeometryPositions(positions, fill.geometry, fill.matrixWorld);

    if (positions.length < 9) {
      return;
    }

    const groupNumber = (generatedGroupCountByObjectId.get(state.objectId) ?? 0) + 1;

    generatedGroupCountByObjectId.set(state.objectId, groupNumber);
    getExportObjectGeometry(exportObjects, state.objectId).generatedGroups.push({
      isGeneratedLoop: true,
      materialName: getSafeExportName(
        `${getSeparatedObjectLabel(state.objectId, objectNames)} ${state.mode} ${groupNumber}`,
      ),
      positions,
    });
  });
}

export function getExportMergeVertexKey(x: number, y: number, z: number) {
  const scale = 1 / exportMergeDistance;

  return `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
}

export function createMergedExportMesh(
  objectId: number,
  objectGeometry: ExportObjectGeometry,
  objectNames: ObjectNameMap,
) {
  const geometry = new THREE.BufferGeometry();
  const materials: THREE.Material[] = [];
  const vertexIndexByKey = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const objectName = getSafeExportName(getSeparatedObjectLabel(objectId, objectNames));
  const objectColor = getSeparatedObjectColor(objectId);

  const getMergedVertexIndex = (x: number, y: number, z: number) => {
    const key = getExportMergeVertexKey(x, y, z);
    const existingIndex = vertexIndexByKey.get(key);

    if (existingIndex !== undefined) {
      return existingIndex;
    }

    const vertexIndex = positions.length / 3;

    vertexIndexByKey.set(key, vertexIndex);
    positions.push(x, y, z);

    return vertexIndex;
  };

  const addGroup = (groupPositions: number[], materialName: string, isGeneratedLoop = false) => {
    if (groupPositions.length < 9) {
      return;
    }

    const start = indices.length;

    for (let index = 0; index + 8 < groupPositions.length; index += 9) {
      const firstIndex = getMergedVertexIndex(
        groupPositions[index],
        groupPositions[index + 1],
        groupPositions[index + 2],
      );
      const secondIndex = getMergedVertexIndex(
        groupPositions[index + 3],
        groupPositions[index + 4],
        groupPositions[index + 5],
      );
      const thirdIndex = getMergedVertexIndex(
        groupPositions[index + 6],
        groupPositions[index + 7],
        groupPositions[index + 8],
      );

      if (firstIndex === secondIndex || secondIndex === thirdIndex || thirdIndex === firstIndex) {
        continue;
      }

      indices.push(firstIndex, secondIndex, thirdIndex);
    }

    const count = indices.length - start;

    if (count === 0) {
      return;
    }

    geometry.addGroup(start, count, materials.length);

    const material = createExportMaterial(
      isGeneratedLoop ? `${editorGeneratedLoopMaterialPrefix}${materialName}` : materialName,
      objectColor,
    );

    if (isGeneratedLoop) {
      material.userData[editorGeneratedLoopMeshKey] = true;
    }

    materials.push(material);
  };

  addGroup(objectGeometry.basePositions, `${objectName} faces`);
  objectGeometry.generatedGroups.forEach((group) => {
    addGroup(group.positions, group.materialName, group.isGeneratedLoop === true);
  });

  if (indices.length === 0 || positions.length === 0) {
    return null;
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);

  mesh.name = objectName;
  mesh.userData.modelPlaygroundObjectId = objectId;

  return mesh;
}

export function addMergedObjectMeshesToExportScene(
  scene: THREE.Scene,
  modelRoot: THREE.Object3D,
  objectNames: ObjectNameMap,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  const exportObjects = new Map<number, ExportObjectGeometry>();
  const baseMeshes: ExportedBaseMesh[] = [];

  addBaseObjectGeometryToExportObjects(exportObjects, modelRoot);
  addGeneratedLoopGeometryToExportObjects(exportObjects, loopCapStates, objectNames);

  Array.from(exportObjects.entries())
    .sort(([firstObjectId], [secondObjectId]) => firstObjectId - secondObjectId)
    .forEach(([objectId, objectGeometry]) => {
      const mesh = createMergedExportMesh(objectId, objectGeometry, objectNames);

      if (mesh) {
        scene.add(mesh);
        baseMeshes.push({ mesh, objectId });
      }
    });

  return baseMeshes;
}

function getLoopWorldPairKey(mesh: THREE.Mesh, loop: LooseEdgeLoop) {
  const edgeKeys: string[] = [];
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();

  mesh.updateMatrixWorld(true);

  for (let index = 0; index + 5 < loop.positions.length; index += 6) {
    start
      .set(loop.positions[index], loop.positions[index + 1], loop.positions[index + 2])
      .applyMatrix4(mesh.matrixWorld);
    end
      .set(loop.positions[index + 3], loop.positions[index + 4], loop.positions[index + 5])
      .applyMatrix4(mesh.matrixWorld);
    edgeKeys.push(getLooseEdgePositionEdgeKey(start, end));
  }

  return edgeKeys.sort().join("~");
}

function getLoopCapSourceLoop(
  sourceMeshes: THREE.Mesh[],
  key: string,
  state: LooseEdgeLoopCapState,
) {
  const sourceMesh = sourceMeshes.find((mesh) => mesh.uuid === state.sourceMeshUuid);
  const loopsById = sourceMesh?.userData.looseEdgeLoopById as
    | Map<number, LooseEdgeLoop>
    | undefined;

  if (!sourceMesh || !(loopsById instanceof Map)) {
    return null;
  }

  for (const loop of loopsById.values()) {
    if (getLooseEdgeLoopCacheKey(sourceMesh, loop) === key) {
      return { loop, mesh: sourceMesh };
    }
  }

  return null;
}

function buildExportedLoopReferences(baseMeshes: ExportedBaseMesh[]) {
  const references = new Map<string, ExportedLoopReference>();

  baseMeshes.forEach(({ mesh, objectId }, meshIndex) => {
    const sourcePosition = mesh.geometry.getAttribute("position");
    const sourceIndex = mesh.geometry.getIndex();
    const baseGroup = mesh.geometry.groups[0];
    const positions: number[] = [];
    const point = new THREE.Vector3();

    if (!(sourcePosition instanceof THREE.BufferAttribute) || !baseGroup) {
      return;
    }

    if (sourceIndex) {
      const end = Math.min(baseGroup.start + baseGroup.count, sourceIndex.count);

      for (let itemIndex = baseGroup.start; itemIndex + 2 < end; itemIndex += 3) {
        for (let offset = 0; offset < 3; offset += 1) {
          point.fromBufferAttribute(sourcePosition, sourceIndex.getX(itemIndex + offset));
          positions.push(point.x, point.y, point.z);
        }
      }
    } else {
      const end = Math.min(baseGroup.start + baseGroup.count, sourcePosition.count);

      for (let vertexIndex = baseGroup.start; vertexIndex + 2 < end; vertexIndex += 3) {
        for (let offset = 0; offset < 3; offset += 1) {
          point.fromBufferAttribute(sourcePosition, vertexIndex + offset);
          positions.push(point.x, point.y, point.z);
        }
      }
    }

    if (positions.length < 9) {
      return;
    }

    const referenceGeometry = new THREE.BufferGeometry();

    referenceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    referenceGeometry.userData.triangleObjectIds = new Uint32Array(positions.length / 9);
    referenceGeometry.userData.triangleObjectIds.fill(objectId);

    const referenceMesh = new THREE.Mesh(referenceGeometry);

    const looseEdgeGeometry = createLooseEdgeGeometry(referenceMesh, new Set<number>(), null);
    const loopsById = referenceMesh.userData.looseEdgeLoopById as
      | Map<number, LooseEdgeLoop>
      | undefined;

    looseEdgeGeometry.dispose();

    if (!(loopsById instanceof Map)) {
      referenceGeometry.dispose();
      return;
    }

    loopsById.forEach((loop) => {
      references.set(`${loop.objectId}:${loop.pairKey}`, { loop, meshIndex });
    });

    referenceGeometry.dispose();
  });

  return references;
}

function getEditorNormalTarget(
  sourceMesh: THREE.Mesh,
  normalTarget: THREE.Vector3 | null,
): [number, number, number] | null {
  if (!normalTarget) {
    return null;
  }

  const target = normalTarget.clone();

  sourceMesh.updateMatrixWorld(true);
  target.applyMatrix4(sourceMesh.matrixWorld);

  return [target.x, target.y, target.z];
}

function createEditorLoopCapStates(
  modelRoot: THREE.Object3D,
  baseMeshes: ExportedBaseMesh[],
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  const sourceMeshes = collectSelectableMeshes(modelRoot);
  const exportedLoops = buildExportedLoopReferences(baseMeshes);
  const metadataStates: EditorGlbLoopCapState[] = [];

  loopCapStates.forEach((state, key) => {
    if (state.mode === "none") {
      return;
    }

    const source = getLoopCapSourceLoop(sourceMeshes, key, state);

    if (!source) {
      return;
    }

    const exportedLoop = exportedLoops.get(
      `${state.objectId}:${getLoopWorldPairKey(source.mesh, source.loop)}`,
    );

    if (!exportedLoop) {
      return;
    }

    metadataStates.push({
      cone: state.cone,
      meshIndex: exportedLoop.meshIndex,
      mode: state.mode,
      normalAxisTarget: getEditorNormalTarget(source.mesh, state.normalAxisTarget),
      normalTarget: getEditorNormalTarget(source.mesh, state.normalTarget),
      objectId: state.objectId,
      offset: state.offset,
      segmentKeys: [...exportedLoop.loop.segmentKeys].sort(),
    });
  });

  return metadataStates;
}

export function createEditorGlbMetadata(
  modelRoot: THREE.Object3D,
  baseMeshes: ExportedBaseMesh[],
  hiddenObjectIds: Set<number>,
  objectNames: ObjectNameMap,
  nextObjectId: number,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
): EditorGlbMetadata {
  const meshes: EditorGlbMeshState[] = baseMeshes.map(({ objectId }, meshIndex) => ({
    meshIndex,
    objectId,
  }));

  return {
    hiddenObjectIds: Array.from(hiddenObjectIds).sort((first, second) => first - second),
    loopCapStates: createEditorLoopCapStates(modelRoot, baseMeshes, loopCapStates),
    meshes,
    nextObjectId,
    objectNames: Object.fromEntries(
      Object.entries(objectNames).map(([objectId, name]) => [String(objectId), name]),
    ),
    version: editorGlbMetadataVersion,
  };
}

export function createBlenderExportScene(
  modelRoot: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  objectNames: ObjectNameMap,
  nextObjectId: number,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  const scene = new THREE.Scene();

  scene.name = "Blender GLB export";
  const baseMeshes = addMergedObjectMeshesToExportScene(
    scene,
    modelRoot,
    objectNames,
    loopCapStates,
  );

  scene.userData[editorGlbMetadataKey] = createEditorGlbMetadata(
    modelRoot,
    baseMeshes,
    hiddenObjectIds,
    objectNames,
    nextObjectId,
    loopCapStates,
  );

  return scene;
}

export function downloadArrayBuffer(data: ArrayBuffer, fileName: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
