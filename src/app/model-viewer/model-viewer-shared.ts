import * as THREE from "three";

import type { PersistedLoopCapState } from "./persistence";
import type {
  LinkedFaceSelectionGraph,
  LooseEdgeLoopMode,
  SeparatedObjectSummary,
} from "../viewer-controls/types";

export const targetModelSize = 4;
export const defaultObjectId = 0;
export const defaultObjectColor = new THREE.Color(0xd8d8d8);
export const hiddenObjectColor = new THREE.Color(0xf2f2f0);
export const wireframeColor = 0x3f3f46;
export const wireframeOpacity = 0.16;
export const defaultViewDirection = new THREE.Vector3(1.8, 1.15, 2.3).normalize();
export const minOrbitDistance = 0.02;
export const maxOrbitDistance = 80;
export const cameraNearPlane = 0.001;
export const clickMoveTolerance = 4;
export const hoverEdgeColor = 0xfacc15;
export const hoverEdgeLineWidth = 2;
export const hoverEdgeRenderOrder = 3;
export const selectedObjectOutlineColor = 0xfacc15;
export const selectedObjectOutlinePixels = 2;
export const nonFocusedObjectOutlineColor = 0xb8b8b8;
export const nonFocusedObjectOutlinePixels = 2;
export const nonFocusedObjectBoundaryOpacity = 0.82;
export const maxSelectedObjectOutlineIds = 64;
export const nonFocusedObjectOutlineStencilRef = 3;
export const nonFocusedObjectStencilRenderOrder = 3.5;
export const nonFocusedObjectOutlineRenderOrder = 3.6;
export const selectedObjectStencilRenderOrder = 3.9;
export const selectedObjectOutlineRenderOrder = 4;
export const looseEdgeColor = 0xef4444;
export const cappedLooseEdgeColor = 0x22c55e;
export const looseEdgeHoverColor = 0xfacc15;
export const looseEdgeLineWidth = 3;
export const looseEdgeUiOverlayLineWidth = 4;
export const looseEdgeHoverOverlayLineWidth = 6;
export const looseEdgeHoverHitTolerancePx = 5;
export const looseEdgeHoverRenderOrder = 8;
export const obstructedLooseEdgeLineWidth = 1;
export const obstructedLooseEdgeOpacity = 0.6;
export const linkedFaceSelectionColor = new THREE.Color(0xfacc15);
export const linkedFaceSelectionLineWidth = 2;
export const selectedLooseEdgeLoopColor = 0xfacc15;
export const capOffsetGizmoColor = 0x38bdf8;
export const capOffsetGizmoHeadScale = 0.055;
export const capOffsetGizmoHitTolerancePx = 10;
export const capOffsetGizmoForceClosedHitTolerancePx = 24;
export const capOffsetGizmoMinLength = 0.08;
export const looseEdgeLoopCylinderShapeScale = 0.5;
export const looseEdgeLoopCylinderConeOffsetScale = 0.5;
export const looseEdgeLoopOcclusionOpacity = 0.3;
export const looseEdgeLoopOcclusionRenderOrder = 2;
export const looseEdgeLoopOcclusionStencilRef = 2;
export const defaultLinkedFaceSelectionAngle = 10;
export const maxLinkedFaceSelectionAngle = 90;
export const linkedFaceSelectionGraphInterval = 0.1;
export const linkedFaceSelectionGraphWidth = 240;
export const linkedFaceSelectionGraphHeight = 56;
export const minLoosePartTriangleCountToSeparate = 10;
export const separationProgressCheckInterval = 256;
export const separationProgressUpdateIntervalMs = 500;
export const exportMergeDistance = 0.00001;
export const persistenceSaveDelayMs = 500;
export const toastDurationMs = 4800;

export type TriangleEdgeFace = {
  direction: THREE.Vector3;
  normal: THREE.Vector3;
};
export type TriangleVertex = {
  key: string;
  point: THREE.Vector3;
};
export type HoveredEdge = {
  boundaryPositions?: Float32Array;
  end: THREE.Vector3;
  isLooseEdge?: boolean;
  isSelectionBoundary?: boolean;
  key: string;
  loopId?: number;
  mesh: THREE.Mesh;
  objectId: number;
  start: THREE.Vector3;
};
export type LooseEdgeLoop = {
  contactKey: string;
  contactObjectIds: number[];
  id: number;
  isClosed: boolean;
  objectId: number;
  pairKey: string;
  positions: Float32Array;
  segmentIndexes: number[];
  segmentKeys: string[];
};
export type LooseEdgeLoopCapState = {
  cone: boolean;
  fill: THREE.Mesh | null;
  mode: LooseEdgeLoopMode;
  normalTarget: THREE.Vector3 | null;
  occlusionOverlay: THREE.Mesh | null;
  objectId: number;
  offset: number;
  sourceMeshUuid: string;
};
export type LooseEdgeLoopCapAxisData = {
  axis: THREE.Vector3;
  data: LooseEdgeLoopFillData;
  defaultOffset: number;
};
export type ExportGeometryGroup = {
  materialName: string;
  positions: number[];
};
export type ExportObjectGeometry = {
  basePositions: number[];
  generatedGroups: ExportGeometryGroup[];
};
export type ViewerHistoryMeshState = {
  hasPositionEdits: boolean;
  meshIndex: number;
  positions: Float32Array;
  triangleObjectIds: Uint32Array;
  vertexTopologyIds: Uint32Array;
};
export type ViewerHistorySnapshot = {
  hiddenObjectIds: number[];
  loopCapStates: PersistedLoopCapState[];
  meshes: ViewerHistoryMeshState[];
  nextObjectId: number;
  objectNames: ObjectNameMap;
};
export type ObjectJoinPlan = {
  objectIdToTargetId: Map<number, number>;
  targetObjectIds: Set<number>;
};
export type LooseEdgeLoopMember = {
  edge: HoveredEdge;
  key: string;
  loop: LooseEdgeLoop;
  mesh: THREE.Mesh;
};
export type CapOffsetDragState = {
  edge: HoveredEdge;
  historySnapshot: ViewerHistorySnapshot | null;
  offsetDirection: number;
  pixelsPerOffsetUnit?: number;
  pointerId: number;
  screenAxis?: THREE.Vector2;
  startClientX: number;
  startClientY: number;
  startOffset: number;
};
export type LooseEdgeSegment = {
  contactKey: string;
  contactObjectIds: number[];
  end: THREE.Vector3;
  endKey: string;
  endPositionKey: string;
  edgeKey: string;
  index: number;
  loopId: number;
  normal: THREE.Vector3;
  objectId: number;
  positionEdgeKey: string;
  start: THREE.Vector3;
  startKey: string;
  startPositionKey: string;
};
export type LooseEdgeRenderCache = {
  colors: Float32Array;
  positions: Float32Array;
  segmentCount: number;
};
export type LooseEdgeLoopFillSegment = {
  end: THREE.Vector3;
  endIndex: number;
  start: THREE.Vector3;
  startIndex: number;
};
export type LooseEdgeLoopFillData = {
  center: THREE.Vector3;
  forceClosed: boolean;
  objectCenter: THREE.Vector3 | null;
  points: THREE.Vector3[];
  referenceNormal: THREE.Vector3;
  segments: LooseEdgeLoopFillSegment[];
};
export type TriangleTopology = {
  edgeKeys: string[];
  vertices: TriangleVertex[];
};
export type MeshTopology = {
  edgeToTriangles: Map<string, number[]>;
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute;
  triangles: TriangleTopology[];
};
export type LinkedFaceSelectionDetails = {
  mesh: THREE.Mesh;
  objectId: number;
  seedTriangleIndex: number;
  selectedTriangleIndexes: Set<number>;
  topology: MeshTopology;
};
export type SelectionBoundaryLoop = {
  id: number;
  positions: Float32Array;
  segmentKeys: string[];
  selectedTriangleIndexes: number[];
};
export type LinkedFaceSelectionCache = LinkedFaceSelectionGraph & {
  mesh: THREE.Mesh;
  objectId: number;
  seedTriangleIndex: number;
  thresholdByTriangle: Float32Array;
  topology: MeshTopology;
};
export type RememberedTriangleSelection = {
  mesh: THREE.Mesh;
  objectId: number;
  triangleIndex: number;
};
export type DisposableDrawObject = THREE.Object3D & {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
};
export type ObjectNameMap = Record<number, string>;
export type SeparationProgressReporter = (message: string, force?: boolean) => Promise<void>;
export type ToastMessage = {
  id: number;
  text: string;
};

export const vertexTopologyIdsByPosition = new WeakMap<THREE.BufferAttribute, Uint32Array>();

export function cloneArrayBuffer(buffer: ArrayBuffer) {
  return buffer.slice(0);
}

export function cloneFloat32Array(values: ArrayLike<number>) {
  return new Float32Array(values);
}

export function cloneUint32Array(values: ArrayLike<number>) {
  return new Uint32Array(values);
}

export function hasNonDefaultObjectIds(objectIds: Uint32Array) {
  return objectIds.some((objectId) => objectId !== defaultObjectId);
}

export function hasNonZeroTopologyIds(topologyIds: Uint32Array) {
  return topologyIds.some((topologyId) => topologyId !== 0);
}

export function getPersistedLoopSegmentKey(segmentKeys: string[]) {
  return [...segmentKeys].sort().join("~");
}

export function isCylinderLoopMode(mode: LooseEdgeLoopMode) {
  return (
    mode === "cylinder-x" ||
    mode === "cylinder-y" ||
    mode === "cylinder-z" ||
    mode === "cylinder-normal"
  );
}

export function supportsConeLoopMode(mode: LooseEdgeLoopMode) {
  return mode.startsWith("extrude-") || isCylinderLoopMode(mode);
}

export function isNormalTargetLoopMode(mode: LooseEdgeLoopMode) {
  return mode === "extrude-normal" || mode === "cylinder-normal";
}

export function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

export function isDisposableDrawObject(object: THREE.Object3D): object is DisposableDrawObject {
  const candidate = object as Partial<DisposableDrawObject>;

  return (
    candidate.geometry instanceof THREE.BufferGeometry &&
    (candidate.material instanceof THREE.Material || Array.isArray(candidate.material))
  );
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  material.dispose();
}

export function setLooseEdgeLoopFillBaseMaterial(mesh: THREE.Mesh, markStencil: boolean) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  mesh.renderOrder = 0;

  materials.forEach((material) => {
    material.transparent = false;
    material.opacity = 1;
    material.depthFunc = THREE.LessEqualDepth;
    material.depthTest = true;
    material.depthWrite = true;
    material.stencilWrite = markStencil;
    material.stencilFunc = THREE.AlwaysStencilFunc;
    material.stencilRef = looseEdgeLoopOcclusionStencilRef;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.ReplaceStencilOp;
    material.needsUpdate = true;
  });
}

export function createLooseEdgeLoopFillOcclusionOverlay(fill: THREE.Mesh) {
  const sourceMaterial = Array.isArray(fill.material) ? fill.material[0] : fill.material;
  const material = sourceMaterial.clone();
  const overlay = new THREE.Mesh(fill.geometry, material);

  overlay.name = "loose-edge-loop-occlusion-overlay";
  overlay.position.copy(fill.position);
  overlay.quaternion.copy(fill.quaternion);
  overlay.scale.copy(fill.scale);
  overlay.matrix.copy(fill.matrix);
  overlay.matrixAutoUpdate = fill.matrixAutoUpdate;
  overlay.renderOrder = looseEdgeLoopOcclusionRenderOrder;
  overlay.userData.isLooseEdgeFillOverlay = true;
  overlay.userData.fillKey = fill.userData.fillKey;
  overlay.userData.loopId = fill.userData.loopId;
  overlay.userData.objectId = fill.userData.objectId;
  overlay.userData.sourceMeshUuid = fill.userData.sourceMeshUuid;

  material.transparent = true;
  material.opacity = looseEdgeLoopOcclusionOpacity;
  material.depthFunc = THREE.GreaterDepth;
  material.depthTest = true;
  material.depthWrite = false;
  material.stencilWrite = false;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilRef = looseEdgeLoopOcclusionStencilRef;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.KeepStencilOp;
  material.needsUpdate = true;

  return overlay;
}

export function disposeLooseEdgeLoopFillOcclusionOverlay(state: LooseEdgeLoopCapState) {
  const overlay = state.occlusionOverlay;

  if (!overlay) {
    return;
  }

  overlay.parent?.remove(overlay);
  disposeMaterial(overlay.material);
  state.occlusionOverlay = null;
}

export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  object.traverse((child) => {
    if (!isDisposableDrawObject(child)) {
      return;
    }

    geometries.add(child.geometry);

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => materials.add(material));
      return;
    }

    materials.add(child.material);
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function clearModel(root: THREE.Group) {
  [...root.children].forEach((child) => {
    root.remove(child);
    disposeObject(child);
  });
}

export function getVertexPositionKey(position: THREE.BufferAttribute, index: number) {
  const precision = 100000;
  return [
    Math.round(position.getX(index) * precision),
    Math.round(position.getY(index) * precision),
    Math.round(position.getZ(index) * precision),
  ].join(",");
}

export function getVertexKey(position: THREE.BufferAttribute, index: number) {
  const topologyId = vertexTopologyIdsByPosition.get(position)?.[index] ?? 0;
  const positionKey = getVertexPositionKey(position, index);

  return topologyId > 0 ? `${positionKey}#${topologyId}` : positionKey;
}

export function ensureVertexTopologyIds(position: THREE.BufferAttribute) {
  const existing = vertexTopologyIdsByPosition.get(position);

  if (existing && existing.length === position.count) {
    return existing;
  }

  const topologyIds = new Uint32Array(position.count);

  vertexTopologyIdsByPosition.set(position, topologyIds);

  return topologyIds;
}

export function getNextVertexTopologyId(position: THREE.BufferAttribute) {
  const topologyIds = ensureVertexTopologyIds(position);
  let nextTopologyId = 1;

  for (let index = 0; index < topologyIds.length; index += 1) {
    nextTopologyId = Math.max(nextTopologyId, topologyIds[index] + 1);
  }

  return nextTopologyId;
}

export function getLooseEdgeKey(objectId: number, edgeKey: string) {
  return `${objectId}:${edgeKey}`;
}

export function getSeparatedObjectColor(objectId: number) {
  if (objectId === defaultObjectId) {
    return defaultObjectColor.clone();
  }

  const color = new THREE.Color();
  const hue = (objectId * 0.61803398875) % 1;

  color.setHSL(hue, 0.72, 0.64);

  return color;
}

export function getSeparatedObjectColorCss(objectId: number) {
  return `#${getSeparatedObjectColor(objectId).getHexString()}`;
}

export function getDefaultSeparatedObjectLabel(objectId: number) {
  return objectId === defaultObjectId ? "Default" : `Object ${objectId}`;
}

export function getSeparatedObjectLabel(objectId: number, objectNames: ObjectNameMap) {
  return objectNames[objectId]?.trim() || getDefaultSeparatedObjectLabel(objectId);
}

export function getTriangleObjectIds(mesh: THREE.Mesh) {
  const existing = mesh.geometry.userData.triangleObjectIds;

  if (existing instanceof Uint32Array) {
    return existing;
  }

  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  const objectIds = new Uint32Array(Math.floor(position.count / 3));

  mesh.geometry.userData.triangleObjectIds = objectIds;

  return objectIds;
}

export function getTriangleObjectId(mesh: THREE.Mesh, triangleIndex: number) {
  return getTriangleObjectIds(mesh)?.[triangleIndex] ?? defaultObjectId;
}

export function getTriangleObjectIdSet(mesh: THREE.Mesh) {
  const existing = mesh.geometry.userData.triangleObjectIdSet;

  if (existing instanceof Set) {
    return existing as Set<number>;
  }

  const objectIds = getTriangleObjectIds(mesh);

  if (!objectIds) {
    return new Set<number>();
  }

  const objectIdSet = new Set<number>();

  objectIds.forEach((objectId) => objectIdSet.add(objectId));
  mesh.geometry.userData.triangleObjectIdSet = objectIdSet;

  return objectIdSet;
}

export function refreshTriangleObjectIdAttribute(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);

  if (!(position instanceof THREE.BufferAttribute) || !objectIds) {
    return;
  }

  const existing = mesh.geometry.getAttribute("objectId");
  const canReuseExisting =
    existing instanceof THREE.BufferAttribute &&
    existing.count === position.count &&
    existing.array instanceof Float32Array;
  const values: Float32Array =
    canReuseExisting && existing instanceof THREE.BufferAttribute
      ? (existing.array as Float32Array)
      : new Float32Array(position.count);
  const objectIdSet = new Set<number>();

  for (let triangleIndex = 0; triangleIndex < objectIds.length; triangleIndex += 1) {
    const vertexIndex = triangleIndex * 3;
    const objectId = objectIds[triangleIndex] ?? defaultObjectId;

    objectIdSet.add(objectId);
    values[vertexIndex] = objectId;
    values[vertexIndex + 1] = objectId;
    values[vertexIndex + 2] = objectId;
  }

  mesh.geometry.userData.triangleObjectIdSet = objectIdSet;

  if (canReuseExisting && existing instanceof THREE.BufferAttribute) {
    existing.needsUpdate = true;
    return;
  }

  mesh.geometry.setAttribute("objectId", new THREE.BufferAttribute(values, 1));
}

export function waitForBrowserPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

export function createThrottledProgressReporter(setProgress: (message: string) => void) {
  let lastUpdate = 0;

  return async (message: string, force = false) => {
    const now = performance.now();

    if (!force && now - lastUpdate < separationProgressUpdateIntervalMs) {
      return;
    }

    lastUpdate = now;
    setProgress(message);
    await waitForBrowserPaint();
  };
}

export function collectSeparatedObjects(
  model: THREE.Object3D,
  hiddenObjectIds = new Set<number>(),
  objectNames: ObjectNameMap = {},
): SeparatedObjectSummary[] {
  const counts = new Map<number, number>();

  model.traverse((child) => {
    if (!isSelectableMesh(child)) {
      return;
    }

    const objectIds = getTriangleObjectIds(child);

    if (!objectIds) {
      return;
    }

    objectIds.forEach((objectId) => {
      counts.set(objectId, (counts.get(objectId) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .filter(([, triangleCount]) => triangleCount > 0)
    .sort(([firstId], [secondId]) => firstId - secondId)
    .map(([id, triangleCount]) => ({
      color: getSeparatedObjectColorCss(id),
      id,
      label: getSeparatedObjectLabel(id, objectNames),
      triangleCount,
      visible: !hiddenObjectIds.has(id),
    }));
}

export function getSignedEdgeNormalAngle(edgeFaces: TriangleEdgeFace[]) {
  if (edgeFaces.length <= 1) {
    return 90;
  }

  const normalCross = new THREE.Vector3();
  let signedAngle = 0;

  for (let index = 0; index < edgeFaces.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < edgeFaces.length; nextIndex += 1) {
      const currentAngle = THREE.MathUtils.radToDeg(
        Math.atan2(
          edgeFaces[index].direction.dot(
            normalCross.crossVectors(edgeFaces[index].normal, edgeFaces[nextIndex].normal),
          ),
          edgeFaces[index].normal.dot(edgeFaces[nextIndex].normal),
        ),
      );

      if (Math.abs(currentAngle) > Math.abs(signedAngle)) {
        signedAngle = currentAngle;
      }
    }
  }

  return signedAngle;
}

export function getEdgeNormalAngle(edgeFaces: TriangleEdgeFace[]) {
  return Math.abs(getSignedEdgeNormalAngle(edgeFaces));
}

export function getMaterialTextureMap(material: THREE.Material) {
  const candidate = material as THREE.Material & { map?: unknown };

  return candidate.map instanceof THREE.Texture ? candidate.map : null;
}

export function getMaterialTextureMaps(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material];

  return materials.map((item) => getMaterialTextureMap(item));
}

export function getSourceTriangleMaterialIndexes(
  geometry: THREE.BufferGeometry,
  triangleCount: number,
) {
  const materialIndexes = new Uint32Array(triangleCount);

  geometry.groups.forEach((group) => {
    const startTriangleIndex = Math.max(Math.floor(group.start / 3), 0);
    const endTriangleIndex = Math.min(Math.ceil((group.start + group.count) / 3), triangleCount);

    for (
      let triangleIndex = startTriangleIndex;
      triangleIndex < endTriangleIndex;
      triangleIndex += 1
    ) {
      materialIndexes[triangleIndex] = Math.max(group.materialIndex ?? 0, 0);
    }
  });

  return materialIndexes;
}

export function getMeshSourceTextureMap(mesh: THREE.Mesh, materialIndex: number) {
  const textureMaps = mesh.userData.sourceTextureMaps as Array<THREE.Texture | null> | undefined;

  return textureMaps?.[materialIndex] ?? textureMaps?.[0] ?? null;
}

export function meshHasSourceTextureMaps(mesh: THREE.Mesh) {
  const textureMaps = mesh.userData.sourceTextureMaps as Array<THREE.Texture | null> | undefined;

  return textureMaps?.some((textureMap) => textureMap instanceof THREE.Texture) === true;
}

export function modelHasSourceTextureMaps(model: THREE.Object3D) {
  return collectSelectableMeshes(model).some((mesh) => meshHasSourceTextureMaps(mesh));
}

export function isSelectableMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (
    isMesh(object) &&
    object.userData.isWireframeOverlay !== true &&
    object.userData.isLooseEdgeOverlay !== true &&
    object.userData.isLooseEdgeFillOverlay !== true &&
    object.userData.isCapOffsetGizmoOverlay !== true &&
    object.userData.isLooseEdgeSelectionOverlay !== true &&
    object.userData.isNonFocusedObjectStencilOverlay !== true &&
    object.userData.isNonFocusedObjectOutlineOverlay !== true &&
    object.userData.isSelectedObjectStencilOverlay !== true &&
    object.userData.isSelectedObjectOutlineOverlay !== true &&
    object.userData.isSelectionBoundaryLoopOverlay !== true &&
    object.userData.isHoverEdgeOverlay !== true
  );
}

export function isEditableHotkeyTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") ||
    (target instanceof HTMLElement && target.isContentEditable),
  );
}

export function isEditableHotkeyEvent(event: KeyboardEvent) {
  return (
    isEditableHotkeyTarget(event.target) ||
    isEditableHotkeyTarget(document.activeElement) ||
    event.composedPath().some((target) => isEditableHotkeyTarget(target))
  );
}

export function collectSelectableMeshes(model: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      meshes.push(child);
    }
  });

  return meshes;
}

export function getMaxObjectId(model: THREE.Object3D) {
  let maxObjectId = defaultObjectId;

  collectSelectableMeshes(model).forEach((mesh) => {
    const objectIds = getTriangleObjectIds(mesh);

    objectIds?.forEach((objectId) => {
      maxObjectId = Math.max(maxObjectId, objectId);
    });
  });

  return maxObjectId;
}
