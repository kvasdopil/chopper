import * as THREE from "three";

import {
  defaultObjectId,
  getEdgeNormalAngle,
  getTriangleObjectIds,
  getVertexKey,
  getVertexPositionKey,
  refreshTriangleObjectIdAttribute,
  type TriangleEdgeFace,
} from "./model-viewer-shared";

export type MeshEditFace = {
  bounds: THREE.Box3;
  edgeIds: [number, number, number];
  edgeKeys: [string, string, string];
  normal: THREE.Vector3;
};

export type MeshEditEdge = {
  faceIds: number[];
  id: number;
  key: string;
  normalAngle: number;
  positionEdgeKey: string;
  vertexIndexes: [number, number];
  vertexKeys: [string, string];
};

export type MeshEditPartMetadata = {
  bounds: THREE.Box3;
  id: number;
  triangleCount: number;
};

export type MeshEditState = {
  edgeCut: Uint8Array;
  edgeIdByKey: Map<string, number>;
  edgeLoopId: Uint16Array | Uint32Array;
  edges: MeshEditEdge[];
  facePartId: Uint32Array;
  faces: MeshEditFace[];
  indexVersion: number;
  mesh: THREE.Mesh;
  partMetadata: Map<number, MeshEditPartMetadata>;
  partVersion: number;
  position: THREE.BufferAttribute;
};

export type MeshPartAssignmentInverse = {
  faceIds: Uint32Array;
  mesh: THREE.Mesh;
  partIds: Uint32Array;
  type: "assignFacesToPart";
};

export type MeshEdgeCutInverse = {
  cutValues: Uint8Array;
  edgeIds: Uint32Array;
  mesh: THREE.Mesh;
  type: "setEdgesCut";
};

export type MeshEdgeLoopInverse = {
  edgeIds: Uint32Array;
  loopIds: Uint32Array;
  mesh: THREE.Mesh;
  type: "setEdgeLoopIds";
};

export type MeshEditCommandInverse =
  | MeshPartAssignmentInverse
  | MeshEdgeCutInverse
  | MeshEdgeLoopInverse;

function createEdgeLoopIdBuffer(edgeCount: number) {
  return edgeCount <= 65535 ? new Uint16Array(edgeCount) : new Uint32Array(edgeCount);
}

function getTriangleNormalFromPosition(position: THREE.BufferAttribute, startIndex: number) {
  const first = new THREE.Vector3().fromBufferAttribute(position, startIndex);
  const second = new THREE.Vector3().fromBufferAttribute(position, startIndex + 1);
  const third = new THREE.Vector3().fromBufferAttribute(position, startIndex + 2);

  return new THREE.Vector3()
    .subVectors(second, first)
    .cross(new THREE.Vector3().subVectors(third, first));
}

function getEdgeFace(
  position: THREE.BufferAttribute,
  startIndex: number,
  firstOffset: number,
  secondOffset: number,
  normal: THREE.Vector3,
): TriangleEdgeFace | null {
  if (normal.lengthSq() === 0) {
    return null;
  }

  const start = new THREE.Vector3().fromBufferAttribute(position, startIndex + firstOffset);
  const end = new THREE.Vector3().fromBufferAttribute(position, startIndex + secondOffset);
  const direction = end.sub(start).normalize();

  if (direction.lengthSq() === 0) {
    return null;
  }

  return {
    direction,
    normal: normal.clone().normalize(),
  };
}

function getPositionEdgeKey(
  position: THREE.BufferAttribute,
  firstIndex: number,
  secondIndex: number,
) {
  return [getVertexPositionKey(position, firstIndex), getVertexPositionKey(position, secondIndex)]
    .sort()
    .join("|");
}

function refreshMeshEditPartMetadata(state: MeshEditState) {
  const nextMetadata = new Map<number, MeshEditPartMetadata>();
  const point = new THREE.Vector3();

  for (let triangleIndex = 0; triangleIndex < state.facePartId.length; triangleIndex += 1) {
    const partId = state.facePartId[triangleIndex] ?? defaultObjectId;
    let metadata = nextMetadata.get(partId);

    if (!metadata) {
      metadata = {
        bounds: new THREE.Box3(),
        id: partId,
        triangleCount: 0,
      };
      metadata.bounds.makeEmpty();
      nextMetadata.set(partId, metadata);
    }

    metadata.triangleCount += 1;

    const startIndex = triangleIndex * 3;

    for (let offset = 0; offset < 3; offset += 1) {
      metadata.bounds.expandByPoint(point.fromBufferAttribute(state.position, startIndex + offset));
    }
  }

  state.partMetadata = nextMetadata;
}

function buildMeshEditState(
  mesh: THREE.Mesh,
  previousState: MeshEditState | null,
): MeshEditState | null {
  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  const facePartId = getTriangleObjectIds(mesh);

  if (!facePartId) {
    return null;
  }

  const edgeRecords = new Map<
    string,
    {
      faceIds: number[];
      faces: TriangleEdgeFace[];
      positionEdgeKey: string;
      vertexIndexes: [number, number];
      vertexKeys: [string, string];
    }
  >();
  const faces: MeshEditFace[] = [];

  for (let startIndex = 0; startIndex < position.count; startIndex += 3) {
    const triangleIndex = startIndex / 3;
    const normal = getTriangleNormalFromPosition(position, startIndex);
    const bounds = new THREE.Box3().makeEmpty();
    const edgeKeys: string[] = [];
    const edgeOffsets: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];

    for (let offset = 0; offset < 3; offset += 1) {
      bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, startIndex + offset));
    }

    edgeOffsets.forEach(([firstOffset, secondOffset]) => {
      const firstIndex = startIndex + firstOffset;
      const secondIndex = startIndex + secondOffset;
      const firstKey = getVertexKey(position, firstIndex);
      const secondKey = getVertexKey(position, secondIndex);
      const edgeKey = [firstKey, secondKey].sort().join("|");
      const edgeFace = getEdgeFace(position, startIndex, firstOffset, secondOffset, normal);
      let edgeRecord = edgeRecords.get(edgeKey);

      if (!edgeRecord) {
        edgeRecord = {
          faceIds: [],
          faces: [],
          positionEdgeKey: getPositionEdgeKey(position, firstIndex, secondIndex),
          vertexIndexes: [firstIndex, secondIndex],
          vertexKeys: [firstKey, secondKey],
        };
        edgeRecords.set(edgeKey, edgeRecord);
      }

      edgeRecord.faceIds.push(triangleIndex);

      if (edgeFace) {
        edgeRecord.faces.push(edgeFace);
      }

      edgeKeys.push(edgeKey);
    });

    faces.push({
      bounds,
      edgeIds: [-1, -1, -1] as [number, number, number],
      edgeKeys: edgeKeys as [string, string, string],
      normal: normal.normalize(),
    });
  }

  const edgeIdByKey = new Map<string, number>();
  const edges: MeshEditEdge[] = [];
  const previousCutByKey = new Map<string, number>();
  const previousLoopByKey = new Map<string, number>();

  previousState?.edges.forEach((edge) => {
    previousCutByKey.set(edge.key, previousState.edgeCut[edge.id] ?? 0);
    previousLoopByKey.set(edge.key, previousState.edgeLoopId[edge.id] ?? 0);
  });

  Array.from(edgeRecords.entries()).forEach(([key, edgeRecord], edgeId) => {
    edgeIdByKey.set(key, edgeId);
    edges.push({
      faceIds: edgeRecord.faceIds,
      id: edgeId,
      key,
      normalAngle: getEdgeNormalAngle(edgeRecord.faces),
      positionEdgeKey: edgeRecord.positionEdgeKey,
      vertexIndexes: edgeRecord.vertexIndexes,
      vertexKeys: edgeRecord.vertexKeys,
    });
  });

  faces.forEach((face) => {
    face.edgeKeys.forEach((edgeKey, edgeSlot) => {
      face.edgeIds[edgeSlot] = edgeIdByKey.get(edgeKey) ?? -1;
    });
  });

  const edgeCut = new Uint8Array(edges.length);
  const edgeLoopId = createEdgeLoopIdBuffer(edges.length);

  edges.forEach((edge) => {
    edgeCut[edge.id] = previousCutByKey.get(edge.key) ?? 0;
    edgeLoopId[edge.id] = previousLoopByKey.get(edge.key) ?? 0;
  });

  const state: MeshEditState = {
    edgeCut,
    edgeIdByKey,
    edgeLoopId,
    edges,
    facePartId,
    faces,
    indexVersion: (previousState?.indexVersion ?? 0) + 1,
    mesh,
    partMetadata: new Map(),
    partVersion: previousState?.partVersion ?? 0,
    position,
  };

  refreshMeshEditPartMetadata(state);
  mesh.userData.meshEditState = state;
  mesh.geometry.userData.facePartId = facePartId;

  return state;
}

export function getMeshEditState(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");
  const facePartId = getTriangleObjectIds(mesh);
  const existing = mesh.userData.meshEditState as MeshEditState | undefined;

  if (
    existing &&
    existing.mesh === mesh &&
    existing.position === position &&
    existing.facePartId === facePartId &&
    existing.faces.length === (facePartId?.length ?? 0)
  ) {
    return existing;
  }

  return null;
}

export function ensureMeshEditState(mesh: THREE.Mesh) {
  const existing = getMeshEditState(mesh);

  return (
    existing ??
    buildMeshEditState(mesh, (mesh.userData.meshEditState as MeshEditState | undefined) ?? null)
  );
}

export function rebuildMeshEditState(mesh: THREE.Mesh) {
  return buildMeshEditState(
    mesh,
    (mesh.userData.meshEditState as MeshEditState | undefined) ?? null,
  );
}

export function markMeshPartIdsChanged(mesh: THREE.Mesh) {
  const state = ensureMeshEditState(mesh);

  if (!state) {
    return;
  }

  state.partVersion += 1;
  mesh.geometry.userData.facePartId = state.facePartId;
  mesh.userData.looseEdgeCacheDirty = true;
  mesh.userData.objectMaterialGroupsDirty = true;
  refreshMeshEditPartMetadata(state);
  refreshTriangleObjectIdAttribute(mesh);
}

export function markMeshEdgeCutsChanged(mesh: THREE.Mesh) {
  const state = ensureMeshEditState(mesh);

  if (!state) {
    return;
  }

  mesh.userData.looseEdgeCacheDirty = true;
  mesh.userData.objectMaterialGroupsDirty = true;
}

export function resetMeshEdgeLoopIds(mesh: THREE.Mesh) {
  const state = ensureMeshEditState(mesh);

  if (!state) {
    return null;
  }

  state.edgeLoopId.fill(0);

  return state;
}

export function assignFacesToPart(mesh: THREE.Mesh, faceIds: Iterable<number>, partId: number) {
  const state = ensureMeshEditState(mesh);

  if (!state) {
    return null;
  }

  const changedFaceIds: number[] = [];
  const previousPartIds: number[] = [];
  const nextPartId = Math.max(Math.floor(partId), defaultObjectId);

  for (const faceId of faceIds) {
    if (faceId < 0 || faceId >= state.facePartId.length) {
      continue;
    }

    const previousPartId = state.facePartId[faceId] ?? defaultObjectId;

    if (previousPartId === nextPartId) {
      continue;
    }

    changedFaceIds.push(faceId);
    previousPartIds.push(previousPartId);
    state.facePartId[faceId] = nextPartId;
  }

  if (changedFaceIds.length === 0) {
    return null;
  }

  markMeshPartIdsChanged(mesh);

  return {
    faceIds: new Uint32Array(changedFaceIds),
    mesh,
    partIds: new Uint32Array(previousPartIds),
    type: "assignFacesToPart",
  } satisfies MeshPartAssignmentInverse;
}

export function applyFacePartAssignmentInverse(inverse: MeshPartAssignmentInverse) {
  const state = ensureMeshEditState(inverse.mesh);

  if (!state || inverse.faceIds.length !== inverse.partIds.length) {
    return false;
  }

  for (let index = 0; index < inverse.faceIds.length; index += 1) {
    const faceId = inverse.faceIds[index];

    if (faceId < state.facePartId.length) {
      state.facePartId[faceId] = inverse.partIds[index] ?? defaultObjectId;
    }
  }

  markMeshPartIdsChanged(inverse.mesh);

  return true;
}

export function splitPartFromFaces(
  mesh: THREE.Mesh,
  faceIds: Iterable<number>,
  nextPartId: number,
) {
  const inverse = assignFacesToPart(mesh, faceIds, nextPartId);

  return inverse
    ? {
        inverse,
        partId: Math.max(Math.floor(nextPartId), defaultObjectId),
      }
    : null;
}

export function setEdgesCut(mesh: THREE.Mesh, edgeIds: Iterable<number>, cut: boolean) {
  const state = ensureMeshEditState(mesh);

  if (!state) {
    return null;
  }

  const changedEdgeIds: number[] = [];
  const previousCutValues: number[] = [];
  const nextCutValue = cut ? 1 : 0;

  for (const edgeId of edgeIds) {
    if (edgeId < 0 || edgeId >= state.edgeCut.length) {
      continue;
    }

    const previousCutValue = state.edgeCut[edgeId] ?? 0;

    if (previousCutValue === nextCutValue) {
      continue;
    }

    changedEdgeIds.push(edgeId);
    previousCutValues.push(previousCutValue);
    state.edgeCut[edgeId] = nextCutValue;
  }

  if (changedEdgeIds.length === 0) {
    return null;
  }

  markMeshEdgeCutsChanged(mesh);

  return {
    cutValues: new Uint8Array(previousCutValues),
    edgeIds: new Uint32Array(changedEdgeIds),
    mesh,
    type: "setEdgesCut",
  } satisfies MeshEdgeCutInverse;
}

export function applyEdgeCutInverse(inverse: MeshEdgeCutInverse) {
  const state = ensureMeshEditState(inverse.mesh);

  if (!state || inverse.edgeIds.length !== inverse.cutValues.length) {
    return false;
  }

  for (let index = 0; index < inverse.edgeIds.length; index += 1) {
    const edgeId = inverse.edgeIds[index];

    if (edgeId < state.edgeCut.length) {
      state.edgeCut[edgeId] = inverse.cutValues[index] ?? 0;
    }
  }

  markMeshEdgeCutsChanged(inverse.mesh);

  return true;
}

export function setEdgeLoopIds(mesh: THREE.Mesh, edgeIds: Iterable<number>, loopId: number) {
  const state = ensureMeshEditState(mesh);

  if (!state) {
    return null;
  }

  const changedEdgeIds: number[] = [];
  const previousLoopIds: number[] = [];
  const nextLoopId = Math.max(Math.floor(loopId), 0);

  for (const edgeId of edgeIds) {
    if (edgeId < 0 || edgeId >= state.edgeLoopId.length) {
      continue;
    }

    const previousLoopId = state.edgeLoopId[edgeId] ?? 0;

    if (previousLoopId === nextLoopId) {
      continue;
    }

    changedEdgeIds.push(edgeId);
    previousLoopIds.push(previousLoopId);
    state.edgeLoopId[edgeId] = nextLoopId;
  }

  if (changedEdgeIds.length === 0) {
    return null;
  }

  mesh.userData.looseEdgeCacheDirty = true;

  return {
    edgeIds: new Uint32Array(changedEdgeIds),
    loopIds: new Uint32Array(previousLoopIds),
    mesh,
    type: "setEdgeLoopIds",
  } satisfies MeshEdgeLoopInverse;
}

export function applyEdgeLoopInverse(inverse: MeshEdgeLoopInverse) {
  const state = ensureMeshEditState(inverse.mesh);

  if (!state || inverse.edgeIds.length !== inverse.loopIds.length) {
    return false;
  }

  for (let index = 0; index < inverse.edgeIds.length; index += 1) {
    const edgeId = inverse.edgeIds[index];

    if (edgeId < state.edgeLoopId.length) {
      state.edgeLoopId[edgeId] = inverse.loopIds[index] ?? 0;
    }
  }

  inverse.mesh.userData.looseEdgeCacheDirty = true;

  return true;
}

export function getMeshEdgeIdForKey(mesh: THREE.Mesh, edgeKey: string) {
  return ensureMeshEditState(mesh)?.edgeIdByKey.get(edgeKey) ?? null;
}

export function isMeshEdgeCut(mesh: THREE.Mesh, edgeKey: string) {
  const state = ensureMeshEditState(mesh);
  const edgeId = state?.edgeIdByKey.get(edgeKey);

  return edgeId != null ? state?.edgeCut[edgeId] === 1 : false;
}
