"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  clearPersistedViewerState,
  readPersistedViewerState,
  savePersistedViewerState,
  viewerPersistenceVersion,
  type PersistedLoopCapState,
  type PersistedMeshState,
  type PersistedModelSource,
  type PersistedViewerState,
} from "./persistence";
import { EdgeLoopCapToolPanel } from "./tools/edge-loop-cap-tool";
import { SeparationToolPanel } from "./tools/separation-tool";
import type { ViewerTool, ViewerToolId } from "./tools";
import { ObjectsPanel } from "../viewer-controls/objects-panel";
import { TopBar } from "../viewer-controls/top-bar";
import type {
  LinkedFaceSelectionGraph,
  LinkedFaceSelectionState,
  LoadState,
  LooseEdgeLoopMode,
  SeparatedObjectSummary,
} from "../viewer-controls/types";

const targetModelSize = 4;
const defaultObjectId = 0;
const defaultObjectColor = new THREE.Color(0xd8d8d8);
const hiddenObjectColor = new THREE.Color(0xf2f2f0);
const wireframeColor = 0x3f3f46;
const wireframeOpacity = 0.16;
const defaultViewDirection = new THREE.Vector3(1.8, 1.15, 2.3).normalize();
const minOrbitDistance = 0.02;
const maxOrbitDistance = 80;
const cameraNearPlane = 0.001;
const clickMoveTolerance = 4;
const hoverEdgeColor = 0xfacc15;
const hoverEdgeLineWidth = 2;
const hoverEdgeRenderOrder = 3;
const selectedObjectOutlineColor = 0xfacc15;
const selectedObjectOutlinePixels = 2;
const selectedObjectStencilRenderOrder = 3.9;
const selectedObjectOutlineRenderOrder = 4;
const looseEdgeColor = 0xef4444;
const looseEdgeHoverColor = 0x2563eb;
const looseEdgeLineWidth = 3;
const looseEdgeUiOverlayLineWidth = 4;
const looseEdgeHoverHitTolerancePx = 5;
const looseEdgeHoverRenderOrder = 8;
const obstructedLooseEdgeLineWidth = 1;
const obstructedLooseEdgeOpacity = 0.6;
const linkedFaceSelectionColor = new THREE.Color(0xfacc15);
const linkedFaceSelectionLineWidth = 2;
const selectedLooseEdgeLoopColor = 0xfacc15;
const capOffsetGizmoColor = 0x38bdf8;
const capOffsetGizmoHeadScale = 0.055;
const capOffsetGizmoHitTolerancePx = 10;
const capOffsetGizmoMinLength = 0.08;
const looseEdgeLoopCylinderRadiusScale = 0.8;
const looseEdgeLoopCylinderSegments = 16;
const looseEdgeLoopOcclusionOpacity = 0.3;
const looseEdgeLoopOcclusionRenderOrder = 2;
const looseEdgeLoopOcclusionStencilRef = 2;
const defaultLinkedFaceSelectionAngle = 10;
const maxLinkedFaceSelectionAngle = 90;
const linkedFaceSelectionGraphInterval = 0.1;
const linkedFaceSelectionGraphWidth = 240;
const linkedFaceSelectionGraphHeight = 56;
const minLoosePartTriangleCountToSeparate = 10;
const separationProgressCheckInterval = 256;
const separationProgressUpdateIntervalMs = 500;
const persistenceSaveDelayMs = 500;
const toastDurationMs = 4800;

type TriangleEdgeFace = {
  direction: THREE.Vector3;
  normal: THREE.Vector3;
};
type TriangleVertex = {
  key: string;
  point: THREE.Vector3;
};
type HoveredEdge = {
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
type LooseEdgeLoop = {
  id: number;
  objectId: number;
  positions: Float32Array;
  segmentIndexes: number[];
  segmentKeys: string[];
};
type LooseEdgeLoopCapState = {
  fill: THREE.Mesh | null;
  mode: LooseEdgeLoopMode;
  normalTarget: THREE.Vector3 | null;
  occlusionOverlay: THREE.Mesh | null;
  objectId: number;
  offset: number;
  sourceMeshUuid: string;
};
type LooseEdgeLoopCapAxisData = {
  axis: THREE.Vector3;
  data: LooseEdgeLoopFillData;
  defaultOffset: number;
};
type CapOffsetDragState = {
  edge: HoveredEdge;
  pixelsPerOffsetUnit?: number;
  pointerId: number;
  screenAxis?: THREE.Vector2;
  startClientX: number;
  startClientY: number;
  startOffset: number;
};
type LooseEdgeSegment = {
  end: THREE.Vector3;
  endKey: string;
  edgeKey: string;
  index: number;
  loopId: number;
  normal: THREE.Vector3;
  objectId: number;
  start: THREE.Vector3;
  startKey: string;
};
type LooseEdgeRenderCache = {
  colors: Float32Array;
  positions: Float32Array;
  segmentCount: number;
};
type LooseEdgeLoopFillSegment = {
  end: THREE.Vector3;
  endIndex: number;
  start: THREE.Vector3;
  startIndex: number;
};
type LooseEdgeLoopFillData = {
  center: THREE.Vector3;
  objectCenter: THREE.Vector3 | null;
  points: THREE.Vector3[];
  referenceNormal: THREE.Vector3;
  segments: LooseEdgeLoopFillSegment[];
};
type TriangleTopology = {
  edgeKeys: string[];
  vertices: TriangleVertex[];
};
type MeshTopology = {
  edgeToTriangles: Map<string, number[]>;
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute;
  triangles: TriangleTopology[];
};
type LinkedFaceSelectionDetails = {
  mesh: THREE.Mesh;
  objectId: number;
  seedTriangleIndex: number;
  selectedTriangleIndexes: Set<number>;
  topology: MeshTopology;
};
type SelectionBoundaryLoop = {
  id: number;
  positions: Float32Array;
  segmentKeys: string[];
  selectedTriangleIndexes: number[];
};
type LinkedFaceSelectionCache = LinkedFaceSelectionGraph & {
  mesh: THREE.Mesh;
  objectId: number;
  seedTriangleIndex: number;
  thresholdByTriangle: Float32Array;
  topology: MeshTopology;
};
type RememberedTriangleSelection = {
  mesh: THREE.Mesh;
  objectId: number;
  triangleIndex: number;
};
type DisposableDrawObject = THREE.Object3D & {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
};
type ObjectNameMap = Record<number, string>;
type SeparationProgressReporter = (message: string, force?: boolean) => Promise<void>;
type ToastMessage = {
  id: number;
  text: string;
};

const vertexTopologyIdsByPosition = new WeakMap<THREE.BufferAttribute, Uint32Array>();

function cloneArrayBuffer(buffer: ArrayBuffer) {
  return buffer.slice(0);
}

function cloneFloat32Array(values: ArrayLike<number>) {
  return new Float32Array(values);
}

function cloneUint32Array(values: ArrayLike<number>) {
  return new Uint32Array(values);
}

function hasNonDefaultObjectIds(objectIds: Uint32Array) {
  return objectIds.some((objectId) => objectId !== defaultObjectId);
}

function hasNonZeroTopologyIds(topologyIds: Uint32Array) {
  return topologyIds.some((topologyId) => topologyId !== 0);
}

function getPersistedLoopSegmentKey(segmentKeys: string[]) {
  return [...segmentKeys].sort().join("~");
}

function isCylinderLoopMode(mode: LooseEdgeLoopMode) {
  return (
    mode === "cylinder-x" ||
    mode === "cylinder-y" ||
    mode === "cylinder-z" ||
    mode === "cylinder-normal"
  );
}

function isNormalTargetLoopMode(mode: LooseEdgeLoopMode) {
  return mode === "extrude-normal" || mode === "cylinder-normal";
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function isDisposableDrawObject(object: THREE.Object3D): object is DisposableDrawObject {
  const candidate = object as Partial<DisposableDrawObject>;

  return (
    candidate.geometry instanceof THREE.BufferGeometry &&
    (candidate.material instanceof THREE.Material || Array.isArray(candidate.material))
  );
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  material.dispose();
}

function setLooseEdgeLoopFillBaseMaterial(mesh: THREE.Mesh, markStencil: boolean) {
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

function createLooseEdgeLoopFillOcclusionOverlay(fill: THREE.Mesh) {
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

function disposeLooseEdgeLoopFillOcclusionOverlay(state: LooseEdgeLoopCapState) {
  const overlay = state.occlusionOverlay;

  if (!overlay) {
    return;
  }

  overlay.parent?.remove(overlay);
  disposeMaterial(overlay.material);
  state.occlusionOverlay = null;
}

function disposeObject(object: THREE.Object3D) {
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

function clearModel(root: THREE.Group) {
  [...root.children].forEach((child) => {
    root.remove(child);
    disposeObject(child);
  });
}

function getVertexKey(position: THREE.BufferAttribute, index: number) {
  const precision = 100000;
  const topologyId = vertexTopologyIdsByPosition.get(position)?.[index] ?? 0;
  const positionKey = [
    Math.round(position.getX(index) * precision),
    Math.round(position.getY(index) * precision),
    Math.round(position.getZ(index) * precision),
  ].join(",");

  return topologyId > 0 ? `${positionKey}#${topologyId}` : positionKey;
}

function ensureVertexTopologyIds(position: THREE.BufferAttribute) {
  const existing = vertexTopologyIdsByPosition.get(position);

  if (existing && existing.length === position.count) {
    return existing;
  }

  const topologyIds = new Uint32Array(position.count);

  vertexTopologyIdsByPosition.set(position, topologyIds);

  return topologyIds;
}

function getNextVertexTopologyId(position: THREE.BufferAttribute) {
  const topologyIds = ensureVertexTopologyIds(position);
  let nextTopologyId = 1;

  for (let index = 0; index < topologyIds.length; index += 1) {
    nextTopologyId = Math.max(nextTopologyId, topologyIds[index] + 1);
  }

  return nextTopologyId;
}

function getLooseEdgeKey(objectId: number, edgeKey: string) {
  return `${objectId}:${edgeKey}`;
}

function getSeparatedObjectColor(objectId: number) {
  if (objectId === defaultObjectId) {
    return defaultObjectColor.clone();
  }

  const color = new THREE.Color();
  const hue = (objectId * 0.61803398875) % 1;

  color.setHSL(hue, 0.72, 0.64);

  return color;
}

function getSeparatedObjectColorCss(objectId: number) {
  return `#${getSeparatedObjectColor(objectId).getHexString()}`;
}

function getDefaultSeparatedObjectLabel(objectId: number) {
  return objectId === defaultObjectId ? "Default" : `Object ${objectId}`;
}

function getSeparatedObjectLabel(objectId: number, objectNames: ObjectNameMap) {
  return objectNames[objectId]?.trim() || getDefaultSeparatedObjectLabel(objectId);
}

function getTriangleObjectIds(mesh: THREE.Mesh) {
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

function getTriangleObjectId(mesh: THREE.Mesh, triangleIndex: number) {
  return getTriangleObjectIds(mesh)?.[triangleIndex] ?? defaultObjectId;
}

function getTriangleObjectIdSet(mesh: THREE.Mesh) {
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

function refreshTriangleObjectIdAttribute(mesh: THREE.Mesh) {
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

function waitForBrowserPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function createThrottledProgressReporter(setProgress: (message: string) => void) {
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

function collectSeparatedObjects(
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

function getTriangleEdges(position: THREE.BufferAttribute) {
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const pointC = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const edgeFaces = new Map<string, TriangleEdgeFace[]>();
  const triangleEdgeKeys: string[][] = [];

  for (let index = 0; index < position.count; index += 3) {
    pointA.fromBufferAttribute(position, index);
    pointB.fromBufferAttribute(position, index + 1);
    pointC.fromBufferAttribute(position, index + 2);

    const normal = edgeA
      .subVectors(pointB, pointA)
      .cross(edgeB.subVectors(pointC, pointA))
      .normalize()
      .clone();
    const triangle = [
      { point: pointA.clone(), vertexKey: getVertexKey(position, index) },
      {
        point: pointB.clone(),
        vertexKey: getVertexKey(position, index + 1),
      },
      {
        point: pointC.clone(),
        vertexKey: getVertexKey(position, index + 2),
      },
    ];
    const edgeKeys = [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ].map(([start, end]) => {
      const key = [start.vertexKey, end.vertexKey].sort().join("|");
      const edgeFace = {
        direction: end.point.clone().sub(start.point).normalize(),
        normal,
      };
      const existing = edgeFaces.get(key);

      if (existing) {
        existing.push(edgeFace);
      } else {
        edgeFaces.set(key, [edgeFace]);
      }

      return key;
    });

    triangleEdgeKeys.push(edgeKeys);
  }

  return { edgeFaces, triangleEdgeKeys };
}

function getSignedEdgeNormalAngle(edgeFaces: TriangleEdgeFace[]) {
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

function getEdgeNormalAngle(edgeFaces: TriangleEdgeFace[]) {
  return Math.abs(getSignedEdgeNormalAngle(edgeFaces));
}

function createFaceMaterial(visible = true) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    roughness: 0.82,
    side: THREE.FrontSide,
    vertexColors: true,
  });

  material.visible = visible;

  return material;
}

function createSelectedObjectStencilMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      selectedObjectId: { value: -1 },
    },
    vertexShader: `
      attribute float objectId;
      varying float vObjectId;

      void main() {
        vObjectId = objectId;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float selectedObjectId;
      varying float vObjectId;

      void main() {
        if (abs(vObjectId - selectedObjectId) > 0.5) {
          discard;
        }

        gl_FragColor = vec4(1.0);
      }
    `,
    colorWrite: false,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  material.stencilWrite = true;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilRef = 1;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.ReplaceStencilOp;

  return material;
}

function createSelectedObjectOutlineMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      outlineColor: { value: new THREE.Color(selectedObjectOutlineColor) },
      outlinePixels: { value: selectedObjectOutlinePixels },
      resolution: { value: new THREE.Vector2(1, 1) },
      selectedObjectId: { value: -1 },
    },
    vertexShader: `
      attribute float objectId;
      uniform float outlinePixels;
      uniform vec2 resolution;
      varying float vObjectId;

      void main() {
        vObjectId = objectId;

        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 clipPosition = projectionMatrix * viewPosition;
        vec3 viewNormal = normalize(normalMatrix * normal);
        vec4 clipNormal = projectionMatrix * vec4(viewNormal, 0.0);
        vec2 direction = clipNormal.xy;
        float lengthSq = dot(direction, direction);

        if (lengthSq < 0.000001) {
          direction = clipPosition.xy;
          lengthSq = dot(direction, direction);
        }

        if (lengthSq > 0.000001) {
          direction = normalize(direction);
          clipPosition.xy += direction * outlinePixels * 2.0 * clipPosition.w / resolution;
        }

        gl_Position = clipPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 outlineColor;
      uniform float selectedObjectId;
      varying float vObjectId;

      void main() {
        if (abs(vObjectId - selectedObjectId) > 0.5) {
          discard;
        }

        gl_FragColor = vec4(outlineColor, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  material.depthFunc = THREE.LessDepth;
  material.stencilWrite = true;
  material.stencilWriteMask = 0x00;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilRef = 1;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.KeepStencilOp;

  return material;
}

function refreshMeshObjectMaterialGroups(mesh: THREE.Mesh, hiddenObjectIds: Set<number>) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);

  if (!(position instanceof THREE.BufferAttribute) || !objectIds || objectIds.length === 0) {
    return;
  }

  refreshTriangleObjectIdAttribute(mesh);

  const objectIdList = Array.from(new Set(objectIds)).sort((first, second) => first - second);
  const materialIndexByObjectId = new Map(objectIdList.map((objectId, index) => [objectId, index]));
  const materials = objectIdList.map((objectId) =>
    createFaceMaterial(!hiddenObjectIds.has(objectId)),
  );

  disposeMaterial(mesh.material);
  mesh.material = materials;
  mesh.geometry.clearGroups();

  let currentObjectId = objectIds[0] ?? defaultObjectId;
  let runStartTriangleIndex = 0;

  for (let triangleIndex = 1; triangleIndex <= objectIds.length; triangleIndex += 1) {
    const objectId = objectIds[triangleIndex] ?? null;

    if (objectId === currentObjectId) {
      continue;
    }

    mesh.geometry.addGroup(
      runStartTriangleIndex * 3,
      (triangleIndex - runStartTriangleIndex) * 3,
      materialIndexByObjectId.get(currentObjectId) ?? 0,
    );
    currentObjectId = objectId ?? defaultObjectId;
    runStartTriangleIndex = triangleIndex;
  }
}

function refreshObjectMaterialGroups(model: THREE.Object3D, hiddenObjectIds: Set<number>) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshMeshObjectMaterialGroups(child, hiddenObjectIds);
    }
  });
}

function styleModel(model: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  const overlays: Array<{ overlay: THREE.Object3D; parent: THREE.Object3D }> = [];

  model.traverse((child) => {
    if (isMesh(child)) {
      meshes.push(child);
    }
  });

  meshes.forEach((mesh) => {
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const position = geometry.getAttribute("position");

    if (!(position instanceof THREE.BufferAttribute)) {
      return;
    }

    if (!(geometry.getAttribute("normal") instanceof THREE.BufferAttribute)) {
      geometry.computeVertexNormals();
    }

    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(position.count * 3), 3),
    );
    geometry.userData.triangleObjectIds = new Uint32Array(Math.floor(position.count / 3));
    mesh.geometry = geometry;

    disposeMaterial(mesh.material);

    mesh.material = createFaceMaterial();
    refreshMeshObjectMaterialGroups(mesh, new Set<number>());

    const wireframe = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: wireframeColor,
        depthWrite: false,
        opacity: wireframeOpacity,
        transparent: true,
      }),
    );
    wireframe.position.copy(mesh.position);
    wireframe.quaternion.copy(mesh.quaternion);
    wireframe.scale.copy(mesh.scale);
    wireframe.matrix.copy(mesh.matrix);
    wireframe.matrixAutoUpdate = mesh.matrixAutoUpdate;
    wireframe.geometry = createObjectWireframeGeometry(mesh, new Set<number>());
    wireframe.name = "wireframe-overlay";
    wireframe.renderOrder = 1;
    wireframe.userData.isWireframeOverlay = true;
    wireframe.visible = true;
    mesh.userData.wireframeOverlay = wireframe;

    const obstructedLooseEdges = new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        linewidth: obstructedLooseEdgeLineWidth,
        opacity: obstructedLooseEdgeOpacity,
        transparent: true,
        vertexColors: true,
      }),
    );
    obstructedLooseEdges.name = "obstructed-loose-edge-overlay";
    obstructedLooseEdges.position.copy(mesh.position);
    obstructedLooseEdges.quaternion.copy(mesh.quaternion);
    obstructedLooseEdges.scale.copy(mesh.scale);
    obstructedLooseEdges.matrix.copy(mesh.matrix);
    obstructedLooseEdges.matrixAutoUpdate = mesh.matrixAutoUpdate;
    obstructedLooseEdges.renderOrder = 6;
    obstructedLooseEdges.userData.isLooseEdgeOverlay = true;
    obstructedLooseEdges.visible = false;
    mesh.userData.obstructedLooseEdgeOverlay = obstructedLooseEdges;

    const looseEdges = new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({
        color: 0xffffff,
        depthTest: true,
        depthWrite: false,
        linewidth: looseEdgeLineWidth,
        vertexColors: true,
      }),
    );
    looseEdges.name = "loose-edge-overlay";
    looseEdges.position.copy(mesh.position);
    looseEdges.quaternion.copy(mesh.quaternion);
    looseEdges.scale.copy(mesh.scale);
    looseEdges.matrix.copy(mesh.matrix);
    looseEdges.matrixAutoUpdate = mesh.matrixAutoUpdate;
    looseEdges.renderOrder = 7;
    looseEdges.userData.isLooseEdgeOverlay = true;
    looseEdges.visible = false;
    mesh.userData.looseEdgeOverlay = looseEdges;
    refreshLooseEdgeOverlay(mesh, new Set<number>(), null);

    const selectedObjectStencil = new THREE.Mesh(geometry, createSelectedObjectStencilMaterial());
    selectedObjectStencil.name = "selected-object-stencil-overlay";
    selectedObjectStencil.position.copy(mesh.position);
    selectedObjectStencil.quaternion.copy(mesh.quaternion);
    selectedObjectStencil.scale.copy(mesh.scale);
    selectedObjectStencil.matrix.copy(mesh.matrix);
    selectedObjectStencil.matrixAutoUpdate = mesh.matrixAutoUpdate;
    selectedObjectStencil.renderOrder = selectedObjectStencilRenderOrder;
    selectedObjectStencil.userData.isSelectedObjectStencilOverlay = true;
    selectedObjectStencil.visible = false;
    mesh.userData.selectedObjectStencilOverlay = selectedObjectStencil;

    const selectedObjectOutline = new THREE.Mesh(geometry, createSelectedObjectOutlineMaterial());
    selectedObjectOutline.name = "selected-object-outline-overlay";
    selectedObjectOutline.position.copy(mesh.position);
    selectedObjectOutline.quaternion.copy(mesh.quaternion);
    selectedObjectOutline.scale.copy(mesh.scale);
    selectedObjectOutline.matrix.copy(mesh.matrix);
    selectedObjectOutline.matrixAutoUpdate = mesh.matrixAutoUpdate;
    selectedObjectOutline.renderOrder = selectedObjectOutlineRenderOrder;
    selectedObjectOutline.userData.isSelectedObjectOutlineOverlay = true;
    selectedObjectOutline.visible = false;
    mesh.userData.selectedObjectOutlineOverlay = selectedObjectOutline;
    refreshSelectedObjectOutlineOverlay(mesh, new Set<number>(), null);

    const hoverEdge = new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({
        color: hoverEdgeColor,
        depthTest: false,
        depthWrite: false,
        linewidth: hoverEdgeLineWidth,
      }),
    );
    hoverEdge.name = "hover-edge-overlay";
    hoverEdge.position.copy(mesh.position);
    hoverEdge.quaternion.copy(mesh.quaternion);
    hoverEdge.scale.copy(mesh.scale);
    hoverEdge.matrix.copy(mesh.matrix);
    hoverEdge.matrixAutoUpdate = mesh.matrixAutoUpdate;
    hoverEdge.renderOrder = hoverEdgeRenderOrder;
    hoverEdge.userData.isHoverEdgeOverlay = true;
    hoverEdge.visible = false;
    mesh.userData.hoverEdgeOverlay = hoverEdge;

    overlays.push({
      overlay: wireframe,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: obstructedLooseEdges,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: looseEdges,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: selectedObjectStencil,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: selectedObjectOutline,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: hoverEdge,
      parent: mesh.parent ?? model,
    });
  });

  overlays.forEach(({ parent, overlay }) => {
    parent.add(overlay);
  });
}

function createObjectWireframeGeometry(mesh: THREE.Mesh, hiddenObjectIds: Set<number>) {
  const geometry = new THREE.BufferGeometry();
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const segmentPositions: number[] = [];

  if (!(position instanceof THREE.BufferAttribute)) {
    return geometry;
  }

  for (let index = 0; index < position.count; index += 3) {
    const triangleIndex = index / 3;
    const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;

    if (hiddenObjectIds.has(objectId)) {
      continue;
    }

    const ax = position.getX(index);
    const ay = position.getY(index);
    const az = position.getZ(index);
    const bx = position.getX(index + 1);
    const by = position.getY(index + 1);
    const bz = position.getZ(index + 1);
    const cx = position.getX(index + 2);
    const cy = position.getY(index + 2);
    const cz = position.getZ(index + 2);

    segmentPositions.push(ax, ay, az, bx, by, bz, bx, by, bz, cx, cy, cz, cx, cy, cz, ax, ay, az);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(segmentPositions, 3));

  return geometry;
}

function refreshObjectWireframe(mesh: THREE.Mesh, hiddenObjectIds: Set<number>) {
  const wireframe = mesh.userData.wireframeOverlay as THREE.LineSegments | undefined;

  if (!wireframe) {
    return;
  }

  wireframe.geometry.dispose();
  wireframe.geometry = createObjectWireframeGeometry(mesh, hiddenObjectIds);

  const position = wireframe.geometry.getAttribute("position");

  wireframe.visible = position instanceof THREE.BufferAttribute && position.count > 0;
}

function refreshObjectWireframes(model: THREE.Object3D, hiddenObjectIds: Set<number>) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshObjectWireframe(child, hiddenObjectIds);
    }
  });
}

function refreshSelectedObjectOutlineOverlay(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
) {
  const stencil = mesh.userData.selectedObjectStencilOverlay as THREE.Mesh | undefined;
  const outline = mesh.userData.selectedObjectOutlineOverlay as THREE.Mesh | undefined;
  const objectIdSet = getTriangleObjectIdSet(mesh);
  const isVisible =
    selectedObjectId != null &&
    !hiddenObjectIds.has(selectedObjectId) &&
    objectIdSet.has(selectedObjectId);

  [stencil, outline].forEach((overlay) => {
    if (!overlay) {
      return;
    }

    overlay.visible = isVisible;

    if (overlay.material instanceof THREE.ShaderMaterial) {
      overlay.material.uniforms.selectedObjectId.value = selectedObjectId ?? -1;
    }
  });
}

function refreshSelectedObjectOutlines(
  model: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshSelectedObjectOutlineOverlay(child, hiddenObjectIds, selectedObjectId);
    }
  });
}

function createLooseEdgeGeometry(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
) {
  const geometry = new LineSegmentsGeometry();
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const edgeSegments = new Map<
    string,
    {
      count: number;
      end: THREE.Vector3;
      endKey: string;
      edgeKey: string;
      normal: THREE.Vector3;
      objectId: number;
      start: THREE.Vector3;
      startKey: string;
    }
  >();

  if (!(position instanceof THREE.BufferAttribute)) {
    geometry.userData.segmentCount = 0;
    mesh.userData.looseEdgeKeys = new Set<string>();
    mesh.userData.looseEdgeKeysByVertexKey = new Map<string, Set<string>>();
    mesh.userData.looseEdgeLoopById = new Map<number, LooseEdgeLoop>();
    mesh.userData.looseEdgeSegmentsByKey = new Map<string, LooseEdgeSegment>();
    return geometry;
  }

  for (let index = 0; index < position.count; index += 3) {
    const triangleIndex = index / 3;
    const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;

    const vertices = [
      {
        key: getVertexKey(position, index),
        point: new THREE.Vector3().fromBufferAttribute(position, index),
      },
      {
        key: getVertexKey(position, index + 1),
        point: new THREE.Vector3().fromBufferAttribute(position, index + 1),
      },
      {
        key: getVertexKey(position, index + 2),
        point: new THREE.Vector3().fromBufferAttribute(position, index + 2),
      },
    ];
    const normal = getTriangleNormal(vertices).normalize();

    [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ].forEach(([start, end]) => {
      const edgeKey = [start.key, end.key].sort().join("|");
      const key = getLooseEdgeKey(objectId, edgeKey);
      const existing = edgeSegments.get(key);

      if (existing) {
        existing.count += 1;
        return;
      }

      edgeSegments.set(key, {
        count: 1,
        end: end.point,
        endKey: end.key,
        edgeKey,
        normal: normal.clone(),
        objectId,
        start: start.point,
        startKey: start.key,
      });
    });
  }

  const segmentPositions: number[] = [];
  const segmentColors: number[] = [];
  const looseEdgeKeys = new Set<string>();
  const looseEdgeKeysByVertexKey = new Map<string, Set<string>>();
  const looseEdgeLoopById = new Map<number, LooseEdgeLoop>();
  const looseEdgeSegmentsByKey = new Map<string, LooseEdgeSegment>();
  const looseEdgeRenderCacheSourceByObjectId = new Map<
    number,
    { colors: number[]; positions: number[] }
  >();
  const red = new THREE.Color(looseEdgeColor);

  edgeSegments.forEach((edge, key) => {
    if (edge.count !== 1) {
      return;
    }

    const shouldRenderSegment =
      selectedObjectId != null &&
      !hiddenObjectIds.has(selectedObjectId) &&
      edge.objectId === selectedObjectId;
    const segmentIndex = shouldRenderSegment ? segmentPositions.length / 6 : -1;

    looseEdgeKeys.add(key);
    looseEdgeSegmentsByKey.set(key, {
      end: edge.end,
      endKey: edge.endKey,
      edgeKey: edge.edgeKey,
      index: segmentIndex,
      loopId: -1,
      normal: edge.normal,
      objectId: edge.objectId,
      start: edge.start,
      startKey: edge.startKey,
    });

    [edge.startKey, edge.endKey].forEach((vertexKey) => {
      const connectedKeys = looseEdgeKeysByVertexKey.get(vertexKey);

      if (connectedKeys) {
        connectedKeys.add(key);
      } else {
        looseEdgeKeysByVertexKey.set(vertexKey, new Set([key]));
      }
    });

    let renderCacheSource = looseEdgeRenderCacheSourceByObjectId.get(edge.objectId);

    if (!renderCacheSource) {
      renderCacheSource = { colors: [], positions: [] };
      looseEdgeRenderCacheSourceByObjectId.set(edge.objectId, renderCacheSource);
    }

    renderCacheSource.positions.push(
      edge.start.x,
      edge.start.y,
      edge.start.z,
      edge.end.x,
      edge.end.y,
      edge.end.z,
    );
    renderCacheSource.colors.push(red.r, red.g, red.b, red.r, red.g, red.b);

    if (shouldRenderSegment) {
      segmentPositions.push(
        edge.start.x,
        edge.start.y,
        edge.start.z,
        edge.end.x,
        edge.end.y,
        edge.end.z,
      );
      segmentColors.push(red.r, red.g, red.b, red.r, red.g, red.b);
    }
  });

  const looseEdgeRenderCacheByObjectId = new Map<number, LooseEdgeRenderCache>();

  looseEdgeRenderCacheSourceByObjectId.forEach((cache, objectId) => {
    looseEdgeRenderCacheByObjectId.set(objectId, {
      colors: new Float32Array(cache.colors),
      positions: new Float32Array(cache.positions),
      segmentCount: cache.positions.length / 6,
    });
  });

  let nextLoopId = 0;

  looseEdgeSegmentsByKey.forEach((seedSegment, seedKey) => {
    if (seedSegment.loopId >= 0) {
      return;
    }

    const loopId = nextLoopId;
    const loopPositions: number[] = [];
    const pendingKeys = [seedKey];
    const segmentIndexes: number[] = [];
    const segmentKeys: string[] = [];

    nextLoopId += 1;

    while (pendingKeys.length > 0) {
      const key = pendingKeys.pop();

      if (!key) {
        continue;
      }

      const segment = looseEdgeSegmentsByKey.get(key);

      if (!segment || segment.loopId >= 0) {
        continue;
      }

      segment.loopId = loopId;
      segmentKeys.push(key);
      if (segment.index >= 0) {
        segmentIndexes.push(segment.index);
      }
      loopPositions.push(
        segment.start.x,
        segment.start.y,
        segment.start.z,
        segment.end.x,
        segment.end.y,
        segment.end.z,
      );

      [segment.startKey, segment.endKey].forEach((vertexKey) => {
        looseEdgeKeysByVertexKey.get(vertexKey)?.forEach((connectedKey) => {
          const connectedSegment = looseEdgeSegmentsByKey.get(connectedKey);

          if (connectedSegment && connectedSegment.loopId < 0) {
            pendingKeys.push(connectedKey);
          }
        });
      });
    }

    looseEdgeLoopById.set(loopId, {
      id: loopId,
      objectId: seedSegment.objectId,
      positions: new Float32Array(loopPositions),
      segmentIndexes,
      segmentKeys,
    });
  });

  geometry.setPositions(segmentPositions);
  geometry.setColors(segmentColors);
  geometry.userData.segmentCount = segmentPositions.length / 6;
  mesh.userData.looseEdgeKeys = looseEdgeKeys;
  mesh.userData.looseEdgeKeysByVertexKey = looseEdgeKeysByVertexKey;
  mesh.userData.looseEdgeLoopById = looseEdgeLoopById;
  mesh.userData.looseEdgeRenderCacheByObjectId = looseEdgeRenderCacheByObjectId;
  mesh.userData.looseEdgeSegmentsByKey = looseEdgeSegmentsByKey;

  return geometry;
}

function createLooseEdgeRenderGeometryFromCache(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
) {
  const geometry = new LineSegmentsGeometry();
  const renderCacheByObjectId = mesh.userData.looseEdgeRenderCacheByObjectId as
    | Map<number, LooseEdgeRenderCache>
    | undefined;
  const segmentsByKey = mesh.userData.looseEdgeSegmentsByKey as
    | Map<string, LooseEdgeSegment>
    | undefined;
  const loopsById = mesh.userData.looseEdgeLoopById as Map<number, LooseEdgeLoop> | undefined;

  if (selectedObjectId == null || hiddenObjectIds.has(selectedObjectId)) {
    geometry.userData.segmentCount = 0;
    return geometry;
  }

  const renderCache = renderCacheByObjectId?.get(selectedObjectId);

  if (renderCacheByObjectId instanceof Map) {
    if (renderCache) {
      geometry.setPositions(renderCache.positions);
      geometry.setColors(renderCache.colors);
      geometry.userData.segmentCount = renderCache.segmentCount;
      return geometry;
    }

    geometry.userData.segmentCount = 0;
    return geometry;
  }

  if (!(segmentsByKey instanceof Map) || !(loopsById instanceof Map)) {
    geometry.userData.segmentCount = 0;
    return geometry;
  }

  return createLooseEdgeGeometry(mesh, hiddenObjectIds, selectedObjectId);
}

function refreshLooseEdgeOverlay(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
  rebuildCache = true,
) {
  const looseEdgeOverlays = [
    mesh.userData.obstructedLooseEdgeOverlay as LineSegments2 | undefined,
    mesh.userData.looseEdgeOverlay as LineSegments2 | undefined,
  ];
  const hasLooseEdgeCache = mesh.userData.looseEdgeSegmentsByKey instanceof Map;
  const geometry =
    rebuildCache || !hasLooseEdgeCache
      ? createLooseEdgeGeometry(mesh, hiddenObjectIds, selectedObjectId)
      : createLooseEdgeRenderGeometryFromCache(mesh, hiddenObjectIds, selectedObjectId);
  const segmentCount = geometry.userData.segmentCount ?? 0;

  looseEdgeOverlays.forEach((looseEdges, index) => {
    if (!looseEdges) {
      return;
    }

    looseEdges.geometry.dispose();
    looseEdges.geometry = index === 0 ? geometry : geometry.clone();
    looseEdges.geometry.userData.segmentCount = segmentCount;
    looseEdges.visible = segmentCount > 0;
  });
}

function refreshLooseEdgeOverlays(
  model: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
  rebuildCache = true,
) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshLooseEdgeOverlay(child, hiddenObjectIds, selectedObjectId, rebuildCache);
    }
  });
}

function colorTriangle(
  color: THREE.BufferAttribute,
  startIndex: number,
  triangleColor: THREE.Color,
) {
  color.setXYZ(startIndex, triangleColor.r, triangleColor.g, triangleColor.b);
  color.setXYZ(startIndex + 1, triangleColor.r, triangleColor.g, triangleColor.b);
  color.setXYZ(startIndex + 2, triangleColor.r, triangleColor.g, triangleColor.b);
}

function getTriangleVertices(position: THREE.BufferAttribute, startIndex: number) {
  if (startIndex < 0 || startIndex + 2 >= position.count) {
    return null;
  }

  return [startIndex, startIndex + 1, startIndex + 2].map((index) => ({
    key: getVertexKey(position, index),
    point: new THREE.Vector3().fromBufferAttribute(position, index),
  }));
}

function getTriangleNormal(vertices: TriangleVertex[]) {
  return new THREE.Vector3()
    .subVectors(vertices[1].point, vertices[0].point)
    .cross(new THREE.Vector3().subVectors(vertices[2].point, vertices[0].point));
}

function orientTriangle(vertices: TriangleVertex[], referenceNormal: THREE.Vector3) {
  const normal = getTriangleNormal(vertices);

  if (normal.lengthSq() === 0 || referenceNormal.lengthSq() === 0) {
    return vertices;
  }

  if (normal.dot(referenceNormal) >= 0) {
    return vertices;
  }

  return [vertices[0], vertices[2], vertices[1]];
}

function setTrianglePositions(
  position: THREE.BufferAttribute,
  startIndex: number,
  vertices: TriangleVertex[],
) {
  vertices.forEach((vertex, offset) => {
    position.setXYZ(startIndex + offset, vertex.point.x, vertex.point.y, vertex.point.z);
  });
}

function getTriangleEdgeKeys(vertices: TriangleVertex[]) {
  return [
    [0, 1],
    [1, 2],
    [2, 0],
  ].map(([start, end]) => [vertices[start].key, vertices[end].key].sort().join("|"));
}

function getTriangleEdgeFace(vertices: TriangleVertex[], edgeKey: string) {
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

function getLooseEdgeLoop(mesh: THREE.Mesh, loopId: number | undefined) {
  const loopsById = mesh.userData.looseEdgeLoopById;

  if (loopId == null || !(loopsById instanceof Map)) {
    return null;
  }

  return (loopsById.get(loopId) as LooseEdgeLoop | undefined) ?? null;
}

function isSameLooseEdgeLoop(first: HoveredEdge | null, second: HoveredEdge | null) {
  return (
    first?.isLooseEdge === true &&
    second?.isLooseEdge === true &&
    first.mesh === second.mesh &&
    first.objectId === second.objectId &&
    first.loopId === second.loopId
  );
}

function setLooseEdgeLoopColor(mesh: THREE.Mesh, loopId: number | undefined, colorValue: number) {
  const loop = getLooseEdgeLoop(mesh, loopId);

  if (!loop) {
    return;
  }

  const color = new THREE.Color(colorValue);
  const overlays = [
    mesh.userData.obstructedLooseEdgeOverlay as LineSegments2 | undefined,
    mesh.userData.looseEdgeOverlay as LineSegments2 | undefined,
  ];

  overlays.forEach((overlay) => {
    if (!overlay) {
      return;
    }

    const startColor = overlay.geometry.getAttribute("instanceColorStart");
    const endColor = overlay.geometry.getAttribute("instanceColorEnd");

    if (!startColor || !endColor) {
      return;
    }

    loop.segmentIndexes.forEach((segmentIndex) => {
      startColor.setXYZ(segmentIndex, color.r, color.g, color.b);
      endColor.setXYZ(segmentIndex, color.r, color.g, color.b);
    });

    startColor.needsUpdate = true;
    endColor.needsUpdate = true;
  });
}

function getScreenPoint(
  point: THREE.Vector3,
  camera: THREE.Camera,
  viewport: Pick<DOMRect, "height" | "left" | "top" | "width">,
) {
  const projected = point.clone().project(camera);

  if (projected.z < -1 || projected.z > 1) {
    return null;
  }

  return {
    x: viewport.left + ((projected.x + 1) / 2) * viewport.width,
    y: viewport.top + ((1 - projected.y) / 2) * viewport.height,
  };
}

function getPointToSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSq = deltaX * deltaX + deltaY * deltaY;

  if (lengthSq === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const t = THREE.MathUtils.clamp(
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSq,
    0,
    1,
  );
  const closestX = startX + deltaX * t;
  const closestY = startY + deltaY * t;

  return Math.hypot(pointX - closestX, pointY - closestY);
}

function createHoverEdgeGeometry(edge: HoveredEdge) {
  const geometry = new LineSegmentsGeometry();
  const loop = edge.isLooseEdge ? getLooseEdgeLoop(edge.mesh, edge.loopId) : null;
  const segmentPositions: number[] = [];

  if (edge.boundaryPositions) {
    geometry.setPositions(edge.boundaryPositions);

    return geometry;
  }

  if (loop) {
    geometry.setPositions(loop.positions);

    return geometry;
  }

  segmentPositions.push(
    edge.start.x,
    edge.start.y,
    edge.start.z,
    edge.end.x,
    edge.end.y,
    edge.end.z,
  );

  geometry.setPositions(segmentPositions);

  return geometry;
}

function clearHoverEdgeOverlay(edge: HoveredEdge | null) {
  const hoverEdge = edge?.mesh.userData.hoverEdgeOverlay as LineSegments2 | undefined;

  if (hoverEdge) {
    hoverEdge.visible = false;
  }
}

function setHoverEdgeOverlay(edge: HoveredEdge) {
  const hoverEdge = edge.mesh.userData.hoverEdgeOverlay as LineSegments2 | undefined;
  const isLoopHover = edge.isLooseEdge === true || edge.isSelectionBoundary === true;

  if (!hoverEdge) {
    return;
  }

  hoverEdge.geometry.dispose();
  hoverEdge.geometry = createHoverEdgeGeometry(edge);
  hoverEdge.renderOrder = isLoopHover ? looseEdgeHoverRenderOrder : hoverEdgeRenderOrder;

  if (hoverEdge.material instanceof LineMaterial) {
    hoverEdge.material.depthTest = false;
    hoverEdge.material.color.setHex(isLoopHover ? looseEdgeHoverColor : hoverEdgeColor);
    hoverEdge.material.linewidth = isLoopHover ? looseEdgeUiOverlayLineWidth : hoverEdgeLineWidth;
  }

  hoverEdge.visible = true;
}

function createLooseEdgeLoopOverlay(edge: HoveredEdge, colorValue: number) {
  const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);

  if (!loop || loop.positions.length === 0) {
    return null;
  }

  const geometry = new LineSegmentsGeometry();

  geometry.setPositions(loop.positions);

  const overlay = new LineSegments2(
    geometry,
    new LineMaterial({
      color: colorValue,
      depthTest: false,
      depthWrite: false,
      linewidth: looseEdgeUiOverlayLineWidth,
    }),
  );
  const hoverOverlay = edge.mesh.userData.hoverEdgeOverlay as LineSegments2 | undefined;

  overlay.name = "selected-loose-edge-loop-overlay";
  overlay.position.copy(edge.mesh.position);
  overlay.quaternion.copy(edge.mesh.quaternion);
  overlay.scale.copy(edge.mesh.scale);
  overlay.matrix.copy(edge.mesh.matrix);
  overlay.matrixAutoUpdate = edge.mesh.matrixAutoUpdate;
  overlay.renderOrder = looseEdgeHoverRenderOrder;
  overlay.userData.isLooseEdgeSelectionOverlay = true;

  if (hoverOverlay?.material instanceof LineMaterial && overlay.material instanceof LineMaterial) {
    overlay.material.resolution.copy(hoverOverlay.material.resolution);
  }

  return overlay;
}

function getLoopFillPointKey(point: THREE.Vector3) {
  const precision = 100000;

  return [
    Math.round(point.x * precision),
    Math.round(point.y * precision),
    Math.round(point.z * precision),
  ].join(",");
}

function getLooseEdgeLoopCacheKey(mesh: THREE.Mesh, loop: LooseEdgeLoop) {
  return `${mesh.uuid}:${[...loop.segmentKeys].sort().join("~")}`;
}

function getLooseEdgeLoopFillKey(edge: HoveredEdge) {
  const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);

  return loop
    ? getLooseEdgeLoopCacheKey(edge.mesh, loop)
    : `${edge.mesh.uuid}:${edge.objectId}:${edge.loopId ?? -1}`;
}

function getMeshObjectLocalCenter(mesh: THREE.Mesh, objectId: number) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const center = new THREE.Vector3();
  let vertexCount = 0;

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  for (let index = 0; index < position.count; index += 3) {
    const triangleIndex = index / 3;

    if ((objectIds?.[triangleIndex] ?? defaultObjectId) !== objectId) {
      continue;
    }

    center.add(new THREE.Vector3().fromBufferAttribute(position, index));
    center.add(new THREE.Vector3().fromBufferAttribute(position, index + 1));
    center.add(new THREE.Vector3().fromBufferAttribute(position, index + 2));
    vertexCount += 3;
  }

  return vertexCount > 0 ? center.multiplyScalar(1 / vertexCount) : null;
}

function getMeshObjectProjectionSize(mesh: THREE.Mesh, objectId: number, axis: THREE.Vector3) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const point = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;

  if (!(position instanceof THREE.BufferAttribute)) {
    return 0;
  }

  for (let index = 0; index < position.count; index += 3) {
    const triangleIndex = index / 3;

    if ((objectIds?.[triangleIndex] ?? defaultObjectId) !== objectId) {
      continue;
    }

    for (let offset = 0; offset < 3; offset += 1) {
      point.fromBufferAttribute(position, index + offset);

      const projection = point.dot(axis);

      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) ? Math.max(max - min, 0) : 0;
}

function pushLoopFillTriangle(
  vertices: number[],
  first: THREE.Vector3,
  second: THREE.Vector3,
  third: THREE.Vector3,
  desiredNormal: THREE.Vector3 | null,
) {
  const triangleNormal = second.clone().sub(first).cross(third.clone().sub(first));

  if (triangleNormal.lengthSq() === 0) {
    return;
  }

  const shouldFlip =
    desiredNormal != null && desiredNormal.lengthSq() > 0
      ? triangleNormal.dot(desiredNormal) < 0
      : false;
  const orderedPoints = shouldFlip ? [first, third, second] : [first, second, third];

  orderedPoints.forEach((point) => {
    vertices.push(point.x, point.y, point.z);
  });
}

function createLoopFillGeometry(vertices: number[]) {
  if (vertices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

function getLoopTriangleOutwardNormal(
  first: THREE.Vector3,
  second: THREE.Vector3,
  third: THREE.Vector3,
  objectCenter: THREE.Vector3 | null,
) {
  if (!objectCenter) {
    return null;
  }

  return first
    .clone()
    .add(second)
    .add(third)
    .multiplyScalar(1 / 3)
    .sub(objectCenter);
}

function getLooseEdgeLoopFillData(edge: HoveredEdge): LooseEdgeLoopFillData | null {
  const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);
  const segmentsByKey = edge.mesh.userData.looseEdgeSegmentsByKey as
    | Map<string, LooseEdgeSegment>
    | undefined;

  if (!loop || loop.positions.length === 0) {
    return null;
  }

  const pointIndexByKey = new Map<string, number>();
  const points: THREE.Vector3[] = [];
  const segments: LooseEdgeLoopFillSegment[] = [];

  const getPointIndex = (point: THREE.Vector3) => {
    const key = getLoopFillPointKey(point);
    const existingIndex = pointIndexByKey.get(key);

    if (existingIndex != null) {
      return existingIndex;
    }

    const pointIndex = points.length;

    points.push(point.clone());
    pointIndexByKey.set(key, pointIndex);

    return pointIndex;
  };

  for (let index = 0; index < loop.positions.length; index += 6) {
    const start = new THREE.Vector3(
      loop.positions[index],
      loop.positions[index + 1],
      loop.positions[index + 2],
    );
    const end = new THREE.Vector3(
      loop.positions[index + 3],
      loop.positions[index + 4],
      loop.positions[index + 5],
    );

    if (start.distanceToSquared(end) === 0) {
      continue;
    }

    segments.push({
      end,
      endIndex: getPointIndex(end),
      start,
      startIndex: getPointIndex(start),
    });
  }

  if (points.length < 3 || segments.length === 0) {
    return null;
  }

  const center = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  const referenceNormal = new THREE.Vector3();
  const outsideNormal = new THREE.Vector3();
  const objectCenter = getMeshObjectLocalCenter(edge.mesh, edge.objectId);

  if (objectCenter) {
    outsideNormal.subVectors(center, objectCenter);
  }

  if (segmentsByKey instanceof Map) {
    loop.segmentKeys.forEach((key) => {
      const segment = segmentsByKey.get(key);

      if (segment) {
        referenceNormal.add(segment.normal);
      }
    });
  }

  if (referenceNormal.lengthSq() > 0 && outsideNormal.lengthSq() > 0) {
    if (referenceNormal.dot(outsideNormal) < 0) {
      referenceNormal.negate();
    }
  }

  if (referenceNormal.lengthSq() === 0 && outsideNormal.lengthSq() > 0) {
    referenceNormal.copy(outsideNormal);
  }

  if (referenceNormal.lengthSq() === 0) {
    segments.forEach((segment) => {
      referenceNormal.add(segment.start.clone().sub(center).cross(segment.end.clone().sub(center)));
    });
  }

  if (referenceNormal.lengthSq() > 0 && outsideNormal.lengthSq() > 0) {
    if (referenceNormal.dot(outsideNormal) < 0) {
      referenceNormal.negate();
    }
  }

  if (referenceNormal.lengthSq() > 0) {
    referenceNormal.normalize();
  }

  return {
    center,
    objectCenter,
    points,
    referenceNormal,
    segments,
  };
}

function getLooseEdgeLoopCapAxisData(
  edge: HoveredEdge,
  mode: LooseEdgeLoopMode,
  normalTarget: THREE.Vector3 | null = null,
): LooseEdgeLoopCapAxisData | null {
  const data = getLooseEdgeLoopFillData(edge);

  if (!data || mode === "none") {
    return null;
  }

  let axis: THREE.Vector3 | null;

  if (isNormalTargetLoopMode(mode) && normalTarget) {
    axis = normalTarget.clone().sub(data.center);

    if (axis.lengthSq() < 0.000001) {
      axis = getLooseEdgeLoopExtrusionAxis(mode, data);
    }
  } else if (mode === "fill") {
    axis = data.referenceNormal.clone();
  } else {
    axis = getLooseEdgeLoopExtrusionAxis(mode, data);
  }

  if (!axis || axis.lengthSq() === 0) {
    return null;
  }

  axis.normalize();

  const projectionSize = getMeshObjectProjectionSize(edge.mesh, edge.objectId, axis);
  const loopSize = new THREE.Box3().setFromPoints(data.points).getSize(new THREE.Vector3());
  const fallbackOffset = Math.max(loopSize.x, loopSize.y, loopSize.z, targetModelSize * 0.05);

  return {
    axis,
    data,
    defaultOffset:
      mode === "fill" ? 0 : projectionSize > 0.000001 ? projectionSize : fallbackOffset,
  };
}

function getLooseEdgeLoopCapOffsetBounds(
  edge: HoveredEdge,
  mode: LooseEdgeLoopMode,
  axisData: LooseEdgeLoopCapAxisData,
) {
  const projectionSize = getMeshObjectProjectionSize(edge.mesh, edge.objectId, axisData.axis);
  const span = Math.max(
    projectionSize,
    Math.abs(axisData.defaultOffset),
    targetModelSize * 0.25,
    0.1,
  );

  return mode === "fill"
    ? { max: span, min: -span }
    : { max: Math.max(span * 2, axisData.defaultOffset), min: 0.001 };
}

function clampLooseEdgeLoopCapOffset(
  edge: HoveredEdge,
  mode: LooseEdgeLoopMode,
  offset: number,
  normalTarget: THREE.Vector3 | null = null,
) {
  const axisData = getLooseEdgeLoopCapAxisData(edge, mode, normalTarget);

  if (!axisData) {
    return offset;
  }

  const bounds = getLooseEdgeLoopCapOffsetBounds(edge, mode, axisData);

  return THREE.MathUtils.clamp(offset, bounds.min, bounds.max);
}

function createLooseEdgeLoopFlatFillGeometry(
  data: LooseEdgeLoopFillData,
  axis: THREE.Vector3,
  capOffset: number,
) {
  const vertices: number[] = [];
  const desiredNormal = axis.lengthSq() > 0 ? axis : null;
  const capCenter = data.center.clone().addScaledVector(axis, capOffset);

  data.segments.forEach((segment) => {
    pushLoopFillTriangle(
      vertices,
      capCenter,
      segment.start.clone().addScaledVector(axis, capOffset),
      segment.end.clone().addScaledVector(axis, capOffset),
      desiredNormal,
    );
  });

  return createLoopFillGeometry(vertices);
}

function getLooseEdgeLoopExtrusionAxis(mode: LooseEdgeLoopMode, data: LooseEdgeLoopFillData) {
  const axis = new THREE.Vector3();

  if (mode === "extrude-x" || mode === "cylinder-x") {
    axis.set(1, 0, 0);
  } else if (mode === "extrude-y" || mode === "cylinder-y") {
    axis.set(0, 1, 0);
  } else if (mode === "extrude-z" || mode === "cylinder-z") {
    axis.set(0, 0, 1);
  } else if (mode === "extrude-normal" || mode === "cylinder-normal") {
    axis.copy(data.referenceNormal);
  }

  if (axis.lengthSq() === 0 && data.objectCenter) {
    axis.subVectors(data.center, data.objectCenter);
  }

  if (axis.lengthSq() === 0) {
    return null;
  }

  axis.normalize();

  if (data.objectCenter && axis.dot(data.center.clone().sub(data.objectCenter)) < 0) {
    axis.negate();
  }

  return axis;
}

function createLooseEdgeLoopExtrusionGeometry(
  data: LooseEdgeLoopFillData,
  axis: THREE.Vector3,
  capOffset: number,
) {
  if (axis.lengthSq() === 0) {
    return null;
  }

  const extrusionLength = capOffset;

  if (extrusionLength <= 0) {
    return null;
  }

  const vertices: number[] = [];
  const capCenter = data.center.clone().addScaledVector(axis, extrusionLength);
  const capPoints = data.points.map((point) => {
    const capPoint = point.clone().addScaledVector(axis, extrusionLength);
    const planeDistance = capPoint.clone().sub(capCenter).dot(axis);

    return capPoint.addScaledVector(axis, -planeDistance);
  });

  data.segments.forEach((segment) => {
    const capStart = capPoints[segment.startIndex];
    const capEnd = capPoints[segment.endIndex];

    if (!capStart || !capEnd) {
      return;
    }

    pushLoopFillTriangle(
      vertices,
      segment.start,
      segment.end,
      capEnd,
      getLoopTriangleOutwardNormal(segment.start, segment.end, capEnd, data.objectCenter),
    );
    pushLoopFillTriangle(
      vertices,
      segment.start,
      capEnd,
      capStart,
      getLoopTriangleOutwardNormal(segment.start, capEnd, capStart, data.objectCenter),
    );
    pushLoopFillTriangle(vertices, capCenter, capStart, capEnd, axis);
  });

  return createLoopFillGeometry(vertices);
}

function getLooseEdgeLoopCylinderRadius(data: LooseEdgeLoopFillData) {
  const minRadius = data.points.reduce(
    (radius, point) => Math.min(radius, point.distanceTo(data.center)),
    Number.POSITIVE_INFINITY,
  );

  return Number.isFinite(minRadius) && minRadius > 0
    ? minRadius * looseEdgeLoopCylinderRadiusScale
    : 0;
}

function getPerpendicularBasis(axis: THREE.Vector3) {
  const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();

  return { bitangent, tangent };
}

function createLooseEdgeLoopCylinderGeometry(
  data: LooseEdgeLoopFillData,
  axis: THREE.Vector3,
  capOffset: number,
) {
  if (axis.lengthSq() === 0) {
    return null;
  }

  const vertices: number[] = [];
  const capNormal = data.referenceNormal.lengthSq() > 0 ? data.referenceNormal : axis;

  data.segments.forEach((segment) => {
    pushLoopFillTriangle(vertices, data.center, segment.start, segment.end, capNormal);
  });

  if (capOffset <= 0) {
    return createLoopFillGeometry(vertices);
  }

  const radius = getLooseEdgeLoopCylinderRadius(data);

  if (radius <= 0) {
    return createLoopFillGeometry(vertices);
  }

  const { bitangent, tangent } = getPerpendicularBasis(axis);
  const topCenter = data.center.clone().addScaledVector(axis, capOffset);
  const basePoints: THREE.Vector3[] = [];
  const topPoints: THREE.Vector3[] = [];
  const radialDirections: THREE.Vector3[] = [];

  for (let index = 0; index < looseEdgeLoopCylinderSegments; index += 1) {
    const angle = (index / looseEdgeLoopCylinderSegments) * Math.PI * 2;
    const radialDirection = tangent
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(bitangent, Math.sin(angle))
      .normalize();
    const basePoint = data.center.clone().addScaledVector(radialDirection, radius);

    radialDirections.push(radialDirection);
    basePoints.push(basePoint);
    topPoints.push(basePoint.clone().addScaledVector(axis, capOffset));
  }

  for (let index = 0; index < looseEdgeLoopCylinderSegments; index += 1) {
    const nextIndex = (index + 1) % looseEdgeLoopCylinderSegments;
    const baseStart = basePoints[index];
    const baseEnd = basePoints[nextIndex];
    const topStart = topPoints[index];
    const topEnd = topPoints[nextIndex];
    const sideNormal = radialDirections[index].clone().add(radialDirections[nextIndex]).normalize();

    if (!baseStart || !baseEnd || !topStart || !topEnd) {
      continue;
    }

    pushLoopFillTriangle(vertices, baseStart, baseEnd, topEnd, sideNormal);
    pushLoopFillTriangle(vertices, baseStart, topEnd, topStart, sideNormal);
    pushLoopFillTriangle(vertices, topCenter, topStart, topEnd, axis);
  }

  return createLoopFillGeometry(vertices);
}

function createLooseEdgeLoopFill(
  edge: HoveredEdge,
  mode: LooseEdgeLoopMode,
  capOffset: number,
  normalTarget: THREE.Vector3 | null = null,
) {
  const axisData = getLooseEdgeLoopCapAxisData(edge, mode, normalTarget);

  if (!axisData) {
    return null;
  }

  const geometry =
    mode === "fill"
      ? createLooseEdgeLoopFlatFillGeometry(axisData.data, axisData.axis, capOffset)
      : isCylinderLoopMode(mode)
        ? createLooseEdgeLoopCylinderGeometry(axisData.data, axisData.axis, capOffset)
        : createLooseEdgeLoopExtrusionGeometry(axisData.data, axisData.axis, capOffset);

  if (!geometry) {
    return null;
  }

  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: getSeparatedObjectColor(edge.objectId),
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      roughness: 0.82,
      side: THREE.DoubleSide,
    }),
  );

  fill.name = "loose-edge-loop-fill-overlay";
  fill.position.copy(edge.mesh.position);
  fill.quaternion.copy(edge.mesh.quaternion);
  fill.scale.copy(edge.mesh.scale);
  fill.matrix.copy(edge.mesh.matrix);
  fill.matrixAutoUpdate = edge.mesh.matrixAutoUpdate;
  fill.userData.isLooseEdgeFillOverlay = true;
  fill.userData.fillKey = getLooseEdgeLoopFillKey(edge);
  fill.userData.loopId = edge.loopId;
  fill.userData.objectId = edge.objectId;
  fill.userData.sourceMeshUuid = edge.mesh.uuid;

  return fill;
}

function updateHoverEdgeResolution(model: THREE.Object3D, width: number, height: number) {
  model.traverse((child) => {
    if (
      (child.userData.isHoverEdgeOverlay !== true &&
        child.userData.isLooseEdgeOverlay !== true &&
        child.userData.isLooseEdgeSelectionOverlay !== true &&
        child.userData.isSelectedObjectOutlineOverlay !== true &&
        child.userData.isLinkedFaceSelectionOverlay !== true &&
        child.userData.isSelectionBoundaryLoopOverlay !== true) ||
      !isDisposableDrawObject(child)
    ) {
      return;
    }

    if (child.material instanceof LineMaterial) {
      child.material.resolution.set(width, height);
    }

    if (
      child.userData.isSelectedObjectOutlineOverlay === true &&
      child.material instanceof THREE.ShaderMaterial
    ) {
      const resolution = child.material.uniforms.resolution?.value;

      if (resolution instanceof THREE.Vector2) {
        resolution.set(width, height);
      }
    }
  });
}

function getHoveredEdgeFromHit(
  intersection: THREE.Intersection<THREE.Object3D>,
): HoveredEdge | null {
  if (intersection.faceIndex == null || !isSelectableMesh(intersection.object)) {
    return null;
  }

  const mesh = intersection.object;
  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  const triangle = getTriangleVertices(position, intersection.faceIndex * 3);
  const objectIds = getTriangleObjectIds(mesh);
  const objectId = objectIds?.[intersection.faceIndex] ?? defaultObjectId;

  if (!triangle) {
    return null;
  }

  const edgeIndexes = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];
  const closestPoint = new THREE.Vector3();
  let closestEdge: HoveredEdge | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  edgeIndexes.forEach(([startIndex, endIndex]) => {
    const start = triangle[startIndex];
    const end = triangle[endIndex];
    const startWorld = start.point.clone().applyMatrix4(mesh.matrixWorld);
    const endWorld = end.point.clone().applyMatrix4(mesh.matrixWorld);

    new THREE.Line3(startWorld, endWorld).closestPointToPoint(
      intersection.point,
      true,
      closestPoint,
    );

    const distance = closestPoint.distanceTo(intersection.point);

    if (distance >= closestDistance) {
      return;
    }

    closestDistance = distance;
    closestEdge = {
      end: end.point.clone(),
      key: [start.key, end.key].sort().join("|"),
      mesh,
      objectId,
      start: start.point.clone(),
    };
  });

  return closestEdge;
}

function swapHoveredEdgeDiagonal(edge: HoveredEdge) {
  const mesh = edge.mesh;
  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return false;
  }

  const { triangleEdgeKeys } = getTriangleEdges(position);
  const triangleStarts = triangleEdgeKeys.reduce<number[]>((starts, edgeKeys, triangleIndex) => {
    if (edgeKeys.includes(edge.key)) {
      starts.push(triangleIndex * 3);
    }

    return starts;
  }, []);

  if (triangleStarts.length !== 2) {
    return false;
  }

  const [firstTriangleStart, secondTriangleStart] = triangleStarts;
  const objectIds = getTriangleObjectIds(mesh);
  const firstTriangleIndex = firstTriangleStart / 3;
  const secondTriangleIndex = secondTriangleStart / 3;

  if (
    (objectIds?.[firstTriangleIndex] ?? defaultObjectId) !==
    (objectIds?.[secondTriangleIndex] ?? defaultObjectId)
  ) {
    return false;
  }

  const firstTriangle = getTriangleVertices(position, firstTriangleStart);
  const secondTriangle = getTriangleVertices(position, secondTriangleStart);

  if (!firstTriangle || !secondTriangle) {
    return false;
  }

  const secondKeys = new Set(secondTriangle.map((vertex) => vertex.key));
  const sharedKeys = firstTriangle.map((vertex) => vertex.key).filter((key) => secondKeys.has(key));

  if (sharedKeys.length !== 2) {
    return false;
  }

  const sharedKeySet = new Set(sharedKeys);
  const firstOpposite = firstTriangle.find((vertex) => !sharedKeySet.has(vertex.key));
  const secondOpposite = secondTriangle.find((vertex) => !sharedKeySet.has(vertex.key));
  const sharedVertices = firstTriangle.filter((vertex) => sharedKeySet.has(vertex.key));

  if (!firstOpposite || !secondOpposite || sharedVertices.length !== 2) {
    return false;
  }

  const firstNormal = getTriangleNormal(firstTriangle);
  const referenceNormal = firstNormal.clone().add(getTriangleNormal(secondTriangle));

  if (referenceNormal.lengthSq() === 0) {
    referenceNormal.copy(firstNormal);
  }

  const nextFirstTriangle = orientTriangle(
    [firstOpposite, secondOpposite, sharedVertices[0]],
    referenceNormal,
  );
  const nextSecondTriangle = orientTriangle(
    [firstOpposite, sharedVertices[1], secondOpposite],
    referenceNormal,
  );

  if (
    getTriangleNormal(nextFirstTriangle).lengthSq() === 0 ||
    getTriangleNormal(nextSecondTriangle).lengthSq() === 0
  ) {
    return false;
  }

  setTrianglePositions(position, firstTriangleStart, nextFirstTriangle);
  setTrianglePositions(position, secondTriangleStart, nextSecondTriangle);
  position.needsUpdate = true;
  mesh.userData.hasPositionEdits = true;

  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();

  return true;
}

function buildMeshTopology(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  const edgeToTriangles = new Map<string, number[]>();
  const triangles: TriangleTopology[] = [];

  for (let startIndex = 0; startIndex < position.count; startIndex += 3) {
    const vertices = getTriangleVertices(position, startIndex);

    if (!vertices) {
      continue;
    }

    const edgeKeys = getTriangleEdgeKeys(vertices);
    const triangleIndex = triangles.length;

    triangles.push({ edgeKeys, vertices });
    edgeKeys.forEach((edgeKey) => {
      const edgeTriangles = edgeToTriangles.get(edgeKey);

      if (edgeTriangles) {
        edgeTriangles.push(triangleIndex);
      } else {
        edgeToTriangles.set(edgeKey, [triangleIndex]);
      }
    });
  }

  const topology: MeshTopology = {
    edgeToTriangles,
    mesh,
    position,
    triangles,
  };

  return topology;
}

function getTopologyEdgeNormalAngle(
  topology: MeshTopology,
  edgeKey: string,
  objectIds: Uint32Array | null = null,
  objectId = defaultObjectId,
) {
  const faces =
    topology.edgeToTriangles
      .get(edgeKey)
      ?.map((edgeTriangleIndex) => {
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

async function separateLooseObjectPartsAsync(
  topology: MeshTopology,
  objectIds: Uint32Array,
  objectIdsToScan: number[],
  getNextObjectId: () => number,
  onProgress: SeparationProgressReporter,
) {
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

        if (index > 0 && index % separationProgressCheckInterval === 0) {
          await onProgress(
            `Separating loose part ${componentIndex + 1}/${looseComponents.length}: ${index}/${component.length}`,
          );
        }
      }
    }
  }
}

function buildLinkedFaceSelection(
  mesh: THREE.Mesh,
  seedTriangleIndex: number,
  angleThreshold: number,
): LinkedFaceSelectionDetails | null {
  const topology = buildMeshTopology(mesh);

  if (!topology || !topology.triangles[seedTriangleIndex]) {
    return null;
  }

  const objectIds = getTriangleObjectIds(mesh);
  const objectId = objectIds?.[seedTriangleIndex] ?? defaultObjectId;
  const selectedTriangleIndexes = new Set([seedTriangleIndex]);
  const queue = [seedTriangleIndex];
  const edgeAngleCache = new Map<string, number>();

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const triangleIndex = queue[queueIndex];

    if (triangleIndex == null) {
      continue;
    }

    topology.triangles[triangleIndex].edgeKeys.forEach((edgeKey) => {
      let edgeAngle = edgeAngleCache.get(edgeKey);

      if (edgeAngle == null) {
        edgeAngle = getTopologyEdgeNormalAngle(topology, edgeKey, objectIds, objectId);
        edgeAngleCache.set(edgeKey, edgeAngle);
      }

      if (edgeAngle > angleThreshold) {
        return;
      }

      topology.edgeToTriangles.get(edgeKey)?.forEach((edgeTriangleIndex) => {
        if ((objectIds?.[edgeTriangleIndex] ?? defaultObjectId) !== objectId) {
          return;
        }

        if (selectedTriangleIndexes.has(edgeTriangleIndex)) {
          return;
        }

        selectedTriangleIndexes.add(edgeTriangleIndex);
        queue.push(edgeTriangleIndex);
      });
    });
  }

  return {
    mesh,
    objectId,
    seedTriangleIndex,
    selectedTriangleIndexes,
    topology,
  };
}

function findLinkedFaceGraphParent(parents: number[], index: number) {
  let parent = parents[index] ?? index;

  while (parent !== parents[parent]) {
    parents[parent] = parents[parents[parent]];
    parent = parents[parent];
  }

  let current = index;

  while (current !== parent) {
    const next = parents[current];

    parents[current] = parent;
    current = next;
  }

  return parent;
}

function unionLinkedFaceCacheTriangles(
  parents: number[],
  sizes: number[],
  members: number[][],
  thresholdByTriangle: Float32Array,
  seedTriangleIndex: number,
  firstTriangleIndex: number,
  secondTriangleIndex: number,
  threshold: number,
) {
  let firstParent = findLinkedFaceGraphParent(parents, firstTriangleIndex);
  let secondParent = findLinkedFaceGraphParent(parents, secondTriangleIndex);

  if (firstParent === secondParent) {
    return;
  }

  const seedParent = findLinkedFaceGraphParent(parents, seedTriangleIndex);
  const addedMembers =
    firstParent === seedParent
      ? members[secondParent]
      : secondParent === seedParent
        ? members[firstParent]
        : [];

  addedMembers.forEach((triangleIndex) => {
    if (!Number.isFinite(thresholdByTriangle[triangleIndex])) {
      thresholdByTriangle[triangleIndex] = threshold;
    }
  });

  if ((sizes[firstParent] ?? 0) < (sizes[secondParent] ?? 0)) {
    [firstParent, secondParent] = [secondParent, firstParent];
  }

  parents[secondParent] = firstParent;
  sizes[firstParent] = (sizes[firstParent] ?? 0) + (sizes[secondParent] ?? 0);
  members[secondParent].forEach((triangleIndex) => {
    members[firstParent].push(triangleIndex);
  });
  members[secondParent] = [];
}

function buildLinkedFaceSelectionCache(
  mesh: THREE.Mesh,
  seedTriangleIndex: number,
): LinkedFaceSelectionCache | null {
  const topology = buildMeshTopology(mesh);

  if (!topology || !topology.triangles[seedTriangleIndex]) {
    return null;
  }

  const objectIds = getTriangleObjectIds(mesh);
  const objectId = objectIds?.[seedTriangleIndex] ?? defaultObjectId;
  const connections: Array<{ angle: number; first: number; second: number }> = [];

  topology.edgeToTriangles.forEach((triangleIndexes, edgeKey) => {
    const objectTriangleIndexes = triangleIndexes.filter(
      (triangleIndex) => (objectIds?.[triangleIndex] ?? defaultObjectId) === objectId,
    );

    if (objectTriangleIndexes.length < 2) {
      return;
    }

    const angle = getTopologyEdgeNormalAngle(topology, edgeKey, objectIds, objectId);

    if (!Number.isFinite(angle)) {
      return;
    }

    for (let index = 1; index < objectTriangleIndexes.length; index += 1) {
      connections.push({
        angle,
        first: objectTriangleIndexes[0],
        second: objectTriangleIndexes[index],
      });
    }
  });

  connections.sort((first, second) => first.angle - second.angle);

  const parents = topology.triangles.map((_, index) => index);
  const sizes = new Array(topology.triangles.length).fill(1);
  const members = topology.triangles.map((_, index) => [index]);
  const thresholdByTriangle = new Float32Array(topology.triangles.length);

  thresholdByTriangle.fill(Number.POSITIVE_INFINITY);
  thresholdByTriangle[seedTriangleIndex] = 0;

  for (const connection of connections) {
    if (connection.angle > maxLinkedFaceSelectionAngle) {
      break;
    }

    unionLinkedFaceCacheTriangles(
      parents,
      sizes,
      members,
      thresholdByTriangle,
      seedTriangleIndex,
      connection.first,
      connection.second,
      connection.angle,
    );
  }

  const selectedThresholds = Array.from(thresholdByTriangle)
    .filter((threshold) => Number.isFinite(threshold))
    .sort((first, second) => first - second);
  const stepCount = Math.floor(maxLinkedFaceSelectionAngle / linkedFaceSelectionGraphInterval);
  const counts: number[] = [];
  let selectedThresholdIndex = 0;

  for (let step = 0; step <= stepCount; step += 1) {
    const threshold = step * linkedFaceSelectionGraphInterval;

    while (
      selectedThresholdIndex < selectedThresholds.length &&
      selectedThresholds[selectedThresholdIndex] <= threshold + Number.EPSILON
    ) {
      selectedThresholdIndex += 1;
    }

    counts.push(selectedThresholdIndex);
  }

  return {
    counts,
    interval: linkedFaceSelectionGraphInterval,
    maxCount: Math.max(...counts, 1),
    maxThreshold: maxLinkedFaceSelectionAngle,
    mesh,
    objectId,
    seedTriangleIndex,
    thresholdByTriangle,
    topology,
  };
}

function createLinkedFaceSelectionFromCache(
  cache: LinkedFaceSelectionCache,
  threshold: number,
): LinkedFaceSelectionDetails {
  const selectedTriangleIndexes = new Set<number>();

  cache.thresholdByTriangle.forEach((triangleThreshold, triangleIndex) => {
    if (triangleThreshold <= threshold + Number.EPSILON) {
      selectedTriangleIndexes.add(triangleIndex);
    }
  });

  return {
    mesh: cache.mesh,
    objectId: cache.objectId,
    seedTriangleIndex: cache.seedTriangleIndex,
    selectedTriangleIndexes,
    topology: cache.topology,
  };
}

function applyLinkedFaceSelectionColors(selection: LinkedFaceSelectionDetails | null) {
  if (!selection) {
    return;
  }

  const color = selection.mesh.geometry.getAttribute("color");

  if (!(color instanceof THREE.BufferAttribute)) {
    return;
  }

  selection.selectedTriangleIndexes.forEach((triangleIndex) => {
    colorTriangle(color, triangleIndex * 3, linkedFaceSelectionColor);
  });
  color.needsUpdate = true;
}

function createLinkedFaceSelectionOverlay(selection: LinkedFaceSelectionDetails) {
  const topology = selection.topology;
  const segmentKeys = new Set<string>();
  const segmentPositions: number[] = [];

  selection.mesh.updateMatrixWorld(true);

  selection.selectedTriangleIndexes.forEach((triangleIndex) => {
    topology.triangles[triangleIndex]?.edgeKeys.forEach((edgeKey) => {
      if (segmentKeys.has(edgeKey)) {
        return;
      }

      const [startKey, endKey] = edgeKey.split("|");

      if (!startKey || !endKey) {
        return;
      }

      const start = getPointFromVertexKey(startKey).applyMatrix4(selection.mesh.matrixWorld);
      const end = getPointFromVertexKey(endKey).applyMatrix4(selection.mesh.matrixWorld);

      segmentKeys.add(edgeKey);
      segmentPositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    });
  });

  if (segmentPositions.length === 0) {
    return null;
  }

  const geometry = new LineSegmentsGeometry();

  geometry.setPositions(segmentPositions);

  const overlay = new LineSegments2(
    geometry,
    new LineMaterial({
      color: linkedFaceSelectionColor,
      depthTest: true,
      depthWrite: false,
      linewidth: linkedFaceSelectionLineWidth,
    }),
  );

  overlay.name = "linked-face-selection-overlay";
  overlay.renderOrder = 5;
  overlay.userData.isLinkedFaceSelectionOverlay = true;

  return overlay;
}

function buildSelectionBoundaryLoops(selection: LinkedFaceSelectionDetails) {
  const boundarySegments = new Map<
    string,
    {
      endKey: string;
      loopId: number;
      selectedTriangleIndexes: Set<number>;
      startKey: string;
    }
  >();
  const segmentKeysByVertexKey = new Map<string, Set<string>>();

  selection.selectedTriangleIndexes.forEach((triangleIndex) => {
    selection.topology.triangles[triangleIndex]?.edgeKeys.forEach((edgeKey) => {
      const adjacentTriangleIndexes = selection.topology.edgeToTriangles.get(edgeKey) ?? [];

      if (adjacentTriangleIndexes.length !== 2) {
        return;
      }

      const selectedAdjacentTriangleIndexes = adjacentTriangleIndexes.filter((edgeTriangleIndex) =>
        selection.selectedTriangleIndexes.has(edgeTriangleIndex),
      );

      if (selectedAdjacentTriangleIndexes.length !== 1) {
        return;
      }

      const [startKey, endKey] = edgeKey.split("|");

      if (!startKey || !endKey) {
        return;
      }

      let segment = boundarySegments.get(edgeKey);

      if (!segment) {
        segment = {
          endKey,
          loopId: -1,
          selectedTriangleIndexes: new Set(),
          startKey,
        };
        boundarySegments.set(edgeKey, segment);

        [startKey, endKey].forEach((vertexKey) => {
          const connectedSegmentKeys = segmentKeysByVertexKey.get(vertexKey);

          if (connectedSegmentKeys) {
            connectedSegmentKeys.add(edgeKey);
          } else {
            segmentKeysByVertexKey.set(vertexKey, new Set([edgeKey]));
          }
        });
      }

      segment.selectedTriangleIndexes.add(triangleIndex);
    });
  });

  const loops: SelectionBoundaryLoop[] = [];
  let nextLoopId = 0;

  boundarySegments.forEach((seedSegment, seedSegmentKey) => {
    if (seedSegment.loopId >= 0) {
      return;
    }

    const loopId = nextLoopId;
    const positions: number[] = [];
    const segmentKeys: string[] = [];
    const selectedTriangleIndexes = new Set<number>();
    const pendingSegmentKeys = [seedSegmentKey];

    nextLoopId += 1;

    while (pendingSegmentKeys.length > 0) {
      const segmentKey = pendingSegmentKeys.pop();

      if (!segmentKey) {
        continue;
      }

      const segment = boundarySegments.get(segmentKey);

      if (!segment || segment.loopId >= 0) {
        continue;
      }

      segment.loopId = loopId;
      segmentKeys.push(segmentKey);
      segment.selectedTriangleIndexes.forEach((triangleIndex) => {
        selectedTriangleIndexes.add(triangleIndex);
      });

      const start = getPointFromVertexKey(segment.startKey);
      const end = getPointFromVertexKey(segment.endKey);

      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);

      [segment.startKey, segment.endKey].forEach((vertexKey) => {
        segmentKeysByVertexKey.get(vertexKey)?.forEach((connectedSegmentKey) => {
          const connectedSegment = boundarySegments.get(connectedSegmentKey);

          if (connectedSegment && connectedSegment.loopId < 0) {
            pendingSegmentKeys.push(connectedSegmentKey);
          }
        });
      });
    }

    loops.push({
      id: loopId,
      positions: new Float32Array(positions),
      segmentKeys,
      selectedTriangleIndexes: Array.from(selectedTriangleIndexes),
    });
  });

  return loops;
}

function createSelectionBoundaryLoopOverlay(
  selection: LinkedFaceSelectionDetails,
  loops: SelectionBoundaryLoop[],
) {
  const segmentPositions: number[] = [];

  loops.forEach((loop) => {
    for (let index = 0; index < loop.positions.length; index += 1) {
      segmentPositions.push(loop.positions[index]);
    }
  });

  if (segmentPositions.length === 0) {
    return null;
  }

  const geometry = new LineSegmentsGeometry();

  geometry.setPositions(segmentPositions);

  const overlay = new LineSegments2(
    geometry,
    new LineMaterial({
      color: looseEdgeColor,
      depthTest: true,
      depthWrite: false,
      linewidth: looseEdgeLineWidth,
    }),
  );

  overlay.name = "selection-boundary-loop-overlay";
  overlay.position.copy(selection.mesh.position);
  overlay.quaternion.copy(selection.mesh.quaternion);
  overlay.scale.copy(selection.mesh.scale);
  overlay.matrix.copy(selection.mesh.matrix);
  overlay.matrixAutoUpdate = selection.mesh.matrixAutoUpdate;
  overlay.renderOrder = looseEdgeHoverRenderOrder - 1;
  overlay.userData.isSelectionBoundaryLoopOverlay = true;

  return overlay;
}

function getBoundaryLoopRegionTriangleIndexes(
  selection: LinkedFaceSelectionDetails,
  loop: SelectionBoundaryLoop,
) {
  const selectedTriangleIndexes = selection.selectedTriangleIndexes;
  const regionTriangleIndexes = new Set<number>();
  const queue = loop.selectedTriangleIndexes.filter((triangleIndex) =>
    selectedTriangleIndexes.has(triangleIndex),
  );

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const triangleIndex = queue[queueIndex];

    if (regionTriangleIndexes.has(triangleIndex)) {
      continue;
    }

    regionTriangleIndexes.add(triangleIndex);

    selection.topology.triangles[triangleIndex]?.edgeKeys.forEach((edgeKey) => {
      selection.topology.edgeToTriangles.get(edgeKey)?.forEach((edgeTriangleIndex) => {
        if (
          edgeTriangleIndex === triangleIndex ||
          !selectedTriangleIndexes.has(edgeTriangleIndex) ||
          regionTriangleIndexes.has(edgeTriangleIndex)
        ) {
          return;
        }

        queue.push(edgeTriangleIndex);
      });
    });
  }

  return regionTriangleIndexes;
}

function cutSelectionBoundaryLoopTopology(
  selection: LinkedFaceSelectionDetails,
  loop: SelectionBoundaryLoop,
) {
  const position = selection.mesh.geometry.getAttribute("position");
  const regionTriangleIndexes = getBoundaryLoopRegionTriangleIndexes(selection, loop);

  if (!(position instanceof THREE.BufferAttribute) || regionTriangleIndexes.size === 0) {
    return false;
  }

  const cutVertexKeys = new Set<string>();

  loop.segmentKeys.forEach((segmentKey) => {
    segmentKey.split("|").forEach((vertexKey) => {
      if (vertexKey) {
        cutVertexKeys.add(vertexKey);
      }
    });
  });

  if (cutVertexKeys.size === 0) {
    return false;
  }

  const topologyIds = ensureVertexTopologyIds(position);
  const replacementTopologyIds = new Map<string, number>();
  let nextTopologyId = getNextVertexTopologyId(position);
  let changed = false;

  cutVertexKeys.forEach((vertexKey) => {
    replacementTopologyIds.set(vertexKey, nextTopologyId);
    nextTopologyId += 1;
  });

  regionTriangleIndexes.forEach((triangleIndex) => {
    const startIndex = triangleIndex * 3;
    const vertices = getTriangleVertices(position, startIndex);

    if (!vertices) {
      return;
    }

    vertices.forEach((vertex, offset) => {
      const replacementTopologyId = replacementTopologyIds.get(vertex.key);

      if (replacementTopologyId == null) {
        return;
      }

      const vertexIndex = startIndex + offset;

      if (topologyIds[vertexIndex] === replacementTopologyId) {
        return;
      }

      topologyIds[vertexIndex] = replacementTopologyId;
      changed = true;
    });
  });

  return changed;
}

function applyObjectColors(model: THREE.Object3D, hiddenObjectIds = new Set<number>()) {
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (
      !isMesh(child) ||
      child.userData.isWireframeOverlay === true ||
      child.userData.isLooseEdgeFillOverlay === true ||
      child.userData.isCapOffsetGizmoOverlay === true ||
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

function getPointFromVertexKey(vertexKey: string) {
  const positionKey = vertexKey.split("#")[0] ?? vertexKey;
  const coordinates = positionKey.split(",").map((value) => Number(value) / 100000);

  return new THREE.Vector3(coordinates[0] ?? 0, coordinates[1] ?? 0, coordinates[2] ?? 0);
}

function normalizeModel(model: THREE.Object3D) {
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

function frameModel(
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

function isSelectableMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (
    isMesh(object) &&
    object.userData.isWireframeOverlay !== true &&
    object.userData.isLooseEdgeOverlay !== true &&
    object.userData.isLooseEdgeFillOverlay !== true &&
    object.userData.isCapOffsetGizmoOverlay !== true &&
    object.userData.isLooseEdgeSelectionOverlay !== true &&
    object.userData.isSelectedObjectStencilOverlay !== true &&
    object.userData.isSelectedObjectOutlineOverlay !== true &&
    object.userData.isSelectionBoundaryLoopOverlay !== true &&
    object.userData.isHoverEdgeOverlay !== true
  );
}

function collectSelectableMeshes(model: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      meshes.push(child);
    }
  });

  return meshes;
}

function getMaxObjectId(model: THREE.Object3D) {
  let maxObjectId = defaultObjectId;

  collectSelectableMeshes(model).forEach((mesh) => {
    const objectIds = getTriangleObjectIds(mesh);

    objectIds?.forEach((objectId) => {
      maxObjectId = Math.max(maxObjectId, objectId);
    });
  });

  return maxObjectId;
}

function getPersistedMeshState(mesh: THREE.Mesh, meshIndex: number): PersistedMeshState | null {
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

function getPersistedLoopCapState(
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

function createPersistedViewerState(
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

function applyPersistedMeshStates(model: THREE.Object3D, meshStates: PersistedMeshState[]) {
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

function getRestoredObjectNames(objectNames: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(objectNames)
      .map(([objectId, name]) => [Number(objectId), name.trim()] as const)
      .filter(([objectId, name]) => Number.isFinite(objectId) && name.length > 0),
  ) as ObjectNameMap;
}

function getLooseEdgeLoopFromPersistedState(mesh: THREE.Mesh, capState: PersistedLoopCapState) {
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

function createLooseEdgeFromLoop(mesh: THREE.Mesh, loop: LooseEdgeLoop): HoveredEdge | null {
  const segmentsByKey = mesh.userData.looseEdgeSegmentsByKey as
    | Map<string, LooseEdgeSegment>
    | undefined;
  const firstSegmentKey = loop.segmentKeys[0];
  const firstSegment =
    firstSegmentKey && segmentsByKey instanceof Map ? segmentsByKey.get(firstSegmentKey) : null;

  if (firstSegment) {
    return {
      end: firstSegment.end,
      isLooseEdge: true,
      key: firstSegment.edgeKey,
      loopId: loop.id,
      mesh,
      objectId: loop.objectId,
      start: firstSegment.start,
    };
  }

  if (loop.positions.length < 6) {
    return null;
  }

  return {
    end: new THREE.Vector3(loop.positions[3], loop.positions[4], loop.positions[5]),
    isLooseEdge: true,
    key: loop.segmentKeys[0] ?? `${loop.objectId}:${loop.id}`,
    loopId: loop.id,
    mesh,
    objectId: loop.objectId,
    start: new THREE.Vector3(loop.positions[0], loop.positions[1], loop.positions[2]),
  };
}

type ModelViewerProps = {
  tools: ViewerTool[];
};

export function ModelViewer({ tools }: ModelViewerProps) {
  const enabledToolIds = new Set<ViewerToolId>(tools.map((tool) => tool.id));
  const isSeparationToolEnabled = enabledToolIds.has("separation");
  const isEdgeLoopCapToolEnabled = enabledToolIds.has("edge-loop-cap");
  const mountRef = useRef<HTMLDivElement | null>(null);
  const isSeparationToolEnabledRef = useRef(isSeparationToolEnabled);
  const isEdgeLoopCapToolEnabledRef = useRef(isEdgeLoopCapToolEnabled);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const linkedFaceSelectionRef = useRef<LinkedFaceSelectionDetails | null>(null);
  const linkedFaceSelectionCacheRef = useRef<LinkedFaceSelectionCache | null>(null);
  const linkedFaceSelectionOverlayRef = useRef<LineSegments2 | null>(null);
  const selectionBoundaryLoopsRef = useRef<SelectionBoundaryLoop[]>([]);
  const selectionBoundaryLoopOverlayRef = useRef<LineSegments2 | null>(null);
  const linkedFaceSelectionThresholdRef = useRef(defaultLinkedFaceSelectionAngle);
  const looseEdgeLoopCapStatesRef = useRef<Map<string, LooseEdgeLoopCapState>>(new Map());
  const capOffsetDragRef = useRef<CapOffsetDragState | null>(null);
  const capOffsetGizmoHandleRef = useRef<THREE.Object3D | null>(null);
  const capOffsetGizmoRef = useRef<THREE.Group | null>(null);
  const capNormalTargetRef = useRef<THREE.Object3D | null>(null);
  const capNormalTransformControlsRef = useRef<TransformControls | null>(null);
  const capNormalTransformHelperRef = useRef<THREE.Object3D | null>(null);
  const rememberedTriangleSelectionRef = useRef<RememberedTriangleSelection | null>(null);
  const selectedLooseEdgeLoopRef = useRef<HoveredEdge | null>(null);
  const selectedLooseEdgeLoopOverlayRef = useRef<LineSegments2 | null>(null);
  const currentModelSourceRef = useRef<PersistedModelSource | null>(null);
  const persistenceSaveTimeoutRef = useRef<number | null>(null);
  const persistenceSaveFailedRef = useRef(false);
  const isRestoringPersistedStateRef = useRef(false);
  const modelLoadVersionRef = useRef(0);
  const nextSeparatedObjectIdRef = useRef(1);
  const hiddenObjectIdsRef = useRef<Set<number>>(new Set());
  const objectNamesRef = useRef<ObjectNameMap>({});
  const toastTimeoutRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  const separationBusyRef = useRef(false);
  const separateModeActiveRef = useRef(false);
  const selectedObjectIdRef = useRef<number | null>(null);
  const clearLinkedFaceSelectionHandlerRef = useRef<(() => void) | null>(null);
  const clearSelectedLooseEdgeLoopHandlerRef = useRef<(() => void) | null>(null);
  const hideSelectedObjectHandlerRef = useRef<(() => void) | null>(null);
  const selectLooseEdgeLoopHandlerRef = useRef<((edge: HoveredEdge) => void) | null>(null);
  const selectSeparatedObjectHandlerRef = useRef<((objectId: number) => void) | null>(null);
  const separateByBoundaryLoopHandlerRef = useRef<((loopId: number) => void) | null>(null);
  const schedulePersistViewerStateHandlerRef = useRef<(() => void) | null>(null);
  const setLooseEdgeLoopCapOffsetHandlerRef = useRef<
    ((edge: HoveredEdge, offset: number) => void) | null
  >(null);
  const setLooseEdgeLoopCapTargetHandlerRef = useRef<
    ((edge: HoveredEdge, target: THREE.Vector3) => void) | null
  >(null);
  const showAllObjectsHandlerRef = useRef<(() => void) | null>(null);
  const syncLooseEdgeLoopCapStatesHandlerRef = useRef<
    ((modelRoot?: THREE.Object3D | null) => void) | null
  >(null);
  const restorePersistedViewerStateHandlerRef = useRef<
    | ((
        modelRoot: THREE.Group,
        camera: THREE.PerspectiveCamera,
        controls: OrbitControls,
        loader: GLTFLoader,
        isCancelled: () => boolean,
      ) => Promise<void>)
    | null
  >(null);
  const selectLinkedFaceHandlerRef = useRef<
    ((mesh: THREE.Mesh, triangleIndex: number) => void) | null
  >(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const hoveredEdgeRef = useRef<HoveredEdge | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("empty");
  const [statusText, setStatusText] = useState("No model loaded");
  const [linkedFaceSelection, setLinkedFaceSelection] = useState<LinkedFaceSelectionState>({
    active: false,
    count: 0,
    threshold: defaultLinkedFaceSelectionAngle,
  });
  const [linkedFaceSelectionGraph, setLinkedFaceSelectionGraph] =
    useState<LinkedFaceSelectionGraph | null>(null);
  const [looseEdgeLoopMode, setLooseEdgeLoopMode] = useState<LooseEdgeLoopMode>("none");
  const [separateModeActive, setSeparateModeActive] = useState(false);
  const [separationBusy, setSeparationBusy] = useState(false);
  const [separationProgress, setSeparationProgress] = useState<string | null>(null);
  const [separatedObjects, setSeparatedObjects] = useState<SeparatedObjectSummary[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);
  const [selectedLooseEdgeLoopActive, setSelectedLooseEdgeLoopActive] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (text: string) => {
    if (toastTimeoutRef.current != null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    const id = toastIdRef.current + 1;

    toastIdRef.current = id;
    setToast({ id, text });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
      toastTimeoutRef.current = null;
    }, toastDurationMs);
  };

  const persistViewerStateNow = async () => {
    const modelRoot = rootRef.current;
    const source = currentModelSourceRef.current;

    if (isRestoringPersistedStateRef.current || !modelRoot || !source) {
      return;
    }

    try {
      await savePersistedViewerState(
        createPersistedViewerState(
          modelRoot,
          source,
          hiddenObjectIdsRef.current,
          objectNamesRef.current,
          nextSeparatedObjectIdRef.current,
          looseEdgeLoopCapStatesRef.current,
        ),
      );
      persistenceSaveFailedRef.current = false;
    } catch {
      if (!persistenceSaveFailedRef.current) {
        showToast("Could not save this model. Changes may not survive refresh.");
      }

      persistenceSaveFailedRef.current = true;
    }
  };

  const schedulePersistViewerState = () => {
    if (isRestoringPersistedStateRef.current || !currentModelSourceRef.current) {
      return;
    }

    if (persistenceSaveTimeoutRef.current != null) {
      window.clearTimeout(persistenceSaveTimeoutRef.current);
    }

    persistenceSaveTimeoutRef.current = window.setTimeout(() => {
      persistenceSaveTimeoutRef.current = null;
      void persistViewerStateNow();
    }, persistenceSaveDelayMs);
  };

  const clearScheduledPersistenceSave = () => {
    if (persistenceSaveTimeoutRef.current == null) {
      return;
    }

    window.clearTimeout(persistenceSaveTimeoutRef.current);
    persistenceSaveTimeoutRef.current = null;
  };

  const setSeparateModeActiveState = (active: boolean) => {
    separateModeActiveRef.current = active;
    setSeparateModeActive(active);
  };

  const setSeparationBusyState = (busy: boolean) => {
    separationBusyRef.current = busy;
    setSeparationBusy(busy);
  };

  const clearLinkedFaceSelectionOverlay = () => {
    const overlay = linkedFaceSelectionOverlayRef.current;

    if (!overlay) {
      return;
    }

    overlay.parent?.remove(overlay);
    disposeObject(overlay);
    linkedFaceSelectionOverlayRef.current = null;
  };

  const clearSelectionBoundaryLoopOverlay = () => {
    const overlay = selectionBoundaryLoopOverlayRef.current;

    selectionBoundaryLoopsRef.current = [];

    if (!overlay) {
      return;
    }

    overlay.parent?.remove(overlay);
    disposeObject(overlay);
    selectionBoundaryLoopOverlayRef.current = null;
  };

  const removeLooseEdgeLoopCapFill = (state: LooseEdgeLoopCapState) => {
    disposeLooseEdgeLoopFillOcclusionOverlay(state);

    if (!state.fill) {
      return;
    }

    state.fill.parent?.remove(state.fill);
    disposeObject(state.fill);
    state.fill = null;
  };

  const removeCapOffsetGizmo = () => {
    capOffsetDragRef.current = null;
    const controls = controlsRef.current;
    const transformControls = capNormalTransformControlsRef.current;
    const transformHelper = capNormalTransformHelperRef.current;
    const transformTarget = capNormalTargetRef.current;

    if (controls) {
      controls.enabled = true;
    }

    transformControls?.detach();

    if (transformHelper) {
      transformHelper.visible = false;
    }

    if (transformTarget) {
      transformTarget.visible = false;
    }

    const gizmo = capOffsetGizmoRef.current;

    if (!gizmo) {
      return;
    }

    gizmo.parent?.remove(gizmo);
    disposeObject(gizmo);
    capOffsetGizmoRef.current = null;
    capOffsetGizmoHandleRef.current = null;
  };

  const clearLooseEdgeLoopCapStates = () => {
    removeCapOffsetGizmo();
    looseEdgeLoopCapStatesRef.current.forEach((state) => {
      removeLooseEdgeLoopCapFill(state);
    });
    looseEdgeLoopCapStatesRef.current.clear();
  };

  const refreshLooseEdgeLoopCapVisibility = (hiddenObjectIds = hiddenObjectIdsRef.current) => {
    const overlayActive =
      selectedObjectIdRef.current != null || selectedLooseEdgeLoopRef.current != null;

    looseEdgeLoopCapStatesRef.current.forEach((state) => {
      if (!state.fill) {
        return;
      }

      if (!state.fill.parent) {
        disposeLooseEdgeLoopFillOcclusionOverlay(state);
        state.fill = null;
        return;
      }

      state.fill.visible = !hiddenObjectIds.has(state.objectId);
      setLooseEdgeLoopFillBaseMaterial(state.fill, overlayActive);

      if (!overlayActive || !state.fill.visible) {
        if (state.occlusionOverlay) {
          state.occlusionOverlay.visible = false;
        }
        return;
      }

      if (!state.occlusionOverlay) {
        state.occlusionOverlay = createLooseEdgeLoopFillOcclusionOverlay(state.fill);
      }

      if (state.occlusionOverlay.parent !== state.fill.parent) {
        state.occlusionOverlay.parent?.remove(state.occlusionOverlay);
        state.fill.parent.add(state.occlusionOverlay);
      }

      state.occlusionOverlay.position.copy(state.fill.position);
      state.occlusionOverlay.quaternion.copy(state.fill.quaternion);
      state.occlusionOverlay.scale.copy(state.fill.scale);
      state.occlusionOverlay.matrix.copy(state.fill.matrix);
      state.occlusionOverlay.matrixAutoUpdate = state.fill.matrixAutoUpdate;
      state.occlusionOverlay.visible = true;
    });
  };

  const refreshCapOffsetGizmo = (edge = selectedLooseEdgeLoopRef.current) => {
    const modelRoot = rootRef.current;

    if (!edge || !modelRoot || !isSameLooseEdgeLoop(edge, selectedLooseEdgeLoopRef.current)) {
      removeCapOffsetGizmo();
      return;
    }

    const key = getLooseEdgeLoopFillKey(edge);
    const state = looseEdgeLoopCapStatesRef.current.get(key);
    const axisData = state
      ? getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget)
      : null;
    const parent = edge.mesh.parent ?? modelRoot;

    if (
      !state ||
      !state.fill ||
      !axisData ||
      hiddenObjectIdsRef.current.has(edge.objectId) ||
      state.mode === "none" ||
      state.mode === "fill"
    ) {
      removeCapOffsetGizmo();
      return;
    }

    if (isNormalTargetLoopMode(state.mode)) {
      const gizmo = capOffsetGizmoRef.current;

      if (gizmo) {
        gizmo.parent?.remove(gizmo);
        disposeObject(gizmo);
        capOffsetGizmoRef.current = null;
        capOffsetGizmoHandleRef.current = null;
      }

      const transformControls = capNormalTransformControlsRef.current;
      const transformHelper = capNormalTransformHelperRef.current;
      const transformTarget = capNormalTargetRef.current;

      if (!transformControls || !transformHelper || !transformTarget) {
        return;
      }

      edge.mesh.updateMatrixWorld(true);
      transformTarget.position.copy(
        edge.mesh.localToWorld(
          axisData.data.center.clone().addScaledVector(axisData.axis, state.offset),
        ),
      );
      transformTarget.visible = true;
      transformControls.setMode("translate");
      transformControls.setSpace("world");
      transformControls.setSize(0.7);
      transformControls.showX = true;
      transformControls.showY = true;
      transformControls.showZ = true;
      transformControls.showXY = false;
      transformControls.showYZ = false;
      transformControls.showXZ = false;
      transformControls.attach(transformTarget);
      transformControls.enabled = true;
      transformHelper.visible = true;

      return;
    }

    capNormalTransformControlsRef.current?.detach();

    if (capNormalTransformHelperRef.current) {
      capNormalTransformHelperRef.current.visible = false;
    }

    if (capNormalTargetRef.current) {
      capNormalTargetRef.current.visible = false;
    }

    let gizmo = capOffsetGizmoRef.current;
    let handle = capOffsetGizmoHandleRef.current;
    let arrow = gizmo?.userData.arrowHelper as THREE.ArrowHelper | undefined;

    if (!gizmo || !handle || !arrow) {
      gizmo = new THREE.Group();
      gizmo.name = "cap-offset-gizmo-overlay";
      gizmo.renderOrder = looseEdgeHoverRenderOrder + 1;
      gizmo.userData.isCapOffsetGizmoOverlay = true;
      gizmo.userData.fillKey = key;

      arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(),
        1,
        capOffsetGizmoColor,
      );
      arrow.name = "cap-offset-arrow-overlay";
      arrow.userData.isCapOffsetGizmoOverlay = true;
      arrow.userData.fillKey = key;
      arrow.traverse((child) => {
        child.renderOrder = looseEdgeHoverRenderOrder + 1;
        child.userData.isCapOffsetGizmoOverlay = true;
        child.userData.fillKey = key;

        if (!isDisposableDrawObject(child)) {
          return;
        }

        const materials = Array.isArray(child.material) ? child.material : [child.material];

        materials.forEach((material) => {
          material.depthTest = false;
          material.depthWrite = false;
          material.opacity = 0.96;
          material.transparent = true;
        });
      });

      gizmo.userData.arrowHelper = arrow;
      gizmo.add(arrow);
      handle = arrow;

      capOffsetGizmoRef.current = gizmo;
      capOffsetGizmoHandleRef.current = handle;
    }

    if (gizmo.parent !== parent) {
      gizmo.parent?.remove(gizmo);
      parent.add(gizmo);
    }

    gizmo.position.copy(edge.mesh.position);
    gizmo.quaternion.copy(edge.mesh.quaternion);
    gizmo.scale.copy(edge.mesh.scale);
    gizmo.matrix.copy(edge.mesh.matrix);
    gizmo.matrixAutoUpdate = edge.mesh.matrixAutoUpdate;
    gizmo.visible = true;
    gizmo.userData.fillKey = key;
    handle.userData.fillKey = key;
    gizmo.traverse((child) => {
      child.userData.isCapOffsetGizmoOverlay = true;
      child.userData.fillKey = key;
    });

    const targetOffset = axisData.axis.clone().multiplyScalar(state.offset);
    const arrowDirection =
      targetOffset.lengthSq() > 0 ? targetOffset.clone().normalize() : axisData.axis.clone();
    const loopSize = new THREE.Box3()
      .setFromPoints(axisData.data.points)
      .getSize(new THREE.Vector3());
    const loopSpan = Math.max(loopSize.x, loopSize.y, loopSize.z);
    const visualLength = Math.max(targetOffset.length(), loopSpan * 0.12, capOffsetGizmoMinLength);
    const headLength = Math.min(
      visualLength * 0.35,
      Math.max(loopSpan * capOffsetGizmoHeadScale, 0.025),
    );
    const headWidth = headLength * 0.6;

    arrow.position.copy(axisData.data.center);
    arrow.setDirection(arrowDirection);
    arrow.setLength(visualLength, headLength, headWidth);
    arrow.setColor(capOffsetGizmoColor);
  };

  const rebuildLooseEdgeLoopCapFill = (
    edge: HoveredEdge,
    key: string,
    state: LooseEdgeLoopCapState,
  ) => {
    const axisData = getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget);

    if (!axisData) {
      return;
    }

    if (state.fill) {
      removeLooseEdgeLoopCapFill(state);
    }

    state.offset = clampLooseEdgeLoopCapOffset(edge, state.mode, state.offset, state.normalTarget);

    if (isNormalTargetLoopMode(state.mode)) {
      state.normalTarget = axisData.data.center
        .clone()
        .addScaledVector(axisData.axis, state.offset);
    }

    const fill = createLooseEdgeLoopFill(edge, state.mode, state.offset, state.normalTarget);
    const parent = edge.mesh.parent ?? rootRef.current;

    if (!fill || !parent) {
      if (fill) {
        disposeObject(fill);
      }
      looseEdgeLoopCapStatesRef.current.set(key, state);
      return;
    }

    parent.add(fill);
    fill.visible = !hiddenObjectIdsRef.current.has(edge.objectId);
    state.fill = fill;
    looseEdgeLoopCapStatesRef.current.set(key, state);
    refreshLooseEdgeLoopCapVisibility();
  };

  const restoreLooseEdgeLoopCapStates = (
    modelRoot: THREE.Object3D,
    capStates: PersistedLoopCapState[],
  ) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return false;
    }

    const meshes = collectSelectableMeshes(modelRoot);
    let hadInvalidState = false;

    capStates.forEach((capState) => {
      const mesh = meshes[capState.meshIndex];

      if (!mesh) {
        hadInvalidState = true;
        return;
      }

      const loop = getLooseEdgeLoopFromPersistedState(mesh, capState);
      const edge = loop ? createLooseEdgeFromLoop(mesh, loop) : null;

      if (!edge || capState.mode === "none") {
        hadInvalidState = true;
        return;
      }

      const key = getLooseEdgeLoopFillKey(edge);
      const normalTarget =
        capState.normalTarget && isNormalTargetLoopMode(capState.mode)
          ? new THREE.Vector3(
              capState.normalTarget[0],
              capState.normalTarget[1],
              capState.normalTarget[2],
            )
          : null;
      const axisData = getLooseEdgeLoopCapAxisData(edge, capState.mode, normalTarget);

      if (!axisData) {
        hadInvalidState = true;
        return;
      }

      const state: LooseEdgeLoopCapState = {
        fill: null,
        mode: capState.mode,
        normalTarget,
        objectId: edge.objectId,
        occlusionOverlay: null,
        offset: capState.mode === "fill" ? 0 : capState.offset,
        sourceMeshUuid: mesh.uuid,
      };

      state.offset = clampLooseEdgeLoopCapOffset(
        edge,
        state.mode,
        state.offset,
        state.normalTarget,
      );

      if (isNormalTargetLoopMode(state.mode) && !state.normalTarget) {
        state.normalTarget = axisData.data.center
          .clone()
          .addScaledVector(axisData.axis, state.offset);
      }

      rebuildLooseEdgeLoopCapFill(edge, key, state);
    });

    refreshLooseEdgeLoopCapVisibility();

    return hadInvalidState;
  };

  const setLooseEdgeLoopCapTarget = (edge: HoveredEdge, target: THREE.Vector3) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const key = getLooseEdgeLoopFillKey(edge);
    const state = looseEdgeLoopCapStatesRef.current.get(key);

    if (!state || !isNormalTargetLoopMode(state.mode)) {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const axisData = getLooseEdgeLoopCapAxisData(edge, state.mode, target);

    if (!axisData) {
      return;
    }

    const requestedOffset = target.distanceTo(axisData.data.center);
    const nextOffset = clampLooseEdgeLoopCapOffset(edge, state.mode, requestedOffset, target);
    const nextTarget = axisData.data.center.clone().addScaledVector(axisData.axis, nextOffset);

    if (
      Math.abs(nextOffset - state.offset) < 0.0001 &&
      state.normalTarget &&
      nextTarget.distanceToSquared(state.normalTarget) < 0.000001
    ) {
      return;
    }

    state.offset = nextOffset;
    state.normalTarget = nextTarget;
    rebuildLooseEdgeLoopCapFill(edge, key, state);
    refreshCapOffsetGizmo(edge);
    schedulePersistViewerState();
  };

  const syncLooseEdgeLoopCapStates = (modelRoot: THREE.Object3D | null = rootRef.current) => {
    if (!modelRoot) {
      return;
    }

    const currentKeys = new Set<string>();

    modelRoot.traverse((child) => {
      if (!isSelectableMesh(child)) {
        return;
      }

      const loopsById = child.userData.looseEdgeLoopById;

      if (!(loopsById instanceof Map)) {
        return;
      }

      loopsById.forEach((loop) => {
        const typedLoop = loop as LooseEdgeLoop;

        currentKeys.add(getLooseEdgeLoopCacheKey(child, typedLoop));
      });
    });

    looseEdgeLoopCapStatesRef.current.forEach((state, key) => {
      if (currentKeys.has(key)) {
        return;
      }

      removeLooseEdgeLoopCapFill(state);
      looseEdgeLoopCapStatesRef.current.delete(key);
    });

    refreshLooseEdgeLoopCapVisibility();
    refreshCapOffsetGizmo();
  };

  const getLooseEdgeLoopCapMode = (edge: HoveredEdge) => {
    const key = getLooseEdgeLoopFillKey(edge);

    return looseEdgeLoopCapStatesRef.current.get(key)?.mode ?? "none";
  };

  const setLooseEdgeLoopCapMode = (edge: HoveredEdge, mode: LooseEdgeLoopMode) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const key = getLooseEdgeLoopFillKey(edge);
    const existingState = looseEdgeLoopCapStatesRef.current.get(key);
    const existingMode = existingState?.mode;
    const axisData =
      mode === "none"
        ? null
        : getLooseEdgeLoopCapAxisData(edge, mode, existingState?.normalTarget ?? null);

    if (mode === "none") {
      if (existingState) {
        removeLooseEdgeLoopCapFill(existingState);
        looseEdgeLoopCapStatesRef.current.delete(key);
      }
      refreshCapOffsetGizmo(edge);
      schedulePersistViewerState();
      return;
    }

    if (!axisData) {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const existingOffset = existingState?.offset;
    const state: LooseEdgeLoopCapState = existingState ?? {
      fill: null,
      mode,
      normalTarget: null,
      occlusionOverlay: null,
      objectId: edge.objectId,
      offset: axisData.defaultOffset,
      sourceMeshUuid: edge.mesh.uuid,
    };

    state.mode = mode;
    state.objectId = edge.objectId;
    state.sourceMeshUuid = edge.mesh.uuid;

    if (mode === "fill") {
      state.offset = axisData.defaultOffset;
    } else if (existingMode !== mode || !Number.isFinite(state.offset)) {
      state.offset = axisData.defaultOffset;
    }

    state.normalTarget = isNormalTargetLoopMode(mode)
      ? existingMode === mode && state.normalTarget
        ? state.normalTarget
        : axisData.data.center.clone().addScaledVector(axisData.axis, state.offset)
      : null;

    const existingFill = state.fill;
    const canReuseExistingFill =
      existingFill !== null &&
      existingMode === mode &&
      (mode !== "fill" ||
        Math.abs((existingOffset ?? axisData.defaultOffset) - axisData.defaultOffset) < 0.0001);

    if (canReuseExistingFill) {
      existingFill.visible = !hiddenObjectIdsRef.current.has(edge.objectId);
      looseEdgeLoopCapStatesRef.current.set(key, state);
      refreshCapOffsetGizmo(edge);
      schedulePersistViewerState();
      return;
    }

    rebuildLooseEdgeLoopCapFill(edge, key, state);
    refreshCapOffsetGizmo(edge);
    schedulePersistViewerState();
  };

  const setLooseEdgeLoopCapOffset = (edge: HoveredEdge, offset: number) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const key = getLooseEdgeLoopFillKey(edge);
    const state = looseEdgeLoopCapStatesRef.current.get(key);

    if (!state || state.mode === "none") {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const nextOffset = clampLooseEdgeLoopCapOffset(edge, state.mode, offset, state.normalTarget);

    if (Math.abs(nextOffset - state.offset) < 0.0001) {
      return;
    }

    state.offset = nextOffset;

    if (isNormalTargetLoopMode(state.mode)) {
      const axisData = getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget);

      if (axisData) {
        state.normalTarget = axisData.data.center
          .clone()
          .addScaledVector(axisData.axis, nextOffset);
      }
    }

    rebuildLooseEdgeLoopCapFill(edge, key, state);
    refreshCapOffsetGizmo(edge);
    schedulePersistViewerState();
  };

  const clearSelectedLooseEdgeLoop = () => {
    const currentLoop = selectedLooseEdgeLoopRef.current;
    const overlay = selectedLooseEdgeLoopOverlayRef.current;

    if (currentLoop) {
      setLooseEdgeLoopColor(currentLoop.mesh, currentLoop.loopId, looseEdgeColor);
    }

    if (overlay) {
      overlay.parent?.remove(overlay);
      disposeObject(overlay);
      selectedLooseEdgeLoopOverlayRef.current = null;
    }

    removeCapOffsetGizmo();
    selectedLooseEdgeLoopRef.current = null;
    setSelectedLooseEdgeLoopActive(false);
    refreshLooseEdgeLoopCapVisibility();
  };

  const resetViewerStateForModelLoad = () => {
    clearScheduledPersistenceSave();
    currentModelSourceRef.current = null;
    persistenceSaveFailedRef.current = false;
    nextSeparatedObjectIdRef.current = 1;
    hiddenObjectIdsRef.current = new Set();
    objectNamesRef.current = {};
    rememberedTriangleSelectionRef.current = null;
    selectedObjectIdRef.current = null;
    linkedFaceSelectionThresholdRef.current = defaultLinkedFaceSelectionAngle;
    setSeparateModeActiveState(false);
    setSeparationBusyState(false);
    setSeparationProgress(null);
    clearLooseEdgeLoopCapStates();
    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection();
    setLinkedFaceSelectionGraph(null);
    setLinkedFaceSelection({
      active: false,
      count: 0,
      threshold: defaultLinkedFaceSelectionAngle,
    });
    setLooseEdgeLoopMode("none");
    setSeparatedObjects([]);
    setSelectedObjectId(null);
    setSelectedLooseEdgeLoopActive(false);
  };

  const selectLooseEdgeLoop = (edge: HoveredEdge) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const modelRoot = rootRef.current;

    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection(true, true);
    clearHoverEdgeOverlay(edge);
    selectedLooseEdgeLoopRef.current = edge;
    setLooseEdgeLoopMode(getLooseEdgeLoopCapMode(edge));
    setSelectedLooseEdgeLoopActive(true);
    refreshLooseEdgeLoopCapVisibility();

    const overlay = createLooseEdgeLoopOverlay(edge, selectedLooseEdgeLoopColor);

    if (!overlay) {
      return;
    }

    (edge.mesh.parent ?? modelRoot)?.add(overlay);
    selectedLooseEdgeLoopOverlayRef.current = overlay;
    refreshCapOffsetGizmo(edge);
  };

  const handleLooseEdgeLoopModeChange = (mode: LooseEdgeLoopMode) => {
    if (!isEdgeLoopCapToolEnabled) {
      return;
    }

    const edge = selectedLooseEdgeLoopRef.current;

    setLooseEdgeLoopMode(mode);

    if (edge) {
      setLooseEdgeLoopCapMode(edge, mode);
    }
  };

  const rememberTriangleSelection = (mesh: THREE.Mesh, triangleIndex: number) => {
    rememberedTriangleSelectionRef.current = {
      mesh,
      objectId: getTriangleObjectId(mesh, triangleIndex),
      triangleIndex,
    };
  };

  const getRememberedSelectedTriangle = () => {
    const rememberedTriangle = rememberedTriangleSelectionRef.current;
    const selectedObjectId = selectedObjectIdRef.current;

    if (
      !rememberedTriangle ||
      selectedObjectId == null ||
      rememberedTriangle.objectId !== selectedObjectId ||
      hiddenObjectIdsRef.current.has(selectedObjectId) ||
      !isSelectableMesh(rememberedTriangle.mesh)
    ) {
      return null;
    }

    const position = rememberedTriangle.mesh.geometry.getAttribute("position");

    if (
      !(position instanceof THREE.BufferAttribute) ||
      rememberedTriangle.triangleIndex < 0 ||
      rememberedTriangle.triangleIndex >= Math.floor(position.count / 3) ||
      getTriangleObjectId(rememberedTriangle.mesh, rememberedTriangle.triangleIndex) !==
        selectedObjectId
    ) {
      return null;
    }

    return rememberedTriangle;
  };

  const applyLinkedFaceSelectionVisuals = (selection: LinkedFaceSelectionDetails | null) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !selection) {
      return;
    }

    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    applyLinkedFaceSelectionColors(selection);
    refreshSelectedObjectOutlines(modelRoot, hiddenObjectIdsRef.current, selection.objectId);
    clearLinkedFaceSelectionOverlay();
    clearSelectionBoundaryLoopOverlay();

    const overlay = createLinkedFaceSelectionOverlay(selection);

    if (overlay) {
      modelRoot.add(overlay);
      linkedFaceSelectionOverlayRef.current = overlay;
    }

    if (separateModeActiveRef.current) {
      const boundaryLoops = buildSelectionBoundaryLoops(selection);
      const boundaryOverlay = createSelectionBoundaryLoopOverlay(selection, boundaryLoops);

      selectionBoundaryLoopsRef.current = boundaryLoops;

      if (boundaryOverlay) {
        (selection.mesh.parent ?? modelRoot).add(boundaryOverlay);
        selectionBoundaryLoopOverlayRef.current = boundaryOverlay;
      }
    }

    updateHoverEdgeResolution(
      modelRoot,
      mountRef.current?.clientWidth ?? 1,
      mountRef.current?.clientHeight ?? 1,
    );
  };

  const clearLinkedFaceSelection = (clearObjectSelection = true, refreshVisuals = true) => {
    const modelRoot = rootRef.current;
    const hadLinkedFaceSelection = linkedFaceSelectionRef.current != null;

    linkedFaceSelectionRef.current = null;
    linkedFaceSelectionCacheRef.current = null;
    clearLinkedFaceSelectionOverlay();
    clearSelectionBoundaryLoopOverlay();
    setLinkedFaceSelectionGraph(null);
    setLinkedFaceSelection((current) => ({
      ...current,
      active: false,
      count: 0,
    }));

    if (clearObjectSelection) {
      rememberedTriangleSelectionRef.current = null;
      selectedObjectIdRef.current = null;
      setSelectedObjectId(null);
      setSeparateModeActiveState(false);
      setSeparationProgress(null);
      refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
    }

    if (modelRoot && refreshVisuals) {
      if (hadLinkedFaceSelection) {
        applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      }

      refreshSelectedObjectOutlines(
        modelRoot,
        hiddenObjectIdsRef.current,
        selectedObjectIdRef.current,
      );
      refreshLooseEdgeOverlays(
        modelRoot,
        hiddenObjectIdsRef.current,
        selectedObjectIdRef.current,
        false,
      );
    }
  };

  const toggleSeparateMode = () => {
    if (
      !isSeparationToolEnabledRef.current ||
      selectedObjectIdRef.current == null ||
      separationBusyRef.current
    ) {
      return;
    }

    const nextSeparateModeActive = !separateModeActiveRef.current;

    setSeparateModeActiveState(nextSeparateModeActive);
    setSeparationProgress(null);

    if (!nextSeparateModeActive) {
      clearLinkedFaceSelection(false);
      return;
    }

    if (linkedFaceSelectionRef.current) {
      applyLinkedFaceSelectionVisuals(linkedFaceSelectionRef.current);
      return;
    }

    const rememberedTriangle = getRememberedSelectedTriangle();

    if (rememberedTriangle) {
      void selectLinkedFace(rememberedTriangle.mesh, rememberedTriangle.triangleIndex);
    }
  };

  const refreshLinkedFaceSelection = (threshold: number) => {
    const currentSelection = linkedFaceSelectionRef.current;

    linkedFaceSelectionThresholdRef.current = threshold;

    if (!currentSelection) {
      setLinkedFaceSelection((current) => ({
        ...current,
        threshold,
      }));
      return;
    }

    const cache = linkedFaceSelectionCacheRef.current;
    const nextSelection =
      cache &&
      cache.mesh === currentSelection.mesh &&
      cache.seedTriangleIndex === currentSelection.seedTriangleIndex &&
      cache.objectId === currentSelection.objectId
        ? createLinkedFaceSelectionFromCache(cache, threshold)
        : buildLinkedFaceSelection(
            currentSelection.mesh,
            currentSelection.seedTriangleIndex,
            threshold,
          );

    if (!nextSelection) {
      clearLinkedFaceSelection();
      return;
    }

    linkedFaceSelectionRef.current = nextSelection;
    setLinkedFaceSelection({
      active: true,
      count: nextSelection.selectedTriangleIndexes.size,
      threshold,
    });
    applyLinkedFaceSelectionVisuals(nextSelection);
  };

  const commitLinkedFaceSelectionThreshold = (threshold: number) => {
    if (threshold === linkedFaceSelectionThresholdRef.current) {
      return;
    }

    refreshLinkedFaceSelection(threshold);
  };

  const selectLinkedFace = async (mesh: THREE.Mesh, triangleIndex: number) => {
    if (!isSeparationToolEnabledRef.current || separationBusyRef.current) {
      return;
    }

    setSeparationBusyState(true);
    setSeparationProgress("Calculating selection");
    await waitForBrowserPaint();

    try {
      const cache = buildLinkedFaceSelectionCache(mesh, triangleIndex);

      if (!cache) {
        return;
      }

      clearSelectedLooseEdgeLoop();

      const selection = createLinkedFaceSelectionFromCache(
        cache,
        linkedFaceSelectionThresholdRef.current,
      );

      linkedFaceSelectionRef.current = selection;
      linkedFaceSelectionCacheRef.current = cache;
      selectedObjectIdRef.current = selection.objectId;
      setSelectedObjectId(selection.objectId);
      refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
      refreshLooseEdgeOverlays(
        rootRef.current ?? selection.mesh,
        hiddenObjectIdsRef.current,
        selection.objectId,
        false,
      );
      refreshSelectedObjectOutlines(
        rootRef.current ?? selection.mesh,
        hiddenObjectIdsRef.current,
        selection.objectId,
      );
      setLinkedFaceSelectionGraph(cache);
      setLinkedFaceSelection({
        active: true,
        count: selection.selectedTriangleIndexes.size,
        threshold: linkedFaceSelectionThresholdRef.current,
      });
      applyLinkedFaceSelectionVisuals(selection);
    } finally {
      setSeparationBusyState(false);
      setSeparationProgress(null);
    }
  };

  const refreshSeparatedObjects = () => {
    const modelRoot = rootRef.current;

    setSeparatedObjects(
      modelRoot
        ? collectSeparatedObjects(modelRoot, hiddenObjectIdsRef.current, objectNamesRef.current)
        : [],
    );
  };

  const applyObjectVisibility = (nextHiddenObjectIds: Set<number>) => {
    const modelRoot = rootRef.current;
    const selection = linkedFaceSelectionRef.current;
    const currentSelectedObjectId = selectedObjectIdRef.current;
    const selectedLooseEdgeLoop = selectedLooseEdgeLoopRef.current;

    hiddenObjectIdsRef.current = nextHiddenObjectIds;
    refreshLooseEdgeLoopCapVisibility(nextHiddenObjectIds);

    if (
      rememberedTriangleSelectionRef.current &&
      nextHiddenObjectIds.has(rememberedTriangleSelectionRef.current.objectId)
    ) {
      rememberedTriangleSelectionRef.current = null;
    }

    if (selectedLooseEdgeLoop && nextHiddenObjectIds.has(selectedLooseEdgeLoop.objectId)) {
      clearSelectedLooseEdgeLoop();
    }

    if (selection && nextHiddenObjectIds.has(selection.objectId)) {
      clearLinkedFaceSelection();
    } else if (selection) {
      applyLinkedFaceSelectionVisuals(selection);
    } else if (modelRoot) {
      applyObjectColors(modelRoot, nextHiddenObjectIds);
    }

    if (currentSelectedObjectId != null && nextHiddenObjectIds.has(currentSelectedObjectId)) {
      rememberedTriangleSelectionRef.current = null;
      selectedObjectIdRef.current = null;
      setSelectedObjectId(null);
      setSeparateModeActiveState(false);
      setSeparationProgress(null);
    }

    refreshLooseEdgeLoopCapVisibility(nextHiddenObjectIds);

    if (modelRoot) {
      refreshObjectMaterialGroups(modelRoot, nextHiddenObjectIds);
      refreshObjectWireframes(modelRoot, nextHiddenObjectIds);
      refreshSelectedObjectOutlines(modelRoot, nextHiddenObjectIds, selectedObjectIdRef.current);
      refreshLooseEdgeOverlays(modelRoot, nextHiddenObjectIds, selectedObjectIdRef.current, false);
      setSeparatedObjects(
        collectSeparatedObjects(modelRoot, nextHiddenObjectIds, objectNamesRef.current),
      );
    } else {
      setSeparatedObjects([]);
    }

    schedulePersistViewerState();
  };

  const toggleObjectVisibility = (objectId: number) => {
    const nextHiddenObjectIds = new Set(hiddenObjectIdsRef.current);

    if (nextHiddenObjectIds.has(objectId)) {
      nextHiddenObjectIds.delete(objectId);
    } else {
      nextHiddenObjectIds.add(objectId);
    }

    applyObjectVisibility(nextHiddenObjectIds);
  };

  const hideSelectedObject = () => {
    const objectId = selectedObjectIdRef.current ?? linkedFaceSelectionRef.current?.objectId;

    if (objectId == null) {
      return;
    }

    const nextHiddenObjectIds = new Set(hiddenObjectIdsRef.current);

    nextHiddenObjectIds.add(objectId);
    applyObjectVisibility(nextHiddenObjectIds);
  };

  const showAllObjects = () => {
    if (hiddenObjectIdsRef.current.size === 0) {
      return;
    }

    applyObjectVisibility(new Set<number>());
  };

  const selectSeparatedObject = (objectId: number) => {
    if (separationBusyRef.current) {
      return;
    }

    const currentObjectId = selectedObjectIdRef.current;
    const hasLinkedFaceSelection = linkedFaceSelectionRef.current != null;

    if (currentObjectId === objectId && !hasLinkedFaceSelection) {
      return;
    }

    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection(false, false);
    setSeparationProgress(null);
    selectedObjectIdRef.current = objectId;
    setSelectedObjectId(objectId);
    refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);

    const modelRoot = rootRef.current;

    if (modelRoot) {
      if (hasLinkedFaceSelection) {
        applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      }

      refreshSelectedObjectOutlines(modelRoot, hiddenObjectIdsRef.current, objectId);
      refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, objectId, false);
    }
  };

  const renameSeparatedObject = (objectId: number, name: string) => {
    const trimmedName = name.trim();
    const nextObjectNames = { ...objectNamesRef.current };

    if (trimmedName.length === 0 || trimmedName === getDefaultSeparatedObjectLabel(objectId)) {
      delete nextObjectNames[objectId];
    } else {
      nextObjectNames[objectId] = trimmedName;
    }

    objectNamesRef.current = nextObjectNames;
    refreshSeparatedObjects();
    schedulePersistViewerState();
  };

  const handleSeparateSelection = async () => {
    if (!isSeparationToolEnabledRef.current || separationBusyRef.current) {
      return;
    }

    const selection = linkedFaceSelectionRef.current;
    const modelRoot = rootRef.current;

    if (!selection || !modelRoot || selection.selectedTriangleIndexes.size === 0) {
      return;
    }

    const objectIds = getTriangleObjectIds(selection.mesh);

    if (!objectIds) {
      return;
    }

    setSeparationBusyState(true);
    const reportProgress = createThrottledProgressReporter(setSeparationProgress);

    await reportProgress("Preparing separation", true);

    try {
      clearSelectedLooseEdgeLoop();

      const nextObjectId = nextSeparatedObjectIdRef.current;
      const selectedTriangleIndexes = Array.from(selection.selectedTriangleIndexes);

      if (selectedTriangleIndexes.length === 0) {
        return;
      }

      nextSeparatedObjectIdRef.current += 1;

      for (let index = 0; index < selectedTriangleIndexes.length; index += 1) {
        objectIds[selectedTriangleIndexes[index]] = nextObjectId;

        if (index > 0 && index % separationProgressCheckInterval === 0) {
          await reportProgress(`Assigning faces: ${index}/${selectedTriangleIndexes.length}`);
        }
      }

      await separateLooseObjectPartsAsync(
        selection.topology,
        objectIds,
        [selection.objectId, nextObjectId],
        () => {
          const loosePartObjectId = nextSeparatedObjectIdRef.current;

          nextSeparatedObjectIdRef.current += 1;

          return loosePartObjectId;
        },
        reportProgress,
      );

      await reportProgress("Refreshing model");

      rememberedTriangleSelectionRef.current = null;
      linkedFaceSelectionRef.current = null;
      linkedFaceSelectionCacheRef.current = null;
      clearLinkedFaceSelectionOverlay();
      clearSelectionBoundaryLoopOverlay();
      setLinkedFaceSelectionGraph(null);
      setLinkedFaceSelection((current) => ({
        ...current,
        active: false,
        count: 0,
      }));
      refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current);
      refreshSelectedObjectOutlines(
        modelRoot,
        hiddenObjectIdsRef.current,
        selectedObjectIdRef.current,
      );
      refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, selectedObjectIdRef.current);
      syncLooseEdgeLoopCapStates(modelRoot);
      refreshSeparatedObjects();
      schedulePersistViewerState();

      await reportProgress("Done");
    } finally {
      setSeparationBusyState(false);
      setSeparationProgress(null);
    }
  };

  const handleCutBoundaryLoop = async (boundaryLoop: SelectionBoundaryLoop) => {
    if (!isSeparationToolEnabledRef.current || separationBusyRef.current) {
      return;
    }

    const selection = linkedFaceSelectionRef.current;
    const modelRoot = rootRef.current;

    if (!selection || !modelRoot) {
      return;
    }

    const objectIds = getTriangleObjectIds(selection.mesh);

    if (!objectIds) {
      return;
    }

    setSeparationBusyState(true);
    const reportProgress = createThrottledProgressReporter(setSeparationProgress);

    await reportProgress("Cutting boundary", true);

    try {
      clearSelectedLooseEdgeLoop();

      if (!cutSelectionBoundaryLoopTopology(selection, boundaryLoop)) {
        return;
      }

      const topology = buildMeshTopology(selection.mesh);

      if (!topology) {
        return;
      }

      await separateLooseObjectPartsAsync(
        topology,
        objectIds,
        [selection.objectId],
        () => {
          const loosePartObjectId = nextSeparatedObjectIdRef.current;

          nextSeparatedObjectIdRef.current += 1;

          return loosePartObjectId;
        },
        reportProgress,
      );

      await reportProgress("Refreshing model");

      rememberedTriangleSelectionRef.current = null;
      linkedFaceSelectionRef.current = null;
      linkedFaceSelectionCacheRef.current = null;
      clearLinkedFaceSelectionOverlay();
      clearSelectionBoundaryLoopOverlay();
      setLinkedFaceSelectionGraph(null);
      setLinkedFaceSelection((current) => ({
        ...current,
        active: false,
        count: 0,
      }));
      refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current);
      refreshSelectedObjectOutlines(
        modelRoot,
        hiddenObjectIdsRef.current,
        selectedObjectIdRef.current,
      );
      refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, selectedObjectIdRef.current);
      syncLooseEdgeLoopCapStates(modelRoot);
      refreshSeparatedObjects();
      schedulePersistViewerState();

      await reportProgress("Done");
    } finally {
      setSeparationBusyState(false);
      setSeparationProgress(null);
    }
  };

  const separateByBoundaryLoop = (loopId: number) => {
    if (!isSeparationToolEnabledRef.current) {
      return;
    }

    const loop = selectionBoundaryLoopsRef.current.find((item) => item.id === loopId);

    if (!loop) {
      return;
    }

    void handleCutBoundaryLoop(loop);
  };

  useEffect(() => {
    isSeparationToolEnabledRef.current = isSeparationToolEnabled;
    isEdgeLoopCapToolEnabledRef.current = isEdgeLoopCapToolEnabled;
    clearLinkedFaceSelectionHandlerRef.current = clearLinkedFaceSelection;
    clearSelectedLooseEdgeLoopHandlerRef.current = clearSelectedLooseEdgeLoop;
    hideSelectedObjectHandlerRef.current = hideSelectedObject;
    selectLinkedFaceHandlerRef.current = selectLinkedFace;
    selectLooseEdgeLoopHandlerRef.current = selectLooseEdgeLoop;
    selectSeparatedObjectHandlerRef.current = selectSeparatedObject;
    schedulePersistViewerStateHandlerRef.current = schedulePersistViewerState;
    separateByBoundaryLoopHandlerRef.current = separateByBoundaryLoop;
    setLooseEdgeLoopCapOffsetHandlerRef.current = setLooseEdgeLoopCapOffset;
    setLooseEdgeLoopCapTargetHandlerRef.current = setLooseEdgeLoopCapTarget;
    showAllObjectsHandlerRef.current = showAllObjects;
    syncLooseEdgeLoopCapStatesHandlerRef.current = syncLooseEdgeLoopCapStates;
  });

  const loadModelIntoViewer = async (
    modelRoot: THREE.Group,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    loader: GLTFLoader,
    source: PersistedModelSource,
    persistedState: PersistedViewerState | null = null,
    isCancelled: () => boolean = () => false,
  ) => {
    const gltf = await loader.parseAsync(cloneArrayBuffer(source.data), "");

    if (isCancelled()) {
      return false;
    }

    const model = gltf.scene;
    let hadInvalidPersistedState = false;

    resetViewerStateForModelLoad();
    clearModel(modelRoot);
    styleModel(model);
    normalizeModel(model);

    if (persistedState) {
      hadInvalidPersistedState = applyPersistedMeshStates(model, persistedState.meshes);
      hiddenObjectIdsRef.current = new Set(
        persistedState.hiddenObjectIds.filter((objectId) => Number.isFinite(objectId)),
      );
      objectNamesRef.current = getRestoredObjectNames(persistedState.objectNames);
      nextSeparatedObjectIdRef.current = Math.max(
        persistedState.nextObjectId,
        getMaxObjectId(model) + 1,
        1,
      );
    }

    modelRoot.add(model);
    updateHoverEdgeResolution(
      model,
      mountRef.current?.clientWidth ?? 1,
      mountRef.current?.clientHeight ?? 1,
    );
    hoveredEdgeRef.current = null;
    refreshObjectMaterialGroups(model, hiddenObjectIdsRef.current);
    applyObjectColors(model, hiddenObjectIdsRef.current);
    refreshObjectWireframes(model, hiddenObjectIdsRef.current);
    refreshSelectedObjectOutlines(model, hiddenObjectIdsRef.current, selectedObjectIdRef.current);
    refreshLooseEdgeOverlays(model, hiddenObjectIdsRef.current, selectedObjectIdRef.current);

    if (persistedState) {
      hadInvalidPersistedState =
        restoreLooseEdgeLoopCapStates(model, persistedState.loopCapStates) ||
        hadInvalidPersistedState;
    }

    setSeparatedObjects(
      collectSeparatedObjects(modelRoot, hiddenObjectIdsRef.current, objectNamesRef.current),
    );
    frameModel(camera, controls, model);
    currentModelSourceRef.current = {
      ...source,
      data: cloneArrayBuffer(source.data),
    };
    setLoadState("ready");
    setStatusText(source.name);

    if (hadInvalidPersistedState) {
      showToast("Some saved edits could not be restored.");
    }

    return true;
  };

  const restorePersistedViewerState = async (
    modelRoot: THREE.Group,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    loader: GLTFLoader,
    isCancelled: () => boolean,
  ) => {
    let persistedState: PersistedViewerState | null = null;
    const restoreLoadVersion = modelLoadVersionRef.current;
    const isRestoreCancelled = () =>
      isCancelled() || modelLoadVersionRef.current !== restoreLoadVersion;

    try {
      persistedState = await readPersistedViewerState();
    } catch {
      if (!isRestoreCancelled()) {
        showToast("Could not read the saved model.");
      }

      return;
    }

    if (!persistedState || isRestoreCancelled()) {
      return;
    }

    isRestoringPersistedStateRef.current = true;
    setLoadState("loading");
    setStatusText(`Restoring ${persistedState.source.name}`);

    try {
      await loadModelIntoViewer(
        modelRoot,
        camera,
        controls,
        loader,
        persistedState.source,
        persistedState,
        isRestoreCancelled,
      );
    } catch {
      if (!isRestoreCancelled()) {
        resetViewerStateForModelLoad();
        clearModel(modelRoot);
        setLoadState("error");
        setStatusText("Could not restore saved model");
        showToast("Could not restore the saved model.");

        try {
          await clearPersistedViewerState();
        } catch {
          showToast("Could not clear the failed saved model.");
        }
      }
    } finally {
      isRestoringPersistedStateRef.current = false;
    }
  };

  useEffect(() => {
    restorePersistedViewerStateHandlerRef.current = restorePersistedViewerState;
  });

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f2f0);

    const camera = new THREE.PerspectiveCamera(45, 1, cameraNearPlane, 1000);
    camera.position.set(4, 3, 6);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
    } catch {
      const errorTimeout = window.setTimeout(() => {
        setLoadState("error");
        setStatusText("WebGL is not available");
      }, 0);

      return () => window.clearTimeout(errorTimeout);
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = minOrbitDistance;
    controls.maxDistance = maxOrbitDistance;
    controls.zoomSpeed = 1.2;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));

    const grid = new THREE.GridHelper(targetModelSize * 1.8, 18, 0x6f6f6f, 0xd8d8d8);
    grid.position.y = -targetModelSize / 2 - 0.02;
    scene.add(grid);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const modelRoot = new THREE.Group();
    rootRef.current = modelRoot;
    scene.add(modelRoot);

    const loader = new GLTFLoader();
    loaderRef.current = loader;

    const capNormalTarget = new THREE.Object3D();
    capNormalTarget.name = "cap-normal-target-overlay";
    capNormalTarget.visible = false;
    capNormalTarget.userData.isCapOffsetGizmoOverlay = true;
    scene.add(capNormalTarget);
    capNormalTargetRef.current = capNormalTarget;

    const capNormalTransformControls = new TransformControls(camera, renderer.domElement);
    capNormalTransformControls.setMode("translate");
    capNormalTransformControls.setSpace("world");
    capNormalTransformControls.setSize(0.7);
    capNormalTransformControls.showXY = false;
    capNormalTransformControls.showYZ = false;
    capNormalTransformControls.showXZ = false;
    capNormalTransformControls.setColors(0xef4444, 0x22c55e, 0x3b82f6, 0xfacc15);

    const capNormalTransformHelper = capNormalTransformControls.getHelper();
    capNormalTransformHelper.name = "cap-normal-transform-gizmo-overlay";
    capNormalTransformHelper.visible = false;
    capNormalTransformHelper.renderOrder = looseEdgeHoverRenderOrder + 1;
    capNormalTransformHelper.traverse((child) => {
      child.renderOrder = looseEdgeHoverRenderOrder + 1;
      child.userData.isCapOffsetGizmoOverlay = true;

      if (!isDisposableDrawObject(child)) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];

      materials.forEach((material) => {
        material.depthTest = false;
        material.depthWrite = false;
        material.opacity = 0.96;
        material.transparent = true;
      });
    });
    scene.add(capNormalTransformHelper);
    capNormalTransformControlsRef.current = capNormalTransformControls;
    capNormalTransformHelperRef.current = capNormalTransformHelper;

    const handleCapNormalTransformDragging = (event: { value: unknown }) => {
      controls.enabled = event.value !== true;
    };

    const handleCapNormalTransformChange = () => {
      if (!isEdgeLoopCapToolEnabledRef.current) {
        return;
      }

      const edge = selectedLooseEdgeLoopRef.current;
      const target = capNormalTargetRef.current;

      if (!edge || !target) {
        return;
      }

      const targetWorld = target.getWorldPosition(new THREE.Vector3());
      const targetLocal = edge.mesh.worldToLocal(targetWorld.clone());

      setLooseEdgeLoopCapTargetHandlerRef.current?.(edge, targetLocal);
    };

    capNormalTransformControls.addEventListener(
      "dragging-changed",
      handleCapNormalTransformDragging,
    );
    capNormalTransformControls.addEventListener("objectChange", handleCapNormalTransformChange);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { edge: HoveredEdge | null; x: number; y: number } | null = null;

    const clearHoveredEdge = () => {
      const currentEdge = hoveredEdgeRef.current;

      clearHoverEdgeOverlay(currentEdge);

      if (
        currentEdge?.isLooseEdge &&
        !isSameLooseEdgeLoop(currentEdge, selectedLooseEdgeLoopRef.current)
      ) {
        setLooseEdgeLoopColor(currentEdge.mesh, currentEdge.loopId, looseEdgeColor);
      }

      hoveredEdgeRef.current = null;
    };

    const setHoveredEdge = (edge: HoveredEdge) => {
      if (
        (edge.isLooseEdge && !isEdgeLoopCapToolEnabledRef.current) ||
        (edge.isSelectionBoundary && !isSeparationToolEnabledRef.current)
      ) {
        return;
      }

      if (edge.isLooseEdge) {
        if (isSameLooseEdgeLoop(edge, selectedLooseEdgeLoopRef.current)) {
          clearHoverEdgeOverlay(edge);
        } else {
          setHoverEdgeOverlay(edge);
        }

        hoveredEdgeRef.current = edge;
        return;
      }

      hoveredEdgeRef.current = edge;
      setHoverEdgeOverlay(edge);
    };

    const getMeshHitAtPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      return raycaster.intersectObjects(modelRoot.children, true).find((intersection) => {
        if (!isSelectableMesh(intersection.object) || intersection.faceIndex == null) {
          return false;
        }

        const objectIds = getTriangleObjectIds(intersection.object);
        const objectId = objectIds?.[intersection.faceIndex] ?? defaultObjectId;

        return !hiddenObjectIdsRef.current.has(objectId);
      });
    };

    const getEdgeAtPointer = (event: PointerEvent) => {
      const hit = getMeshHitAtPointer(event);
      return hit ? getHoveredEdgeFromHit(hit) : null;
    };

    const getLooseEdgeAtPointer = (event: PointerEvent) => {
      if (!isEdgeLoopCapToolEnabledRef.current) {
        return null;
      }

      const viewport = renderer.domElement.getBoundingClientRect();
      let closestEdge: HoveredEdge | null = null;
      let closestDistance = looseEdgeHoverHitTolerancePx;

      modelRoot.updateMatrixWorld(true);
      modelRoot.traverse((child) => {
        if (!isSelectableMesh(child)) {
          return;
        }

        const segmentsByKey = child.userData.looseEdgeSegmentsByKey as
          | Map<string, LooseEdgeSegment>
          | undefined;

        if (!(segmentsByKey instanceof Map)) {
          return;
        }

        segmentsByKey.forEach((segment) => {
          if (hiddenObjectIdsRef.current.has(segment.objectId)) {
            return;
          }

          const start = getScreenPoint(
            segment.start.clone().applyMatrix4(child.matrixWorld),
            camera,
            viewport,
          );
          const end = getScreenPoint(
            segment.end.clone().applyMatrix4(child.matrixWorld),
            camera,
            viewport,
          );

          if (!start || !end) {
            return;
          }

          const distance = getPointToSegmentDistance(
            event.clientX,
            event.clientY,
            start.x,
            start.y,
            end.x,
            end.y,
          );

          if (distance > closestDistance) {
            return;
          }

          closestDistance = distance;
          closestEdge = {
            end: segment.end,
            isLooseEdge: true,
            key: segment.edgeKey,
            loopId: segment.loopId,
            mesh: child,
            objectId: segment.objectId,
            start: segment.start,
          };
        });
      });

      return closestEdge;
    };

    const getSelectionBoundaryEdgeAtPointer = (event: PointerEvent) => {
      if (!isSeparationToolEnabledRef.current) {
        return null;
      }

      const selection = linkedFaceSelectionRef.current;

      if (
        !separateModeActiveRef.current ||
        !selection ||
        hiddenObjectIdsRef.current.has(selection.objectId)
      ) {
        return null;
      }

      const boundaryLoops = selectionBoundaryLoopsRef.current;

      if (boundaryLoops.length === 0) {
        return null;
      }

      const viewport = renderer.domElement.getBoundingClientRect();
      const start = new THREE.Vector3();
      const end = new THREE.Vector3();
      const startWorld = new THREE.Vector3();
      const endWorld = new THREE.Vector3();
      let closestEdge: HoveredEdge | null = null;
      let closestDistance = looseEdgeHoverHitTolerancePx;

      selection.mesh.updateMatrixWorld(true);

      boundaryLoops.forEach((loop) => {
        for (let index = 0; index < loop.positions.length; index += 6) {
          start.set(loop.positions[index], loop.positions[index + 1], loop.positions[index + 2]);
          end.set(loop.positions[index + 3], loop.positions[index + 4], loop.positions[index + 5]);

          const startScreen = getScreenPoint(
            startWorld.copy(start).applyMatrix4(selection.mesh.matrixWorld),
            camera,
            viewport,
          );
          const endScreen = getScreenPoint(
            endWorld.copy(end).applyMatrix4(selection.mesh.matrixWorld),
            camera,
            viewport,
          );

          if (!startScreen || !endScreen) {
            continue;
          }

          const distance = getPointToSegmentDistance(
            event.clientX,
            event.clientY,
            startScreen.x,
            startScreen.y,
            endScreen.x,
            endScreen.y,
          );

          if (distance > closestDistance) {
            continue;
          }

          closestDistance = distance;
          closestEdge = {
            boundaryPositions: loop.positions,
            end: end.clone(),
            isSelectionBoundary: true,
            key: `selection-boundary:${loop.id}:${index}`,
            loopId: loop.id,
            mesh: selection.mesh,
            objectId: selection.objectId,
            start: start.clone(),
          };
        }
      });

      return closestEdge;
    };

    const getTriangleAtPointer = (event: PointerEvent) => {
      const hit = getMeshHitAtPointer(event);

      if (!hit || hit.faceIndex == null || !isSelectableMesh(hit.object)) {
        return null;
      }

      return {
        mesh: hit.object,
        triangleIndex: hit.faceIndex,
      };
    };

    const finishCapOffsetDrag = (event?: PointerEvent) => {
      if (!isEdgeLoopCapToolEnabledRef.current) {
        return false;
      }

      const drag = capOffsetDragRef.current;

      if (!drag) {
        return false;
      }

      if (event && renderer.domElement.hasPointerCapture(drag.pointerId)) {
        renderer.domElement.releasePointerCapture(drag.pointerId);
      }

      capOffsetDragRef.current = null;
      controls.enabled = true;
      schedulePersistViewerStateHandlerRef.current?.();

      return true;
    };

    const isCapNormalTransformActive = () =>
      isEdgeLoopCapToolEnabledRef.current &&
      (capNormalTransformControls.dragging || capNormalTransformControls.axis !== null);

    const getCapOffsetDragAtPointer = (event: PointerEvent): CapOffsetDragState | null => {
      if (!isEdgeLoopCapToolEnabledRef.current) {
        return null;
      }

      const handle = capOffsetGizmoHandleRef.current;
      const edge = selectedLooseEdgeLoopRef.current;

      if (!handle || !edge || !handle.visible) {
        return null;
      }

      const key = getLooseEdgeLoopFillKey(edge);
      const state = looseEdgeLoopCapStatesRef.current.get(key);
      const axisData = state
        ? getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget)
        : null;

      if (!state || !axisData || isNormalTargetLoopMode(state.mode)) {
        return null;
      }

      const rect = renderer.domElement.getBoundingClientRect();

      edge.mesh.updateMatrixWorld(true);

      const targetOffset = axisData.axis.clone().multiplyScalar(state.offset);
      const loopSize = new THREE.Box3()
        .setFromPoints(axisData.data.points)
        .getSize(new THREE.Vector3());
      const loopSpan = Math.max(loopSize.x, loopSize.y, loopSize.z);
      const visualLength = Math.max(
        targetOffset.length(),
        loopSpan * 0.12,
        capOffsetGizmoMinLength,
      );
      const startScreen = getScreenPoint(
        edge.mesh.localToWorld(axisData.data.center.clone()),
        camera,
        rect,
      );
      const endScreen = getScreenPoint(
        edge.mesh.localToWorld(
          axisData.data.center.clone().addScaledVector(axisData.axis, visualLength),
        ),
        camera,
        rect,
      );

      if (!startScreen || !endScreen) {
        return null;
      }

      const hitDistance = getPointToSegmentDistance(
        event.clientX,
        event.clientY,
        startScreen.x,
        startScreen.y,
        endScreen.x,
        endScreen.y,
      );

      if (hitDistance > capOffsetGizmoHitTolerancePx) {
        return null;
      }

      const screenAxis = new THREE.Vector2(0, -1);
      let pixelsPerOffsetUnit = 80;

      screenAxis.set(endScreen.x - startScreen.x, endScreen.y - startScreen.y);
      pixelsPerOffsetUnit = screenAxis.length() / visualLength;

      if (pixelsPerOffsetUnit >= 4) {
        screenAxis.normalize();
      } else {
        screenAxis.set(0, -1);
        pixelsPerOffsetUnit = 80;
      }

      return {
        edge,
        pixelsPerOffsetUnit,
        pointerId: event.pointerId,
        screenAxis,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset: state.offset,
      };
    };

    const updateCapOffsetDrag = (event: PointerEvent) => {
      const drag = capOffsetDragRef.current;

      if (!drag) {
        return false;
      }

      if (!drag.screenAxis || !drag.pixelsPerOffsetUnit) {
        return false;
      }

      const deltaPixels = new THREE.Vector2(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      ).dot(drag.screenAxis);

      setLooseEdgeLoopCapOffsetHandlerRef.current?.(
        drag.edge,
        drag.startOffset + deltaPixels / drag.pixelsPerOffsetUnit,
      );
      event.preventDefault();

      return true;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      if (isCapNormalTransformActive()) {
        pointerStart = null;
        clearHoveredEdge();
        return;
      }

      const capOffsetDrag = getCapOffsetDragAtPointer(event);

      if (capOffsetDrag) {
        capOffsetDragRef.current = capOffsetDrag;
        pointerStart = null;
        controls.enabled = false;
        clearHoveredEdge();
        renderer.domElement.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      const clickedEdge = !event.shiftKey
        ? hoveredEdgeRef.current?.isSelectionBoundary === true ||
          hoveredEdgeRef.current?.isLooseEdge === true
          ? hoveredEdgeRef.current
          : (getSelectionBoundaryEdgeAtPointer(event) ?? getLooseEdgeAtPointer(event))
        : null;

      pointerStart = {
        edge: clickedEdge,
        x: event.clientX,
        y: event.clientY,
      };

      if (!event.shiftKey) {
        clearHoveredEdge();
        return;
      }

      const edge = getEdgeAtPointer(event);

      clearHoveredEdge();

      if (!edge) {
        return;
      }

      setHoveredEdge(edge);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (finishCapOffsetDrag(event)) {
        return;
      }

      if (event.button !== 0 || !pointerStart) {
        return;
      }

      const clickedEdge = pointerStart.edge;
      const moveDistance = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      pointerStart = null;

      if (moveDistance > clickMoveTolerance) {
        return;
      }

      if (separationBusyRef.current) {
        return;
      }

      if (!event.shiftKey) {
        if (clickedEdge?.isSelectionBoundary && clickedEdge.loopId != null) {
          separateByBoundaryLoopHandlerRef.current?.(clickedEdge.loopId);
          return;
        }

        if (clickedEdge?.isLooseEdge) {
          selectLooseEdgeLoopHandlerRef.current?.(clickedEdge);
          return;
        }

        clearSelectedLooseEdgeLoopHandlerRef.current?.();
        clearHoveredEdge();
        const triangle = getTriangleAtPointer(event);

        if (triangle) {
          const objectId = getTriangleObjectId(triangle.mesh, triangle.triangleIndex);

          if (separateModeActiveRef.current && selectedObjectIdRef.current === objectId) {
            rememberTriangleSelection(triangle.mesh, triangle.triangleIndex);
            selectLinkedFaceHandlerRef.current?.(triangle.mesh, triangle.triangleIndex);
          } else {
            rememberTriangleSelection(triangle.mesh, triangle.triangleIndex);
            selectSeparatedObjectHandlerRef.current?.(objectId);
          }
        } else {
          clearLinkedFaceSelectionHandlerRef.current?.();
        }

        return;
      }

      const edge = hoveredEdgeRef.current ?? getEdgeAtPointer(event);

      if (!edge) {
        return;
      }

      if (!swapHoveredEdgeDiagonal(edge)) {
        return;
      }

      clearHoveredEdge();
      clearSelectedLooseEdgeLoopHandlerRef.current?.();
      clearLinkedFaceSelectionHandlerRef.current?.();
      refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current);
      refreshSelectedObjectOutlines(
        modelRoot,
        hiddenObjectIdsRef.current,
        selectedObjectIdRef.current,
      );
      refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, selectedObjectIdRef.current);
      syncLooseEdgeLoopCapStatesHandlerRef.current?.(modelRoot);
      schedulePersistViewerStateHandlerRef.current?.();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isCapNormalTransformActive()) {
        clearHoveredEdge();
        return;
      }

      if (updateCapOffsetDrag(event)) {
        return;
      }

      const edge = event.shiftKey
        ? getEdgeAtPointer(event)
        : (getSelectionBoundaryEdgeAtPointer(event) ?? getLooseEdgeAtPointer(event));
      const currentEdge = hoveredEdgeRef.current;

      if (
        currentEdge &&
        edge &&
        currentEdge.mesh === edge.mesh &&
        currentEdge.isLooseEdge === edge.isLooseEdge &&
        currentEdge.isSelectionBoundary === edge.isSelectionBoundary &&
        (edge.isLooseEdge || edge.isSelectionBoundary
          ? currentEdge.loopId === edge.loopId
          : currentEdge.key === edge.key)
      ) {
        return;
      }

      clearHoveredEdge();

      if (!edge) {
        return;
      }

      setHoveredEdge(edge);
    };

    const handlePointerLeave = () => {
      if (capOffsetDragRef.current || isCapNormalTransformActive()) {
        return;
      }

      clearHoveredEdge();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      finishCapOffsetDrag(event);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        clearHoveredEdge();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "h") {
        return;
      }

      if (event.altKey || event.metaKey) {
        event.preventDefault();
        showAllObjectsHandlerRef.current?.();
        return;
      }

      if (event.ctrlKey) {
        return;
      }

      event.preventDefault();
      hideSelectedObjectHandlerRef.current?.();
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const handleResize = () => {
      const { clientWidth, clientHeight } = mount;

      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
      updateHoverEdgeResolution(modelRoot, clientWidth, clientHeight);
      controls.update();
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    let animationFrame = 0;

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };

    render();

    let disposed = false;

    void restorePersistedViewerStateHandlerRef.current?.(
      modelRoot,
      camera,
      controls,
      loader,
      () => disposed,
    );

    return () => {
      disposed = true;
      if (persistenceSaveTimeoutRef.current != null) {
        window.clearTimeout(persistenceSaveTimeoutRef.current);
        persistenceSaveTimeoutRef.current = null;
      }
      if (toastTimeoutRef.current != null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      capNormalTransformControls.removeEventListener(
        "dragging-changed",
        handleCapNormalTransformDragging,
      );
      capNormalTransformControls.removeEventListener(
        "objectChange",
        handleCapNormalTransformChange,
      );
      removeCapOffsetGizmo();
      capNormalTransformHelper.parent?.remove(capNormalTransformHelper);
      capNormalTransformControls.dispose();
      capNormalTarget.parent?.remove(capNormalTarget);
      capNormalTargetRef.current = null;
      capNormalTransformControlsRef.current = null;
      capNormalTransformHelperRef.current = null;
      clearModel(modelRoot);
      rootRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      loaderRef.current = null;
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const openGlbFile = async (file: File) => {
    const loader = loaderRef.current;
    const modelRoot = rootRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!loader || !modelRoot || !camera || !controls) {
      setLoadState("error");
      setStatusText("Viewer is still starting");
      showToast("Viewer is still starting.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".glb")) {
      setLoadState("error");
      setStatusText("Choose a .glb file");
      showToast("Choose a .glb file.");
      return;
    }

    modelLoadVersionRef.current += 1;
    const loadVersion = modelLoadVersionRef.current;
    const isCancelled = () => modelLoadVersionRef.current !== loadVersion;

    setLoadState("loading");
    setStatusText(`Loading ${file.name}`);
    resetViewerStateForModelLoad();
    clearModel(modelRoot);

    try {
      await clearPersistedViewerState();
    } catch {
      showToast("Could not reset saved model state.");
    }

    try {
      const data = await file.arrayBuffer();

      if (isCancelled()) {
        return;
      }

      await loadModelIntoViewer(
        modelRoot,
        camera,
        controls,
        loader,
        {
          data,
          lastModified: file.lastModified,
          name: file.name,
          size: file.size,
          type: file.type,
        },
        null,
        isCancelled,
      );

      if (!isCancelled()) {
        await persistViewerStateNow();
      }
    } catch {
      if (isCancelled()) {
        return;
      }

      currentModelSourceRef.current = null;
      clearScheduledPersistenceSave();
      clearModel(modelRoot);
      setLoadState("error");
      setStatusText("Could not load this GLB");
      showToast("Could not load this GLB.");
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    void openGlbFile(file);
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-neutral-200 text-neutral-950">
      <div
        ref={mountRef}
        className={`absolute inset-0 ${isSeparationToolEnabled && separateModeActive ? "cursor-crosshair" : ""}`}
        aria-label="3D viewport"
      />

      <TopBar
        inputRef={inputRef}
        loadState={loadState}
        statusText={statusText}
        onFileChange={handleFileChange}
      />
      <ObjectsPanel
        objects={separatedObjects}
        selectedObjectId={selectedObjectId}
        onRenameObject={renameSeparatedObject}
        onSelectObject={selectSeparatedObject}
        onToggleVisibility={toggleObjectVisibility}
      />
      {isSeparationToolEnabled ? (
        <SeparationToolPanel
          graph={linkedFaceSelectionGraph}
          graphHeight={linkedFaceSelectionGraphHeight}
          graphWidth={linkedFaceSelectionGraphWidth}
          isAvailable={selectedObjectId != null}
          isModeActive={separateModeActive}
          isProcessing={separationBusy}
          maxAngle={maxLinkedFaceSelectionAngle}
          progressText={separationProgress}
          selection={linkedFaceSelection}
          onClear={() => clearLinkedFaceSelection(false)}
          onCommitThreshold={commitLinkedFaceSelectionThreshold}
          onSeparate={handleSeparateSelection}
          onToggleMode={toggleSeparateMode}
        />
      ) : null}
      {isEdgeLoopCapToolEnabled ? (
        <EdgeLoopCapToolPanel
          active={selectedLooseEdgeLoopActive}
          mode={looseEdgeLoopMode}
          onModeChange={handleLooseEdgeLoopModeChange}
        />
      ) : null}
      {toast ? (
        <div
          role="alert"
          className="pointer-events-none absolute bottom-4 left-4 max-w-[calc(100vw-2rem)] rounded-md bg-red-950/90 px-3 py-2 text-sm text-white shadow-lg"
        >
          {toast.text}
        </div>
      ) : null}
    </main>
  );
}
