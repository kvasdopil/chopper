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
  hiddenObjectColor,
  cameraNearPlane,
  targetModelSize,
  cloneArrayBuffer,
  cloneFloat32Array,
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
} from "./model-viewer-shared";
import { colorTriangle } from "./mesh-topology";
import { getLooseEdgeLoopCacheKey } from "./loose-edge-loops";

export function applyObjectColors(model: THREE.Object3D, hiddenObjectIds = new Set<number>()) {
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (
      !isMesh(child) ||
      child.userData.isWireframeOverlay === true ||
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

    const position = child.geometry.getAttribute("position");
    const color = child.geometry.getAttribute("color");
    const objectIds = getTriangleObjectIds(child);

    if (!(position instanceof THREE.BufferAttribute) || !(color instanceof THREE.BufferAttribute)) {
      return;
    }

    for (let index = 0; index < position.count; index += 3) {
      const triangleIndex = index / 3;
      const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;
      const objectColor = hiddenObjectIds.has(objectId)
        ? hiddenObjectColor
        : getSeparatedObjectColor(objectId);

      colorTriangle(color, index, objectColor);
    }

    color.needsUpdate = true;
  });
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
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  model: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const fitFov = Math.min(verticalFov, horizontalFov);
  const distance = (radius / Math.sin(fitFov / 2)) * 1.15;

  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(defaultViewDirection.clone().multiplyScalar(distance));
  camera.near = cameraNearPlane;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

export function getPersistedMeshState(
  mesh: THREE.Mesh,
  meshIndex: number,
): PersistedMeshState | null {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
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

  return meshState.positions || meshState.triangleObjectIds || meshState.vertexTopologyIds
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

  let segmentKeys: string[] | null = null;

  loopsById.forEach((loop) => {
    if (segmentKeys || getLooseEdgeLoopCacheKey(mesh, loop) !== key) {
      return;
    }

    segmentKeys = [...loop.segmentKeys].sort();
  });

  if (!segmentKeys) {
    return null;
  }

  return {
    cone: state.cone,
    meshIndex,
    mode: state.mode,
    normalTarget: state.normalTarget
      ? [state.normalTarget.x, state.normalTarget.y, state.normalTarget.z]
      : null,
    objectId: state.objectId,
    offset: state.offset,
    segmentKeys,
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

  loopCapStates.forEach((state, key) => {
    const persistedState = getPersistedLoopCapState(meshes, key, state);

    if (persistedState) {
      persistedLoopCapStates.push(persistedState);
    }
  });

  return {
    hiddenObjectIds: Array.from(hiddenObjectIds).sort((first, second) => first - second),
    loopCapStates: persistedLoopCapStates,
    meshes: meshStates,
    nextObjectId,
    objectNames: Object.fromEntries(
      Object.entries(objectNames).map(([objectId, name]) => [String(objectId), name]),
    ),
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

  const topologyIds = vertexTopologyIdsByPosition.get(position);

  return {
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
): ViewerHistorySnapshot {
  const meshes = collectSelectableMeshes(modelRoot);
  const loopCapStateSnapshots: PersistedLoopCapState[] = [];

  loopCapStates.forEach((state, key) => {
    const persistedState = getPersistedLoopCapState(meshes, key, state);

    if (persistedState) {
      loopCapStateSnapshots.push(persistedState);
    }
  });

  return {
    hiddenObjectIds: Array.from(hiddenObjectIds).sort((first, second) => first - second),
    loopCapStates: loopCapStateSnapshots,
    meshes: meshes
      .map((mesh, meshIndex) => getViewerHistoryMeshState(mesh, meshIndex))
      .filter((meshState): meshState is ViewerHistoryMeshState => meshState !== null),
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

    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
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

    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
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
