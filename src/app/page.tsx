"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LinkedFaceSelectionPanel } from "./viewer-controls/linked-face-selection-panel";
import { ObjectsPanel } from "./viewer-controls/objects-panel";
import { TopBar } from "./viewer-controls/top-bar";
import type {
  LinkedFaceSelectionGraph,
  LinkedFaceSelectionState,
  LoadState,
  SeparatedObjectSummary,
} from "./viewer-controls/types";

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
const linkedFaceSelectionColor = new THREE.Color(0xfacc15);
const linkedFaceSelectionLineWidth = 2;
const defaultLinkedFaceSelectionAngle = 10;
const maxLinkedFaceSelectionAngle = 90;
const linkedFaceSelectionGraphInterval = 0.1;
const linkedFaceSelectionGraphWidth = 240;
const linkedFaceSelectionGraphHeight = 56;
const minLoosePartTriangleCountToSeparate = 10;

type TriangleEdgeFace = {
  direction: THREE.Vector3;
  normal: THREE.Vector3;
};
type TriangleVertex = {
  key: string;
  point: THREE.Vector3;
};
type HoveredEdge = {
  end: THREE.Vector3;
  key: string;
  mesh: THREE.Mesh;
  start: THREE.Vector3;
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
type LinkedFaceSelectionCache = LinkedFaceSelectionGraph & {
  mesh: THREE.Mesh;
  objectId: number;
  seedTriangleIndex: number;
  thresholdByTriangle: Float32Array;
  topology: MeshTopology;
};
type DisposableDrawObject = THREE.Object3D & {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
};
type ObjectNameMap = Record<number, string>;

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

  return [
    Math.round(position.getX(index) * precision),
    Math.round(position.getY(index) * precision),
    Math.round(position.getZ(index) * precision),
  ].join(",");
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

function refreshMeshObjectMaterialGroups(mesh: THREE.Mesh, hiddenObjectIds: Set<number>) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);

  if (!(position instanceof THREE.BufferAttribute) || !objectIds || objectIds.length === 0) {
    return;
  }

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

    const hoverEdge = new Line2(
      new LineGeometry(),
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
    hoverEdge.renderOrder = 3;
    hoverEdge.userData.isHoverEdgeOverlay = true;
    hoverEdge.visible = false;
    mesh.userData.hoverEdgeOverlay = hoverEdge;

    overlays.push({
      overlay: wireframe,
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

function createHoverEdgeGeometry(start: THREE.Vector3, end: THREE.Vector3) {
  const geometry = new LineGeometry();

  geometry.setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);

  return geometry;
}

function clearHoverEdgeOverlay(edge: HoveredEdge | null) {
  const hoverEdge = edge?.mesh.userData.hoverEdgeOverlay as Line2 | undefined;

  if (hoverEdge) {
    hoverEdge.visible = false;
  }
}

function setHoverEdgeOverlay(edge: HoveredEdge) {
  const hoverEdge = edge.mesh.userData.hoverEdgeOverlay as Line2 | undefined;

  if (!hoverEdge) {
    return;
  }

  hoverEdge.geometry.dispose();
  hoverEdge.geometry = createHoverEdgeGeometry(edge.start, edge.end);
  hoverEdge.visible = true;
}

function updateHoverEdgeResolution(model: THREE.Object3D, width: number, height: number) {
  model.traverse((child) => {
    if (
      (child.userData.isHoverEdgeOverlay !== true &&
        child.userData.isLinkedFaceSelectionOverlay !== true) ||
      !isDisposableDrawObject(child)
    ) {
      return;
    }

    if (child.material instanceof LineMaterial) {
      child.material.resolution.set(width, height);
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

function getObjectConnectedComponents(
  topology: MeshTopology,
  objectIds: Uint32Array,
  objectId: number,
) {
  const unvisitedTriangleIndexes = new Set<number>();
  const components: number[][] = [];

  objectIds.forEach((triangleObjectId, triangleIndex) => {
    if (triangleObjectId === objectId && topology.triangles[triangleIndex]) {
      unvisitedTriangleIndexes.add(triangleIndex);
    }
  });

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
    }

    components.push(component);
  }

  return components;
}

function separateLooseObjectParts(
  topology: MeshTopology,
  objectIds: Uint32Array,
  objectIdsToScan: number[],
  getNextObjectId: () => number,
) {
  new Set(objectIdsToScan).forEach((objectId) => {
    const components = getObjectConnectedComponents(topology, objectIds, objectId);

    if (components.length <= 1) {
      return;
    }

    components
      .sort((first, second) => second.length - first.length)
      .slice(1)
      .forEach((component) => {
        if (component.length < minLoosePartTriangleCountToSeparate) {
          return;
        }

        const nextObjectId = getNextObjectId();

        component.forEach((triangleIndex) => {
          objectIds[triangleIndex] = nextObjectId;
        });
      });
  });
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

function applyObjectColors(model: THREE.Object3D, hiddenObjectIds = new Set<number>()) {
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (
      !isMesh(child) ||
      child.userData.isWireframeOverlay === true ||
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
  const coordinates = vertexKey.split(",").map((value) => Number(value) / 100000);

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
    object.userData.isHoverEdgeOverlay !== true
  );
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const linkedFaceSelectionRef = useRef<LinkedFaceSelectionDetails | null>(null);
  const linkedFaceSelectionCacheRef = useRef<LinkedFaceSelectionCache | null>(null);
  const linkedFaceSelectionOverlayRef = useRef<LineSegments2 | null>(null);
  const linkedFaceSelectionThresholdRef = useRef(defaultLinkedFaceSelectionAngle);
  const nextSeparatedObjectIdRef = useRef(1);
  const hiddenObjectIdsRef = useRef<Set<number>>(new Set());
  const objectNamesRef = useRef<ObjectNameMap>({});
  const selectedObjectIdRef = useRef<number | null>(null);
  const clearLinkedFaceSelectionHandlerRef = useRef<(() => void) | null>(null);
  const hideSelectedObjectHandlerRef = useRef<(() => void) | null>(null);
  const showAllObjectsHandlerRef = useRef<(() => void) | null>(null);
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
  const [separatedObjects, setSeparatedObjects] = useState<SeparatedObjectSummary[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);

  const clearLinkedFaceSelectionOverlay = () => {
    const overlay = linkedFaceSelectionOverlayRef.current;

    if (!overlay) {
      return;
    }

    overlay.parent?.remove(overlay);
    disposeObject(overlay);
    linkedFaceSelectionOverlayRef.current = null;
  };

  const applyLinkedFaceSelectionVisuals = (selection: LinkedFaceSelectionDetails | null) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !selection) {
      return;
    }

    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    applyLinkedFaceSelectionColors(selection);
    clearLinkedFaceSelectionOverlay();

    const overlay = createLinkedFaceSelectionOverlay(selection);

    if (!overlay) {
      return;
    }

    modelRoot.add(overlay);
    linkedFaceSelectionOverlayRef.current = overlay;
    updateHoverEdgeResolution(
      modelRoot,
      mountRef.current?.clientWidth ?? 1,
      mountRef.current?.clientHeight ?? 1,
    );
  };

  const clearLinkedFaceSelection = (clearObjectSelection = true) => {
    const modelRoot = rootRef.current;

    linkedFaceSelectionRef.current = null;
    linkedFaceSelectionCacheRef.current = null;
    clearLinkedFaceSelectionOverlay();
    setLinkedFaceSelectionGraph(null);
    setLinkedFaceSelection((current) => ({
      ...current,
      active: false,
      count: 0,
    }));

    if (clearObjectSelection) {
      selectedObjectIdRef.current = null;
      setSelectedObjectId(null);
    }

    if (modelRoot) {
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
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

  const selectLinkedFace = (mesh: THREE.Mesh, triangleIndex: number) => {
    const cache = buildLinkedFaceSelectionCache(mesh, triangleIndex);

    if (!cache) {
      return;
    }

    const selection = createLinkedFaceSelectionFromCache(
      cache,
      linkedFaceSelectionThresholdRef.current,
    );

    linkedFaceSelectionRef.current = selection;
    linkedFaceSelectionCacheRef.current = cache;
    selectedObjectIdRef.current = selection.objectId;
    setSelectedObjectId(selection.objectId);
    setLinkedFaceSelectionGraph(cache);
    setLinkedFaceSelection({
      active: true,
      count: selection.selectedTriangleIndexes.size,
      threshold: linkedFaceSelectionThresholdRef.current,
    });
    applyLinkedFaceSelectionVisuals(selection);
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

    hiddenObjectIdsRef.current = nextHiddenObjectIds;

    if (selection && nextHiddenObjectIds.has(selection.objectId)) {
      clearLinkedFaceSelection();
    } else if (selection) {
      applyLinkedFaceSelectionVisuals(selection);
    } else if (modelRoot) {
      applyObjectColors(modelRoot, nextHiddenObjectIds);
    }

    if (currentSelectedObjectId != null && nextHiddenObjectIds.has(currentSelectedObjectId)) {
      selectedObjectIdRef.current = null;
      setSelectedObjectId(null);
    }

    if (modelRoot) {
      refreshObjectMaterialGroups(modelRoot, nextHiddenObjectIds);
      refreshObjectWireframes(modelRoot, nextHiddenObjectIds);
      setSeparatedObjects(
        collectSeparatedObjects(modelRoot, nextHiddenObjectIds, objectNamesRef.current),
      );
    } else {
      setSeparatedObjects([]);
    }
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
    clearLinkedFaceSelection(false);
    selectedObjectIdRef.current = objectId;
    setSelectedObjectId(objectId);
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
  };

  const handleSeparateSelection = () => {
    const selection = linkedFaceSelectionRef.current;
    const modelRoot = rootRef.current;

    if (!selection || !modelRoot || selection.selectedTriangleIndexes.size === 0) {
      return;
    }

    const objectIds = getTriangleObjectIds(selection.mesh);

    if (!objectIds) {
      return;
    }

    const nextObjectId = nextSeparatedObjectIdRef.current;

    nextSeparatedObjectIdRef.current += 1;
    selection.selectedTriangleIndexes.forEach((triangleIndex) => {
      objectIds[triangleIndex] = nextObjectId;
    });
    separateLooseObjectParts(
      selection.topology,
      objectIds,
      [selection.objectId, nextObjectId],
      () => {
        const loosePartObjectId = nextSeparatedObjectIdRef.current;

        nextSeparatedObjectIdRef.current += 1;

        return loosePartObjectId;
      },
    );

    linkedFaceSelectionRef.current = null;
    linkedFaceSelectionCacheRef.current = null;
    clearLinkedFaceSelectionOverlay();
    setLinkedFaceSelectionGraph(null);
    setLinkedFaceSelection((current) => ({
      ...current,
      active: false,
      count: 0,
    }));
    refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current);
    refreshSeparatedObjects();
  };

  useEffect(() => {
    clearLinkedFaceSelectionHandlerRef.current = clearLinkedFaceSelection;
    hideSelectedObjectHandlerRef.current = hideSelectedObject;
    selectLinkedFaceHandlerRef.current = selectLinkedFace;
    showAllObjectsHandlerRef.current = showAllObjects;
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
      renderer = new THREE.WebGLRenderer({ antialias: true });
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

    loaderRef.current = new GLTFLoader();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;

    const clearHoveredEdge = () => {
      clearHoverEdgeOverlay(hoveredEdgeRef.current);
      hoveredEdgeRef.current = null;
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

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      pointerStart = {
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

      hoveredEdgeRef.current = edge;
      setHoverEdgeOverlay(edge);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !pointerStart) {
        return;
      }

      const moveDistance = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      pointerStart = null;

      if (moveDistance > clickMoveTolerance) {
        return;
      }

      if (!event.shiftKey) {
        clearHoveredEdge();
        const triangle = getTriangleAtPointer(event);

        if (triangle) {
          selectLinkedFaceHandlerRef.current?.(triangle.mesh, triangle.triangleIndex);
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
      clearLinkedFaceSelectionHandlerRef.current?.();
      refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!event.shiftKey) {
        clearHoveredEdge();
        return;
      }

      const edge = getEdgeAtPointer(event);

      if (
        hoveredEdgeRef.current &&
        edge &&
        hoveredEdgeRef.current.mesh === edge.mesh &&
        hoveredEdgeRef.current.key === edge.key
      ) {
        return;
      }

      clearHoveredEdge();

      if (!edge) {
        return;
      }

      hoveredEdgeRef.current = edge;
      setHoverEdgeOverlay(edge);
    };

    const handlePointerLeave = () => {
      clearHoveredEdge();
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

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    const loader = loaderRef.current;
    const modelRoot = rootRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!loader || !modelRoot || !camera || !controls) {
      setLoadState("error");
      setStatusText("Viewer is still starting");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".glb")) {
      setLoadState("error");
      setStatusText("Choose a .glb file");
      return;
    }

    const url = URL.createObjectURL(file);
    nextSeparatedObjectIdRef.current = 1;
    hiddenObjectIdsRef.current = new Set();
    objectNamesRef.current = {};
    selectedObjectIdRef.current = null;
    clearLinkedFaceSelection();
    setSeparatedObjects([]);
    setSelectedObjectId(null);
    setLoadState("loading");
    setStatusText(`Loading ${file.name}`);

    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        clearModel(modelRoot);

        const model = gltf.scene;
        styleModel(model);
        normalizeModel(model);
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
        setSeparatedObjects(
          collectSeparatedObjects(modelRoot, hiddenObjectIdsRef.current, objectNamesRef.current),
        );
        frameModel(camera, controls, model);

        setLoadState("ready");
        setStatusText(file.name);
      },
      undefined,
      () => {
        URL.revokeObjectURL(url);
        setLoadState("error");
        setStatusText("Could not load this GLB");
      },
    );
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-neutral-200 text-neutral-950">
      <div ref={mountRef} className="absolute inset-0" aria-label="3D viewport" />

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
      <LinkedFaceSelectionPanel
        graph={linkedFaceSelectionGraph}
        graphHeight={linkedFaceSelectionGraphHeight}
        graphWidth={linkedFaceSelectionGraphWidth}
        maxAngle={maxLinkedFaceSelectionAngle}
        selection={linkedFaceSelection}
        onClear={clearLinkedFaceSelection}
        onCommitThreshold={commitLinkedFaceSelectionThreshold}
        onSeparate={handleSeparateSelection}
      />
    </main>
  );
}
