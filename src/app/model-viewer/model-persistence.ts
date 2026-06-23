import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { viewerPersistenceVersion } from "./persistence";
import type {
  PersistedLoopCapState,
  PersistedMeshState,
  PersistedModelSource,
  PersistedViewerState,
} from "./persistence";
import {
  defaultObjectId,
  defaultViewDirection,
  cameraNearPlane,
  targetModelSize,
  cloneArrayBuffer,
  cloneFloat32Array,
  cloneUint8Array,
  cloneUint32Array,
  collectSelectableMeshes,
  getPersistedLoopSegmentKey,
  getSeparatedObjectColor,
  getTriangleObjectIds,
  hasNonDefaultObjectIds,
  hasNonZeroTopologyIds,
  isMesh,
  refreshTriangleObjectIdAttribute,
  vertexTopologyIdsByPosition,
  type LooseEdgeLoop,
  type LooseEdgeLoopCapState,
  type ObjectNameMap,
  type ViewerHistoryMeshState,
  type ViewerHistorySnapshot,
  type ViewerHistorySnapshotOptions,
} from "./model-viewer-shared";
import { colorTriangle } from "./mesh-topology";
import {
  ensureMeshEditState,
  markMeshPartIdsChanged,
  rebuildMeshEditState,
} from "./mesh-edit-state";
import { getLooseEdgeLoopCacheKey } from "./loose-edge-loops";
import { editorGlbMetadataVersion } from "./editor-metadata";
import type { EditorMetadata } from "./editor-metadata";

export function applyObjectColorsToMeshes(meshes: Iterable<THREE.Mesh>) {
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const color = mesh.geometry.getAttribute("color");
    const objectIds = getTriangleObjectIds(mesh);

    if (!(position instanceof THREE.BufferAttribute) || !(color instanceof THREE.BufferAttribute)) {
      continue;
    }

    for (let index = 0; index < position.count; index += 3) {
      const triangleIndex = index / 3;
      const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;

      colorTriangle(color, index, getSeparatedObjectColor(objectId));
    }

    color.needsUpdate = true;
  }
}

export function applyObjectColors(model: THREE.Object3D, _hiddenObjectIds = new Set<number>()) {
  model.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];

  model.traverse((child) => {
    if (
      !isMesh(child) ||
      child.userData.isLooseEdgeFillOverlay === true ||
      child.userData.isCapOffsetGizmoOverlay === true ||
      child.userData.isNonFocusedObjectStencilOverlay === true ||
      child.userData.isNonFocusedObjectOutlineOverlay === true ||
      child.userData.isSelectedObjectStencilOverlay === true ||
      child.userData.isSelectedObjectOutlineOverlay === true ||
      child.userData.isHoverEdgeOverlay === true
    ) {
      return;
    }

    meshes.push(child);
  });

  applyObjectColorsToMeshes(meshes);
}

export function getPointFromVertexKey(vertexKey: string) {
  const positionKey = vertexKey.split("#")[0] ?? vertexKey;
  const coordinates = positionKey.split(",").map((value) => Number(value) / 100000);

  return new THREE.Vector3(coordinates[0] ?? 0, coordinates[1] ?? 0, coordinates[2] ?? 0);
}

export function normalizeModel(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);

  if (maxDimension === 0 || !Number.isFinite(maxDimension)) {
    model.position.set(0, 0, 0);
    return;
  }

  const scale = targetModelSize / maxDimension;

  model.scale.multiplyScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
}

export function frameModel(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls,
  model: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1);
  const aspect =
    camera instanceof THREE.PerspectiveCamera
      ? camera.aspect
      : (camera.right - camera.left) / (camera.top - camera.bottom);
  const verticalFov =
    camera instanceof THREE.PerspectiveCamera ? THREE.MathUtils.degToRad(camera.fov) : Math.PI / 4;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const fitFov = Math.min(verticalFov, horizontalFov);
  const distance = (radius / Math.sin(fitFov / 2)) * 1.15;

  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(defaultViewDirection.clone().multiplyScalar(distance));
  camera.near = cameraNearPlane;
  camera.far = distance * 100;

  if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = Math.max(0.01, targetModelSize / (radius * 2.4));
  }

  camera.updateProjectionMatrix();
  controls.update();
}

export function getPersistedMeshState(
  mesh: THREE.Mesh,
  meshIndex: number,
): PersistedMeshState | null {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const editState = ensureMeshEditState(mesh);
  const topologyIds =
    position instanceof THREE.BufferAttribute ? vertexTopologyIdsByPosition.get(position) : null;
  const meshState: PersistedMeshState = { meshIndex };

  if (position instanceof THREE.BufferAttribute && mesh.userData.hasPositionEdits === true) {
    meshState.positions = cloneFloat32Array(position.array);
  }

  if (objectIds && hasNonDefaultObjectIds(objectIds)) {
    meshState.triangleObjectIds = cloneUint32Array(objectIds);
  }

  if (topologyIds && hasNonZeroTopologyIds(topologyIds)) {
    meshState.vertexTopologyIds = cloneUint32Array(topologyIds);
  }

  if (editState?.edgeCut.some((value) => value !== 0)) {
    meshState.edgeCut = cloneUint8Array(editState.edgeCut);
  }

  return meshState.edgeCut ||
    meshState.positions ||
    meshState.triangleObjectIds ||
    meshState.vertexTopologyIds
    ? meshState
    : null;
}

export function getPersistedLoopCapState(
  meshes: THREE.Mesh[],
  key: string,
  state: LooseEdgeLoopCapState,
): PersistedLoopCapState | null {
  if (state.mode === "none") {
    return null;
  }

  const meshIndex = meshes.findIndex((mesh) => mesh.uuid === state.sourceMeshUuid);
  const mesh = meshes[meshIndex];
  const loopsById = mesh?.userData.looseEdgeLoopById as Map<number, LooseEdgeLoop> | undefined;

  if (!mesh || !(loopsById instanceof Map)) {
    return null;
  }

  const groupSegmentKeys: string[][] = [];

  loopsById.forEach((loop) => {
    const loopKey = getLooseEdgeLoopCacheKey(mesh, loop);

    if (state.groupLoopKeys?.includes(loopKey)) {
      groupSegmentKeys.push([...loop.segmentKeys].sort());
      return;
    }

    if (state.groupLoopKeys || groupSegmentKeys.length > 0 || loopKey !== key) {
      return;
    }

    groupSegmentKeys.push([...loop.segmentKeys].sort());
  });

  if (groupSegmentKeys.length === 0) {
    return null;
  }

  return {
    cone: state.cone,
    groupSegmentKeys: groupSegmentKeys.length > 1 ? groupSegmentKeys : undefined,
    meshIndex,
    mode: state.mode,
    normalAxisTarget: state.normalAxisTarget
      ? [state.normalAxisTarget.x, state.normalAxisTarget.y, state.normalAxisTarget.z]
      : null,
    normalTarget: state.normalTarget
      ? [state.normalTarget.x, state.normalTarget.y, state.normalTarget.z]
      : null,
    objectId: state.objectId,
    offset: state.offset,
    segmentKeys: groupSegmentKeys[0],
  };
}

export function createPersistedViewerState(
  modelRoot: THREE.Object3D,
  source: PersistedModelSource,
  hiddenObjectIds: Set<number>,
  objectNames: ObjectNameMap,
  nextObjectId: number,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
): PersistedViewerState {
  const meshes = collectSelectableMeshes(modelRoot);
  const meshStates = meshes
    .map((mesh, meshIndex) => getPersistedMeshState(mesh, meshIndex))
    .filter((meshState): meshState is PersistedMeshState => meshState !== null);
  const persistedLoopCapStates: PersistedLoopCapState[] = [];
  const persistedLoopCapStateKeys = new Set<string>();

  loopCapStates.forEach((state, key) => {
    const stateKey = state.groupLoopKeys?.join("||") ?? key;

    if (persistedLoopCapStateKeys.has(stateKey)) {
      return;
    }

    const persistedState = getPersistedLoopCapState(meshes, key, state);

    if (persistedState) {
      persistedLoopCapStateKeys.add(stateKey);
      persistedLoopCapStates.push(persistedState);
    }
  });

  const persistedHiddenObjectIds = Array.from(hiddenObjectIds).sort(
    (first, second) => first - second,
  );
  const persistedObjectNames = Object.fromEntries(
    Object.entries(objectNames).map(([objectId, name]) => [String(objectId), name]),
  );
  const metadata: EditorMetadata = {
    hiddenObjectIds: persistedHiddenObjectIds,
    loopCapStates: persistedLoopCapStates,
    nextObjectId,
    objectNames: persistedObjectNames,
    version: editorGlbMetadataVersion,
  };

  return {
    hiddenObjectIds: persistedHiddenObjectIds,
    loopCapStates: persistedLoopCapStates,
    meshes: meshStates,
    metadata,
    nextObjectId,
    objectNames: persistedObjectNames,
    savedAt: Date.now(),
    source: {
      ...source,
      data: cloneArrayBuffer(source.data),
    },
    version: viewerPersistenceVersion,
  };
}

export function getViewerHistoryMeshState(
  mesh: THREE.Mesh,
  meshIndex: number,
): ViewerHistoryMeshState | null {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);

  if (!(position instanceof THREE.BufferAttribute) || !objectIds) {
    return null;
  }

  const editState = ensureMeshEditState(mesh);
  const topologyIds = vertexTopologyIdsByPosition.get(position);

  return {
    edgeCut: editState ? cloneUint8Array(editState.edgeCut) : new Uint8Array(),
    edgeLoopId: editState ? cloneUint32Array(editState.edgeLoopId) : new Uint32Array(),
    hasPositionEdits: mesh.userData.hasPositionEdits === true,
    meshIndex,
    positions: cloneFloat32Array(position.array),
    triangleObjectIds: cloneUint32Array(objectIds),
    vertexTopologyIds: topologyIds
      ? cloneUint32Array(topologyIds)
      : new Uint32Array(position.count),
  };
}

export function createViewerHistorySnapshot(
  modelRoot: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  objectNames: ObjectNameMap,
  nextObjectId: number,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
  options: ViewerHistorySnapshotOptions = {},
): ViewerHistorySnapshot {
  const includeMeshes = options.includeMeshes ?? true;
  const meshes = collectSelectableMeshes(modelRoot);
  const loopCapStateSnapshots: PersistedLoopCapState[] = [];
  const loopCapStateSnapshotKeys = new Set<string>();

  loopCapStates.forEach((state, key) => {
    const stateKey = state.groupLoopKeys?.join("||") ?? key;

    if (loopCapStateSnapshotKeys.has(stateKey)) {
      return;
    }

    const persistedState = getPersistedLoopCapState(meshes, key, state);

    if (persistedState) {
      loopCapStateSnapshotKeys.add(stateKey);
      loopCapStateSnapshots.push(persistedState);
    }
  });

  return {
    hiddenObjectIds: Array.from(hiddenObjectIds).sort((first, second) => first - second),
    loopCapStates: loopCapStateSnapshots,
    meshStateIncluded: includeMeshes,
    meshes: includeMeshes
      ? meshes
          .map((mesh, meshIndex) => getViewerHistoryMeshState(mesh, meshIndex))
          .filter((meshState): meshState is ViewerHistoryMeshState => meshState !== null)
      : [],
    nextObjectId,
    objectNames: { ...objectNames },
  };
}

export function applyViewerHistoryMeshStates(
  modelRoot: THREE.Object3D,
  meshStates: ViewerHistoryMeshState[],
) {
  const meshes = collectSelectableMeshes(modelRoot);
  let hadInvalidState = meshStates.length !== meshes.length;

  meshStates.forEach((meshState) => {
    const mesh = meshes[meshState.meshIndex];
    const position = mesh?.geometry.getAttribute("position");
    const triangleCount =
      position instanceof THREE.BufferAttribute ? Math.floor(position.count / 3) : 0;

    if (!mesh || !(position instanceof THREE.BufferAttribute)) {
      hadInvalidState = true;
      return;
    }

    if (meshState.positions.length === position.array.length) {
      position.array.set(meshState.positions);
      position.needsUpdate = true;
      mesh.userData.hasPositionEdits = meshState.hasPositionEdits;
    } else {
      hadInvalidState = true;
    }

    if (meshState.triangleObjectIds.length === triangleCount) {
      mesh.geometry.userData.triangleObjectIds = cloneUint32Array(meshState.triangleObjectIds);
      refreshTriangleObjectIdAttribute(mesh);
    } else {
      hadInvalidState = true;
    }

    if (meshState.vertexTopologyIds.length === position.count) {
      vertexTopologyIdsByPosition.set(position, cloneUint32Array(meshState.vertexTopologyIds));
    } else {
      hadInvalidState = true;
    }

    const editState = rebuildMeshEditState(mesh);

    if (editState) {
      if (meshState.edgeCut.length === editState.edgeCut.length) {
        editState.edgeCut.set(meshState.edgeCut);
      } else if (meshState.edgeCut.length > 0) {
        hadInvalidState = true;
      }

      if (meshState.edgeLoopId.length === editState.edgeLoopId.length) {
        editState.edgeLoopId.set(meshState.edgeLoopId);
      } else if (meshState.edgeLoopId.length > 0) {
        hadInvalidState = true;
      }

      markMeshPartIdsChanged(mesh);
    }

    if (meshState.hasPositionEdits) {
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  });

  return hadInvalidState;
}

export function applyPersistedMeshStates(model: THREE.Object3D, meshStates: PersistedMeshState[]) {
  const meshes = collectSelectableMeshes(model);
  let hadInvalidState = false;

  meshStates.forEach((meshState) => {
    const mesh = meshes[meshState.meshIndex];
    const position = mesh?.geometry.getAttribute("position");
    const triangleCount =
      position instanceof THREE.BufferAttribute ? Math.floor(position.count / 3) : 0;

    if (!mesh || !(position instanceof THREE.BufferAttribute)) {
      hadInvalidState = true;
      return;
    }

    if (meshState.positions) {
      if (meshState.positions.length === position.array.length) {
        position.array.set(meshState.positions);
        position.needsUpdate = true;
        mesh.userData.hasPositionEdits = true;
      } else {
        hadInvalidState = true;
      }
    }

    if (meshState.triangleObjectIds) {
      if (meshState.triangleObjectIds.length === triangleCount) {
        mesh.geometry.userData.triangleObjectIds = cloneUint32Array(meshState.triangleObjectIds);
      } else {
        hadInvalidState = true;
      }
    }

    if (meshState.vertexTopologyIds) {
      if (meshState.vertexTopologyIds.length === position.count) {
        vertexTopologyIdsByPosition.set(position, cloneUint32Array(meshState.vertexTopologyIds));
      } else {
        hadInvalidState = true;
      }
    }

    const editState = rebuildMeshEditState(mesh);

    if (editState) {
      if (meshState.edgeCut) {
        if (meshState.edgeCut.length === editState.edgeCut.length) {
          editState.edgeCut.set(meshState.edgeCut);
        } else {
          hadInvalidState = true;
        }
      }

      if (meshState.edgeLoopId) {
        if (meshState.edgeLoopId.length === editState.edgeLoopId.length) {
          editState.edgeLoopId.set(meshState.edgeLoopId);
        } else {
          hadInvalidState = true;
        }
      }

      markMeshPartIdsChanged(mesh);
    }

    if (meshState.positions) {
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  });

  return hadInvalidState;
}

export function getRestoredObjectNames(objectNames: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(objectNames)
      .map(([objectId, name]) => [Number(objectId), name.trim()] as const)
      .filter(([objectId, name]) => Number.isFinite(objectId) && name.length > 0),
  ) as ObjectNameMap;
}

export function getLooseEdgeLoopFromPersistedState(
  mesh: THREE.Mesh,
  capState: PersistedLoopCapState,
) {
  const loopsById = mesh.userData.looseEdgeLoopById as Map<number, LooseEdgeLoop> | undefined;
  const targetSegmentKey = getPersistedLoopSegmentKey(capState.segmentKeys);

  if (!(loopsById instanceof Map)) {
    return null;
  }

  for (const loop of loopsById.values()) {
    if (
      loop.objectId === capState.objectId &&
      getPersistedLoopSegmentKey(loop.segmentKeys) === targetSegmentKey
    ) {
      return loop;
    }
  }

  return null;
}
