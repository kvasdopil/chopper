"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const targetModelSize = 4;
const defaultSmallTriangleArea = 0.01;
const defaultTriangleAreaRange = {
  min: 0,
  max: 0.08,
};
const faceColor = new THREE.Color(0x9a9a9a);
const defaultViewDirection = new THREE.Vector3(1.8, 1.15, 2.3).normalize();
const minOrbitDistance = 0.02;
const maxOrbitDistance = 80;
const cameraNearPlane = 0.001;
const clickMoveTolerance = 4;
const flatNormalAngleThreshold = 1;
const flatNormalAngleColor = "#1d4ed8";
const maxColoredNormalAngle = 45;
const minSignedNormalAngle = -maxColoredNormalAngle;
const maxTriangleNormalAngleSum = maxColoredNormalAngle * 3;
const hiddenNormalAngleColor = "#4b5563";
const hoverEdgeColor = 0xfacc15;
const hoverEdgeLineWidth = 2;
const guideSphereColor = 0xffffff;
const optimizeChunkSize = 300;
const signedNormalAnglePalette = [
  { angle: minSignedNormalAngle, color: "#dc2626" },
  { angle: -24, color: "#ef4444" },
  { angle: -flatNormalAngleThreshold, color: "#fca5a5" },
  { angle: flatNormalAngleThreshold, color: "#38bdf8" },
  { angle: 24, color: "#22c55e" },
  { angle: maxColoredNormalAngle, color: "#16a34a" },
] as const;
const unsignedNormalAnglePalette = [
  { angle: flatNormalAngleThreshold, color: "#38bdf8" },
  { angle: 12, color: "#22c55e" },
  { angle: 24, color: "#facc15" },
  { angle: 36, color: "#f97316" },
  { angle: maxColoredNormalAngle, color: "#ef4444" },
] as const;
const signedNormalAngleRangeSize = maxColoredNormalAngle - minSignedNormalAngle;
const negativeFlatNormalAnglePercent =
  ((-flatNormalAngleThreshold - minSignedNormalAngle) / signedNormalAngleRangeSize) * 100;
const positiveFlatNormalAnglePercent =
  ((flatNormalAngleThreshold - minSignedNormalAngle) / signedNormalAngleRangeSize) * 100;
const fullNormalAngleGradient = `linear-gradient(to right, ${signedNormalAnglePalette
  .filter((stop) => stop.angle < 0)
  .map(
    (stop) =>
      `${stop.color} ${((stop.angle - minSignedNormalAngle) / signedNormalAngleRangeSize) * 100}%`,
  )
  .join(
    ", ",
  )}, ${flatNormalAngleColor} ${negativeFlatNormalAnglePercent}%, ${flatNormalAngleColor} ${positiveFlatNormalAnglePercent}%, ${signedNormalAnglePalette
  .filter((stop) => stop.angle > 0)
  .map(
    (stop) =>
      `${stop.color} ${((stop.angle - minSignedNormalAngle) / signedNormalAngleRangeSize) * 100}%`,
  )
  .join(", ")})`;
const fullTriangleNormalAngleSumGradient = `linear-gradient(to right, ${flatNormalAngleColor} 0%, ${flatNormalAngleColor} ${(flatNormalAngleThreshold / maxTriangleNormalAngleSum) * 100}%, ${unsignedNormalAnglePalette
  .map((stop) => `${stop.color} ${((stop.angle * 3) / maxTriangleNormalAngleSum) * 100}%`)
  .join(", ")})`;
const defaultNormalAngleRange = {
  max: maxColoredNormalAngle,
  min: minSignedNormalAngle,
};
const defaultTriangleNormalAngleSumRange = {
  max: maxTriangleNormalAngleSum,
  min: 0,
};

type LoadState = "empty" | "loading" | "ready" | "error";
type TriangleAreaRange = {
  min: number;
  max: number;
};
type NormalAngleRange = {
  max: number;
  min: number;
};
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
  angleSums: number[];
  edgeToTriangles: Map<string, number[]>;
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute;
  triangles: TriangleTopology[];
};
type OptimizeCandidate = {
  edgeKey: string;
  meshTopology: MeshTopology;
  total: number;
  triangleIndexes: [number, number];
};
type FaceGuideCluster = {
  centerSum: THREE.Vector3;
  count: number;
};
type HighlightMode =
  | {
      areaThreshold: number;
      type: "area";
    }
  | {
      type: "none";
    };
type DisposableDrawObject = THREE.Object3D & {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
};

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

function getUnsignedNormalAnglePaletteColor(angleDegrees: number) {
  if (angleDegrees < flatNormalAngleThreshold) {
    return new THREE.Color(flatNormalAngleColor);
  }

  for (let index = 1; index < unsignedNormalAnglePalette.length; index += 1) {
    const previous = unsignedNormalAnglePalette[index - 1];
    const next = unsignedNormalAnglePalette[index];

    if (angleDegrees <= next.angle) {
      const localValue = (angleDegrees - previous.angle) / (next.angle - previous.angle);

      return new THREE.Color(previous.color).lerp(new THREE.Color(next.color), localValue);
    }
  }

  return new THREE.Color(unsignedNormalAnglePalette[unsignedNormalAnglePalette.length - 1].color);
}

function getSignedNormalAnglePaletteColor(angleDegrees: number) {
  if (Math.abs(angleDegrees) < flatNormalAngleThreshold) {
    return new THREE.Color(flatNormalAngleColor);
  }

  for (let index = 1; index < signedNormalAnglePalette.length; index += 1) {
    const previous = signedNormalAnglePalette[index - 1];
    const next = signedNormalAnglePalette[index];

    if (angleDegrees <= next.angle) {
      const localValue = (angleDegrees - previous.angle) / (next.angle - previous.angle);

      return new THREE.Color(previous.color).lerp(new THREE.Color(next.color), localValue);
    }
  }

  return new THREE.Color(signedNormalAnglePalette[signedNormalAnglePalette.length - 1].color);
}

function isNormalAngleVisible(angleDegrees: number, range: NormalAngleRange) {
  return (
    angleDegrees >= range.min &&
    angleDegrees <= range.max &&
    angleDegrees >= minSignedNormalAngle &&
    angleDegrees <= maxColoredNormalAngle
  );
}

function getNormalAngleRangeGradient(range: NormalAngleRange) {
  const minPercent = ((range.min - minSignedNormalAngle) / signedNormalAngleRangeSize) * 100;
  const maxPercent = ((range.max - minSignedNormalAngle) / signedNormalAngleRangeSize) * 100;

  return `linear-gradient(to right, ${hiddenNormalAngleColor} 0%, ${hiddenNormalAngleColor} ${minPercent}%, transparent ${minPercent}%, transparent ${maxPercent}%, ${hiddenNormalAngleColor} ${maxPercent}%, ${hiddenNormalAngleColor} 100%), ${fullNormalAngleGradient}`;
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

function getTriangleNormalAngleSumColor(angleSum: number) {
  return getUnsignedNormalAnglePaletteColor(angleSum / 3);
}

function getVisibleTriangleNormalAngleSumColor(angleSum: number, range: NormalAngleRange) {
  if (angleSum < range.min || angleSum > range.max || angleSum > maxTriangleNormalAngleSum) {
    return new THREE.Color(hiddenNormalAngleColor);
  }

  return getTriangleNormalAngleSumColor(angleSum);
}

function isTriangleNormalAngleSumVisible(angleSum: number, range: NormalAngleRange) {
  return angleSum >= range.min && angleSum <= range.max && angleSum <= maxTriangleNormalAngleSum;
}

function getTriangleNormalAngleSumRangeGradient(range: NormalAngleRange) {
  const minPercent = (range.min / maxTriangleNormalAngleSum) * 100;
  const maxPercent = (range.max / maxTriangleNormalAngleSum) * 100;

  return `linear-gradient(to right, ${hiddenNormalAngleColor} 0%, ${hiddenNormalAngleColor} ${minPercent}%, transparent ${minPercent}%, transparent ${maxPercent}%, ${hiddenNormalAngleColor} ${maxPercent}%, ${hiddenNormalAngleColor} 100%), ${fullTriangleNormalAngleSumGradient}`;
}

function setTriangleNormalAngleSums(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return;
  }

  const { edgeFaces, triangleEdgeKeys } = getTriangleEdges(position);
  const angleSums = new Float32Array(position.count);

  triangleEdgeKeys.forEach((edgeKeys, triangleIndex) => {
    const angleSum = edgeKeys.reduce((sum, key) => {
      const faces = edgeFaces.get(key);

      return sum + (faces ? getEdgeNormalAngle(faces) : 0);
    }, 0);
    const startIndex = triangleIndex * 3;

    angleSums[startIndex] = angleSum;
    angleSums[startIndex + 1] = angleSum;
    angleSums[startIndex + 2] = angleSum;
  });

  geometry.setAttribute("normalAngleSum", new THREE.BufferAttribute(angleSums, 1));
}

function createAngleLineGeometry(sourceGeometry: THREE.BufferGeometry) {
  const position = sourceGeometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return new THREE.BufferGeometry();
  }

  const { edgeFaces } = getTriangleEdges(position);
  const positions: number[] = [];
  const colors: number[] = [];
  const angles: number[] = [];

  edgeFaces.forEach((faces, key) => {
    const [vertexA, vertexB] = key
      .split("|")
      .map((vertexKey) => vertexKey.split(",").map((value) => Number(value) / 100000));
    const angleDegrees = getSignedEdgeNormalAngle(faces);
    const color = getSignedNormalAnglePaletteColor(angleDegrees);

    positions.push(vertexA[0], vertexA[1], vertexA[2], vertexB[0], vertexB[1], vertexB[2]);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    angles.push(angleDegrees, angleDegrees);
  });

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("normalAngle", new THREE.Float32BufferAttribute(angles, 1));
  geometry.userData.sourcePositions = positions;
  geometry.userData.sourceAngles = angles;

  return geometry;
}

function applyNormalAngleLineColors(model: THREE.Object3D, range: NormalAngleRange) {
  model.traverse((child) => {
    if (child.userData.isAngleLineOverlay !== true || !isDisposableDrawObject(child)) {
      return;
    }

    const position = child.geometry.getAttribute("position");
    const angle = child.geometry.getAttribute("normalAngle");

    if (!(position instanceof THREE.BufferAttribute) || !(angle instanceof THREE.BufferAttribute)) {
      return;
    }

    const sourcePositions =
      child.geometry.userData.sourcePositions ?? Array.from(position.array as Iterable<number>);
    const sourceAngles =
      child.geometry.userData.sourceAngles ?? Array.from(angle.array as Iterable<number>);
    const positions: number[] = [];
    const colors: number[] = [];
    const angles: number[] = [];

    for (let index = 0; index < sourceAngles.length; index += 2) {
      const angleDegrees = sourceAngles[index];

      if (!isNormalAngleVisible(angleDegrees, range)) {
        continue;
      }

      const angleColor = getSignedNormalAnglePaletteColor(angleDegrees);
      const positionOffset = index * 3;

      positions.push(
        sourcePositions[positionOffset],
        sourcePositions[positionOffset + 1],
        sourcePositions[positionOffset + 2],
        sourcePositions[positionOffset + 3],
        sourcePositions[positionOffset + 4],
        sourcePositions[positionOffset + 5],
      );
      colors.push(
        angleColor.r,
        angleColor.g,
        angleColor.b,
        angleColor.r,
        angleColor.g,
        angleColor.b,
      );
      angles.push(angleDegrees, angleDegrees);
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("normalAngle", new THREE.Float32BufferAttribute(angles, 1));
    geometry.userData.sourcePositions = sourcePositions;
    geometry.userData.sourceAngles = sourceAngles;

    child.geometry.dispose();
    child.geometry = geometry;
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
    setTriangleNormalAngleSums(geometry);
    mesh.geometry = geometry;

    disposeMaterial(mesh.material);

    mesh.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      roughness: 0.82,
      side: THREE.FrontSide,
      vertexColors: true,
    });

    const wireframe = mesh.clone(false);
    wireframe.geometry = mesh.geometry;
    wireframe.material = new THREE.MeshBasicMaterial({
      color: 0x050505,
      wireframe: true,
    });
    wireframe.name = "wireframe-overlay";
    wireframe.renderOrder = 1;
    wireframe.userData.isWireframeOverlay = true;
    wireframe.visible = false;
    mesh.userData.wireframeOverlay = wireframe;

    const angleLines = new THREE.LineSegments(
      createAngleLineGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({
        depthWrite: false,
        vertexColors: true,
      }),
    );
    angleLines.name = "normal-angle-line-overlay";
    angleLines.position.copy(mesh.position);
    angleLines.quaternion.copy(mesh.quaternion);
    angleLines.scale.copy(mesh.scale);
    angleLines.matrix.copy(mesh.matrix);
    angleLines.matrixAutoUpdate = mesh.matrixAutoUpdate;
    angleLines.renderOrder = 1;
    angleLines.userData.isAngleLineOverlay = true;
    angleLines.visible = false;
    mesh.userData.angleLineOverlay = angleLines;

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
      overlay: angleLines,
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

function isTriangleDegenerate(vertices: TriangleVertex[]) {
  return (
    new Set(vertices.map((vertex) => vertex.key)).size < 3 ||
    getTriangleNormal(vertices).lengthSq() === 0
  );
}

function getTriangleMidpoint(vertices: TriangleVertex[]) {
  return vertices
    .reduce((midpoint, vertex) => midpoint.add(vertex.point), new THREE.Vector3())
    .multiplyScalar(1 / vertices.length);
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

function refreshAngleLineOverlay(mesh: THREE.Mesh, normalAngleRange: NormalAngleRange) {
  const angleLines = mesh.userData.angleLineOverlay as THREE.LineSegments | undefined;

  if (!angleLines) {
    return;
  }

  angleLines.geometry.dispose();
  angleLines.geometry = createAngleLineGeometry(mesh.geometry);
  applyNormalAngleLineColors(angleLines, normalAngleRange);
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
    if (child.userData.isHoverEdgeOverlay !== true || !isDisposableDrawObject(child)) {
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

function swapHoveredEdgeDiagonal(edge: HoveredEdge, normalAngleRange: NormalAngleRange) {
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
  setTriangleNormalAngleSums(mesh.geometry);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  refreshAngleLineOverlay(mesh, normalAngleRange);

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
    angleSums: [],
    edgeToTriangles,
    mesh,
    position,
    triangles,
  };

  topology.angleSums = triangles.map((_, triangleIndex) =>
    getTopologyTriangleAngleSum(topology, triangleIndex),
  );

  return topology;
}

function getTopologyTriangleAngleSum(topology: MeshTopology, triangleIndex: number) {
  const triangle = topology.triangles[triangleIndex];

  if (!triangle) {
    return 0;
  }

  return triangle.edgeKeys.reduce((sum, edgeKey) => {
    const faces =
      topology.edgeToTriangles
        .get(edgeKey)
        ?.map((edgeTriangleIndex) =>
          getTriangleEdgeFace(topology.triangles[edgeTriangleIndex].vertices, edgeKey),
        )
        .filter((face): face is TriangleEdgeFace => face !== null) ?? [];

    return sum + getEdgeNormalAngle(faces);
  }, 0);
}

function getTopologyTriangleSignedEdgeAngles(topology: MeshTopology, triangleIndex: number) {
  const triangle = topology.triangles[triangleIndex];

  if (!triangle || isTriangleDegenerate(triangle.vertices)) {
    return null;
  }

  return triangle.edgeKeys.map((edgeKey) => {
    const faces =
      topology.edgeToTriangles
        .get(edgeKey)
        ?.map((edgeTriangleIndex) =>
          getTriangleEdgeFace(topology.triangles[edgeTriangleIndex].vertices, edgeKey),
        )
        .filter((face): face is TriangleEdgeFace => face !== null) ?? [];

    return getSignedEdgeNormalAngle(faces);
  });
}

function isTopologyTriangleWithinNormalAngleRange(
  topology: MeshTopology,
  triangleIndex: number,
  normalAngleRange: NormalAngleRange,
) {
  const edgeAngles = getTopologyTriangleSignedEdgeAngles(topology, triangleIndex);

  return (
    edgeAngles !== null &&
    edgeAngles.every((angle) => isNormalAngleVisible(angle, normalAngleRange))
  );
}

function isTopologyTriangleWithinAngleSumRange(
  topology: MeshTopology,
  triangleIndex: number,
  triangleNormalAngleSumRange: NormalAngleRange,
) {
  const triangle = topology.triangles[triangleIndex];

  return (
    triangle !== undefined &&
    !isTriangleDegenerate(triangle.vertices) &&
    isTriangleNormalAngleSumVisible(topology.angleSums[triangleIndex], triangleNormalAngleSumRange)
  );
}

function getProposedTriangleAngleSum(
  topology: MeshTopology,
  triangleIndex: number,
  vertices: TriangleVertex[],
  otherTriangleIndex: number,
  otherVertices: TriangleVertex[],
) {
  const edgeKeys = getTriangleEdgeKeys(vertices);
  const otherEdgeKeys = new Set(getTriangleEdgeKeys(otherVertices));

  return edgeKeys.reduce((sum, edgeKey) => {
    const faces: TriangleEdgeFace[] = [];
    const ownFace = getTriangleEdgeFace(vertices, edgeKey);

    if (ownFace) {
      faces.push(ownFace);
    }

    if (otherEdgeKeys.has(edgeKey)) {
      const otherFace = getTriangleEdgeFace(otherVertices, edgeKey);

      if (otherFace) {
        faces.push(otherFace);
      }
    } else {
      topology.edgeToTriangles.get(edgeKey)?.forEach((edgeTriangleIndex) => {
        if (edgeTriangleIndex === triangleIndex || edgeTriangleIndex === otherTriangleIndex) {
          return;
        }

        const face = getTriangleEdgeFace(topology.triangles[edgeTriangleIndex].vertices, edgeKey);

        if (face) {
          faces.push(face);
        }
      });
    }

    return sum + getEdgeNormalAngle(faces);
  }, 0);
}

function getSwapProposal(
  topology: MeshTopology,
  firstTriangleIndex: number,
  secondTriangleIndex: number,
) {
  const firstTriangle = topology.triangles[firstTriangleIndex]?.vertices;
  const secondTriangle = topology.triangles[secondTriangleIndex]?.vertices;

  if (!firstTriangle || !secondTriangle) {
    return null;
  }

  const secondKeys = new Set(secondTriangle.map((vertex) => vertex.key));
  const sharedKeys = firstTriangle.map((vertex) => vertex.key).filter((key) => secondKeys.has(key));

  if (sharedKeys.length !== 2) {
    return null;
  }

  const sharedKeySet = new Set(sharedKeys);
  const firstOpposite = firstTriangle.find((vertex) => !sharedKeySet.has(vertex.key));
  const secondOpposite = secondTriangle.find((vertex) => !sharedKeySet.has(vertex.key));
  const sharedVertices = firstTriangle.filter((vertex) => sharedKeySet.has(vertex.key));

  if (!firstOpposite || !secondOpposite || sharedVertices.length !== 2) {
    return null;
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
    return null;
  }

  return { nextFirstTriangle, nextSecondTriangle };
}

function replaceTopologyTriangles(
  topology: MeshTopology,
  firstTriangleIndex: number,
  firstVertices: TriangleVertex[],
  secondTriangleIndex: number,
  secondVertices: TriangleVertex[],
) {
  const affectedTriangles = new Set([firstTriangleIndex, secondTriangleIndex]);
  const oldEdgeKeys = [
    ...topology.triangles[firstTriangleIndex].edgeKeys,
    ...topology.triangles[secondTriangleIndex].edgeKeys,
  ];

  oldEdgeKeys.forEach((edgeKey) => {
    topology.edgeToTriangles
      .get(edgeKey)
      ?.forEach((triangleIndex) => affectedTriangles.add(triangleIndex));
  });

  [firstTriangleIndex, secondTriangleIndex].forEach((triangleIndex) => {
    topology.triangles[triangleIndex].edgeKeys.forEach((edgeKey) => {
      const nextTriangles = topology.edgeToTriangles
        .get(edgeKey)
        ?.filter((edgeTriangleIndex) => edgeTriangleIndex !== triangleIndex);

      if (!nextTriangles || nextTriangles.length === 0) {
        topology.edgeToTriangles.delete(edgeKey);
      } else {
        topology.edgeToTriangles.set(edgeKey, nextTriangles);
      }
    });
  });

  topology.triangles[firstTriangleIndex] = {
    edgeKeys: getTriangleEdgeKeys(firstVertices),
    vertices: firstVertices,
  };
  topology.triangles[secondTriangleIndex] = {
    edgeKeys: getTriangleEdgeKeys(secondVertices),
    vertices: secondVertices,
  };

  [firstTriangleIndex, secondTriangleIndex].forEach((triangleIndex) => {
    topology.triangles[triangleIndex].edgeKeys.forEach((edgeKey) => {
      const edgeTriangles = topology.edgeToTriangles.get(edgeKey);

      if (edgeTriangles) {
        edgeTriangles.push(triangleIndex);
      } else {
        topology.edgeToTriangles.set(edgeKey, [triangleIndex]);
      }
    });
  });

  [
    ...topology.triangles[firstTriangleIndex].edgeKeys,
    ...topology.triangles[secondTriangleIndex].edgeKeys,
  ].forEach((edgeKey) => {
    topology.edgeToTriangles
      .get(edgeKey)
      ?.forEach((triangleIndex) => affectedTriangles.add(triangleIndex));
  });

  affectedTriangles.forEach((triangleIndex) => {
    topology.angleSums[triangleIndex] = getTopologyTriangleAngleSum(topology, triangleIndex);
  });
}

function buildOptimizeCandidates(topology: MeshTopology, angleSumThreshold: number) {
  const candidates: OptimizeCandidate[] = [];

  topology.edgeToTriangles.forEach((triangleIndexes, edgeKey) => {
    if (triangleIndexes.length !== 2) {
      return;
    }

    const total = topology.angleSums[triangleIndexes[0]] + topology.angleSums[triangleIndexes[1]];

    if (total <= angleSumThreshold) {
      return;
    }

    candidates.push({
      edgeKey,
      meshTopology: topology,
      total,
      triangleIndexes: [triangleIndexes[0], triangleIndexes[1]],
    });
  });

  return candidates;
}

function applyTopologySwap(
  topology: MeshTopology,
  firstTriangleIndex: number,
  secondTriangleIndex: number,
  firstVertices: TriangleVertex[],
  secondVertices: TriangleVertex[],
) {
  setTrianglePositions(topology.position, firstTriangleIndex * 3, firstVertices);
  setTrianglePositions(topology.position, secondTriangleIndex * 3, secondVertices);
  topology.position.needsUpdate = true;
  replaceTopologyTriangles(
    topology,
    firstTriangleIndex,
    firstVertices,
    secondTriangleIndex,
    secondVertices,
  );
}

function finalizeOptimizedMesh(topology: MeshTopology, normalAngleRange: NormalAngleRange) {
  topology.mesh.geometry.computeVertexNormals();
  setTriangleNormalAngleSums(topology.mesh.geometry);
  topology.mesh.geometry.computeBoundingBox();
  topology.mesh.geometry.computeBoundingSphere();
  refreshAngleLineOverlay(topology.mesh, normalAngleRange);
}

function waitForFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function replaceVerticesByKey(
  position: THREE.BufferAttribute,
  replacements: Map<string, THREE.Vector3>,
) {
  let changed = false;

  for (let index = 0; index < position.count; index += 1) {
    const replacement = replacements.get(getVertexKey(position, index));

    if (!replacement) {
      continue;
    }

    position.setXYZ(index, replacement.x, replacement.y, replacement.z);
    changed = true;
  }

  if (changed) {
    position.needsUpdate = true;
  }
}

async function collapseLineAngleTriangles(
  model: THREE.Object3D,
  normalAngleRange: NormalAngleRange,
  onProgress: (status: string) => void,
) {
  const meshes: THREE.Mesh[] = [];
  let collapsed = 0;
  let checkedTriangles = 0;
  let pass = 0;

  onProgress(
    `Scanning triangles from ${formatAngle(normalAngleRange.min)} to ${formatAngle(
      normalAngleRange.max,
    )} deg...`,
  );

  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      meshes.push(child);
    }
  });

  while (true) {
    pass += 1;

    let passCollapsed = 0;
    let passChecked = 0;

    for (const mesh of meshes) {
      const topology = buildMeshTopology(mesh);

      if (!topology) {
        continue;
      }

      const consumedKeys = new Set<string>();
      const replacements = new Map<string, THREE.Vector3>();

      for (let triangleIndex = 0; triangleIndex < topology.triangles.length; triangleIndex += 1) {
        passChecked += 1;

        if (isTopologyTriangleWithinNormalAngleRange(topology, triangleIndex, normalAngleRange)) {
          const triangle = topology.triangles[triangleIndex];
          const vertexKeys = [...new Set(triangle.vertices.map((vertex) => vertex.key))];

          if (!vertexKeys.some((key) => consumedKeys.has(key))) {
            const midpoint = getTriangleMidpoint(triangle.vertices);

            vertexKeys.forEach((key) => {
              consumedKeys.add(key);
              replacements.set(key, midpoint);
            });
            passCollapsed += 1;
          }
        }

        if (passChecked % optimizeChunkSize === 0) {
          onProgress(`Pass ${pass}: ${passChecked} checked, ${passCollapsed} collapsed`);
          await waitForFrame();
        }
      }

      replaceVerticesByKey(topology.position, replacements);
    }

    checkedTriangles += passChecked;
    collapsed += passCollapsed;

    if (passCollapsed === 0) {
      onProgress(
        collapsed === 0
          ? `No triangles fully within ${formatAngle(normalAngleRange.min)} to ${formatAngle(
              normalAngleRange.max,
            )} deg`
          : `Line optimization complete: ${collapsed} collapsed over ${pass - 1} passes, ${checkedTriangles} checks`,
      );
      break;
    }

    onProgress(`Pass ${pass} complete: ${passCollapsed} collapsed, rebuilding...`);
    await waitForFrame();
  }

  meshes.forEach((mesh) => {
    mesh.geometry.computeVertexNormals();
    setTriangleNormalAngleSums(mesh.geometry);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    refreshAngleLineOverlay(mesh, normalAngleRange);
  });

  return { checked: checkedTriangles, collapsed };
}

async function collapseFaceAngleSumTriangles(
  model: THREE.Object3D,
  normalAngleRange: NormalAngleRange,
  triangleNormalAngleSumRange: NormalAngleRange,
  onProgress: (status: string) => void,
) {
  const meshes: THREE.Mesh[] = [];
  let collapsed = 0;
  let checkedTriangles = 0;
  let pass = 0;

  onProgress(
    `Scanning faces from ${formatAngle(triangleNormalAngleSumRange.min)} to ${formatAngle(
      triangleNormalAngleSumRange.max,
    )} deg...`,
  );

  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      meshes.push(child);
    }
  });

  while (true) {
    pass += 1;

    let passCollapsed = 0;
    let passChecked = 0;

    for (const mesh of meshes) {
      const topology = buildMeshTopology(mesh);

      if (!topology) {
        continue;
      }

      const consumedKeys = new Set<string>();
      const replacements = new Map<string, THREE.Vector3>();

      for (let triangleIndex = 0; triangleIndex < topology.triangles.length; triangleIndex += 1) {
        passChecked += 1;

        if (
          isTopologyTriangleWithinAngleSumRange(
            topology,
            triangleIndex,
            triangleNormalAngleSumRange,
          )
        ) {
          const triangle = topology.triangles[triangleIndex];
          const vertexKeys = [...new Set(triangle.vertices.map((vertex) => vertex.key))];

          if (!vertexKeys.some((key) => consumedKeys.has(key))) {
            const midpoint = getTriangleMidpoint(triangle.vertices);

            vertexKeys.forEach((key) => {
              consumedKeys.add(key);
              replacements.set(key, midpoint);
            });
            passCollapsed += 1;
          }
        }

        if (passChecked % optimizeChunkSize === 0) {
          onProgress(`Pass ${pass}: ${passChecked} checked, ${passCollapsed} collapsed`);
          await waitForFrame();
        }
      }

      replaceVerticesByKey(topology.position, replacements);
    }

    checkedTriangles += passChecked;
    collapsed += passCollapsed;

    if (passCollapsed === 0) {
      onProgress(
        collapsed === 0
          ? `No faces within ${formatAngle(triangleNormalAngleSumRange.min)} to ${formatAngle(
              triangleNormalAngleSumRange.max,
            )} deg`
          : `Face collapse complete: ${collapsed} collapsed over ${pass - 1} passes, ${checkedTriangles} checks`,
      );
      break;
    }

    onProgress(`Pass ${pass} complete: ${passCollapsed} collapsed, rebuilding...`);
    await waitForFrame();
  }

  meshes.forEach((mesh) => {
    mesh.geometry.computeVertexNormals();
    setTriangleNormalAngleSums(mesh.geometry);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    refreshAngleLineOverlay(mesh, normalAngleRange);
  });

  return { checked: checkedTriangles, collapsed };
}

async function optimizeModel(
  model: THREE.Object3D,
  normalAngleRange: NormalAngleRange,
  angleSumThreshold: number,
  onProgress: (status: string) => void,
) {
  const topologies: MeshTopology[] = [];
  let swapped = 0;
  let checkedCandidates = 0;
  let pass = 0;

  onProgress(`Scanning triangles above ${formatAngle(angleSumThreshold)} deg...`);

  model.traverse((child) => {
    if (!isSelectableMesh(child)) {
      return;
    }

    const topology = buildMeshTopology(child);

    if (!topology) {
      return;
    }

    topologies.push(topology);
  });

  while (true) {
    pass += 1;

    const candidates = topologies
      .flatMap((topology) => buildOptimizeCandidates(topology, angleSumThreshold))
      .sort((first, second) => second.total - first.total);

    if (candidates.length === 0) {
      onProgress(
        swapped === 0
          ? `No edges above ${formatAngle(angleSumThreshold)} deg total`
          : `Optimization complete: ${swapped} swaps over ${pass - 1} passes`,
      );
      break;
    }

    let passSwaps = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const [firstTriangleIndex, secondTriangleIndex] = candidate.triangleIndexes;
      const currentTriangles = candidate.meshTopology.edgeToTriangles.get(candidate.edgeKey);

      if (
        currentTriangles?.length === 2 &&
        currentTriangles.includes(firstTriangleIndex) &&
        currentTriangles.includes(secondTriangleIndex)
      ) {
        const currentTotal =
          candidate.meshTopology.angleSums[firstTriangleIndex] +
          candidate.meshTopology.angleSums[secondTriangleIndex];
        const proposal = getSwapProposal(
          candidate.meshTopology,
          firstTriangleIndex,
          secondTriangleIndex,
        );

        if (proposal && currentTotal > angleSumThreshold) {
          const nextTotal =
            getProposedTriangleAngleSum(
              candidate.meshTopology,
              firstTriangleIndex,
              proposal.nextFirstTriangle,
              secondTriangleIndex,
              proposal.nextSecondTriangle,
            ) +
            getProposedTriangleAngleSum(
              candidate.meshTopology,
              secondTriangleIndex,
              proposal.nextSecondTriangle,
              firstTriangleIndex,
              proposal.nextFirstTriangle,
            );

          if (nextTotal < currentTotal) {
            applyTopologySwap(
              candidate.meshTopology,
              firstTriangleIndex,
              secondTriangleIndex,
              proposal.nextFirstTriangle,
              proposal.nextSecondTriangle,
            );
            swapped += 1;
            passSwaps += 1;
          }
        }
      }

      if (index % optimizeChunkSize === 0) {
        onProgress(
          `Pass ${pass}: ${index + 1}/${candidates.length}, pass swaps ${passSwaps}, total ${swapped}`,
        );
        await waitForFrame();
      }
    }

    checkedCandidates += candidates.length;

    if (passSwaps === 0) {
      onProgress(
        `Optimization complete: ${swapped} swaps over ${pass} passes, ${checkedCandidates} checks`,
      );
      break;
    }

    onProgress(`Pass ${pass} complete: ${passSwaps} swaps, rebuilding candidates...`);
    await waitForFrame();
  }

  topologies.forEach((topology) => finalizeOptimizedMesh(topology, normalAngleRange));

  return { candidates: checkedCandidates, swapped };
}

function applyTriangleHighlights(
  model: THREE.Object3D,
  highlightMode: HighlightMode,
  triangleNormalAngleSumRange: NormalAngleRange,
) {
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const pointC = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();

  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (
      !isMesh(child) ||
      child.userData.isWireframeOverlay === true ||
      child.userData.isHoverEdgeOverlay === true ||
      child.userData.isGuideOverlay === true
    ) {
      return;
    }

    const position = child.geometry.getAttribute("position");
    const color = child.geometry.getAttribute("color");
    const angleSum = child.geometry.getAttribute("normalAngleSum");
    const wireframe = child.userData.wireframeOverlay as THREE.Mesh | undefined;
    const angleLines = child.userData.angleLineOverlay as THREE.LineSegments | undefined;

    if (wireframe) {
      wireframe.visible = false;
    }

    if (angleLines) {
      angleLines.visible = true;
    }

    if (!(color instanceof THREE.BufferAttribute)) {
      return;
    }

    for (let index = 0; index < position.count; index += 3) {
      let isAreaHighlighted = false;
      const angleFillColor =
        angleSum instanceof THREE.BufferAttribute
          ? getVisibleTriangleNormalAngleSumColor(angleSum.getX(index), triangleNormalAngleSumRange)
          : faceColor;

      if (highlightMode.type === "area") {
        pointA.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
        pointB.fromBufferAttribute(position, index + 1).applyMatrix4(child.matrixWorld);
        pointC.fromBufferAttribute(position, index + 2).applyMatrix4(child.matrixWorld);

        const triangleArea =
          edgeA.subVectors(pointB, pointA).cross(edgeB.subVectors(pointC, pointA)).length() * 0.5;

        isAreaHighlighted = triangleArea < highlightMode.areaThreshold;
      }

      colorTriangle(
        color,
        index,
        highlightMode.type === "none" || isAreaHighlighted ? angleFillColor : faceColor,
      );
    }

    color.needsUpdate = true;
  });
}

function getTriangleAreaRange(model: THREE.Object3D): TriangleAreaRange | null {
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const pointC = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  let min = Number.POSITIVE_INFINITY;
  let max = 0;

  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (
      !isMesh(child) ||
      child.userData.isWireframeOverlay === true ||
      child.userData.isHoverEdgeOverlay === true ||
      child.userData.isGuideOverlay === true
    ) {
      return;
    }

    const position = child.geometry.getAttribute("position");

    for (let index = 0; index < position.count; index += 3) {
      pointA.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
      pointB.fromBufferAttribute(position, index + 1).applyMatrix4(child.matrixWorld);
      pointC.fromBufferAttribute(position, index + 2).applyMatrix4(child.matrixWorld);

      const triangleArea =
        edgeA.subVectors(pointB, pointA).cross(edgeB.subVectors(pointC, pointA)).length() * 0.5;

      if (!Number.isFinite(triangleArea)) {
        continue;
      }

      min = Math.min(min, triangleArea);
      max = Math.max(max, triangleArea);
    }
  });

  if (!Number.isFinite(min)) {
    return null;
  }

  return { min, max };
}

function getMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) * 0.5 : sorted[middle];
}

function createFaceGuideOverlay(model: THREE.Object3D, angleSumRange: NormalAngleRange) {
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const pointC = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const centers: THREE.Vector3[] = [];
  const sizes: number[] = [];

  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (!isSelectableMesh(child)) {
      return;
    }

    const position = child.geometry.getAttribute("position");
    const angleSum = child.geometry.getAttribute("normalAngleSum");

    if (
      !(position instanceof THREE.BufferAttribute) ||
      !(angleSum instanceof THREE.BufferAttribute)
    ) {
      return;
    }

    for (let index = 0; index < position.count; index += 3) {
      if (!isTriangleNormalAngleSumVisible(angleSum.getX(index), angleSumRange)) {
        continue;
      }

      pointA.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
      pointB.fromBufferAttribute(position, index + 1).applyMatrix4(child.matrixWorld);
      pointC.fromBufferAttribute(position, index + 2).applyMatrix4(child.matrixWorld);

      const triangleArea =
        edgeA.subVectors(pointB, pointA).cross(edgeB.subVectors(pointC, pointA)).length() * 0.5;

      if (!Number.isFinite(triangleArea) || triangleArea <= 0) {
        continue;
      }

      sizes.push(Math.sqrt(triangleArea));
      centers.push(
        new THREE.Vector3()
          .addVectors(pointA, pointB)
          .add(pointC)
          .multiplyScalar(1 / 3),
      );
    }
  });

  const medianSize = getMedian(sizes);

  if (centers.length === 0 || medianSize <= 0) {
    return null;
  }

  const clusterSize = medianSize * 3;
  const clusters = new Map<string, FaceGuideCluster>();

  centers.forEach((center) => {
    const key = [
      Math.floor(center.x / clusterSize),
      Math.floor(center.y / clusterSize),
      Math.floor(center.z / clusterSize),
    ].join(",");
    const cluster = clusters.get(key);

    if (cluster) {
      cluster.centerSum.add(center);
      cluster.count += 1;
    } else {
      clusters.set(key, {
        centerSum: center.clone(),
        count: 1,
      });
    }
  });

  const guideRoot = new THREE.Group();
  const sphereGeometry = new THREE.SphereGeometry(Math.max(medianSize * 0.35, 0.01), 12, 8);
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: guideSphereColor,
    depthTest: false,
    depthWrite: false,
  });

  guideRoot.name = "face-guide-overlay";
  guideRoot.userData.isGuideOverlay = true;

  clusters.forEach((cluster) => {
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

    sphere.name = "face-guide-sphere";
    sphere.position.copy(cluster.centerSum.multiplyScalar(1 / cluster.count));
    sphere.renderOrder = 4;
    sphere.userData.isGuideOverlay = true;
    guideRoot.add(sphere);
  });

  return {
    clusterCount: clusters.size,
    faceCount: centers.length,
    guideRoot,
    medianSize,
  };
}

function getSliderStep(range: TriangleAreaRange) {
  return Math.max((range.max - range.min) / 1000, 0.000001);
}

function clampAreaThreshold(value: number, range: TriangleAreaRange) {
  return Math.min(Math.max(value, range.min), range.max);
}

function formatArea(value: number) {
  if (value === 0) {
    return "0";
  }

  if (Math.abs(value) < 0.001) {
    return value.toExponential(2);
  }

  return value.toFixed(3);
}

function formatAngle(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
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
    object.userData.isHoverEdgeOverlay !== true &&
    object.userData.isGuideOverlay !== true
  );
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const guideRootRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const highlightModeRef = useRef<HighlightMode>({
    areaThreshold: defaultSmallTriangleArea,
    type: "area",
  });
  const hoveredEdgeRef = useRef<HoveredEdge | null>(null);
  const normalAngleRangeRef = useRef<NormalAngleRange>(defaultNormalAngleRange);
  const triangleNormalAngleSumRangeRef = useRef<NormalAngleRange>(
    defaultTriangleNormalAngleSumRange,
  );
  const [loadState, setLoadState] = useState<LoadState>("empty");
  const [statusText, setStatusText] = useState("No model loaded");
  const [guidesVisible, setGuidesVisible] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [lineOptimizeStatus, setLineOptimizeStatus] = useState("");
  const [optimizeStatus, setOptimizeStatus] = useState("");
  const [smallTriangleArea, setSmallTriangleArea] = useState(defaultSmallTriangleArea);
  const [triangleAreaRange, setTriangleAreaRange] =
    useState<TriangleAreaRange>(defaultTriangleAreaRange);
  const [normalAngleRange, setNormalAngleRange] =
    useState<NormalAngleRange>(defaultNormalAngleRange);
  const [triangleNormalAngleSumRange, setTriangleNormalAngleSumRange] = useState<NormalAngleRange>(
    defaultTriangleNormalAngleSumRange,
  );

  const clearFaceGuides = () => {
    const guideRoot = guideRootRef.current;

    if (!guideRoot) {
      return;
    }

    guideRoot.parent?.remove(guideRoot);
    disposeObject(guideRoot);
    guideRootRef.current = null;
  };

  const refreshModelAfterGeometryChange = (modelRoot: THREE.Object3D) => {
    const areaRange = getTriangleAreaRange(modelRoot) ?? defaultTriangleAreaRange;
    const nextSmallTriangleArea = clampAreaThreshold(smallTriangleArea, areaRange);

    setTriangleAreaRange(areaRange);
    setSmallTriangleArea(nextSmallTriangleArea);
    highlightModeRef.current = {
      areaThreshold: nextSmallTriangleArea,
      type: "area",
    };
    applyTriangleHighlights(
      modelRoot,
      highlightModeRef.current,
      triangleNormalAngleSumRangeRef.current,
    );
  };

  const handleGuidesToggle = () => {
    const modelRoot = rootRef.current;

    if (guidesVisible) {
      clearFaceGuides();
      setGuidesVisible(false);
      setOptimizeStatus("Guides hidden");
      return;
    }

    if (!modelRoot || isOptimizing) {
      return;
    }

    clearFaceGuides();

    const guideOverlay = createFaceGuideOverlay(modelRoot, triangleNormalAngleSumRange);

    if (!guideOverlay) {
      setGuidesVisible(false);
      setOptimizeStatus("No visible faces for guides");
      return;
    }

    modelRoot.add(guideOverlay.guideRoot);
    guideRootRef.current = guideOverlay.guideRoot;
    setGuidesVisible(true);
    setOptimizeStatus(
      `Guides: ${guideOverlay.clusterCount} clusters from ${guideOverlay.faceCount} faces`,
    );
  };

  const handleLineOptimize = async () => {
    const modelRoot = rootRef.current;

    if (!modelRoot || isOptimizing) {
      return;
    }

    const lineAngleRange = normalAngleRange;

    setIsOptimizing(true);
    clearFaceGuides();
    setGuidesVisible(false);
    clearHoverEdgeOverlay(hoveredEdgeRef.current);
    hoveredEdgeRef.current = null;

    try {
      await collapseLineAngleTriangles(modelRoot, lineAngleRange, setLineOptimizeStatus);
      refreshModelAfterGeometryChange(modelRoot);
    } catch {
      setLineOptimizeStatus("Line optimization failed");
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleFaceCollapse = async () => {
    const modelRoot = rootRef.current;

    if (!modelRoot || isOptimizing) {
      return;
    }

    const angleSumRange = triangleNormalAngleSumRange;

    setIsOptimizing(true);
    clearFaceGuides();
    setGuidesVisible(false);
    clearHoverEdgeOverlay(hoveredEdgeRef.current);
    hoveredEdgeRef.current = null;

    try {
      await collapseFaceAngleSumTriangles(
        modelRoot,
        normalAngleRangeRef.current,
        angleSumRange,
        setOptimizeStatus,
      );
      refreshModelAfterGeometryChange(modelRoot);
    } catch {
      setOptimizeStatus("Face collapse failed");
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleOptimize = async () => {
    const modelRoot = rootRef.current;

    if (!modelRoot || isOptimizing) {
      return;
    }

    const angleSumThreshold = triangleNormalAngleSumRange.min;

    setIsOptimizing(true);
    clearFaceGuides();
    setGuidesVisible(false);
    clearHoverEdgeOverlay(hoveredEdgeRef.current);
    hoveredEdgeRef.current = null;

    try {
      await optimizeModel(
        modelRoot,
        normalAngleRangeRef.current,
        angleSumThreshold,
        setOptimizeStatus,
      );
      refreshModelAfterGeometryChange(modelRoot);
    } catch {
      setOptimizeStatus("Optimization failed");
    } finally {
      setIsOptimizing(false);
    }
  };

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

    const getEdgeAtPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hit = raycaster
        .intersectObjects(modelRoot.children, true)
        .find((intersection) => isSelectableMesh(intersection.object));

      return hit ? getHoveredEdgeFromHit(hit) : null;
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
        return;
      }

      const edge = hoveredEdgeRef.current ?? getEdgeAtPointer(event);

      if (!edge) {
        return;
      }

      if (!swapHoveredEdgeDiagonal(edge, normalAngleRangeRef.current)) {
        return;
      }

      clearHoveredEdge();
      applyTriangleHighlights(
        modelRoot,
        highlightModeRef.current,
        triangleNormalAngleSumRangeRef.current,
      );
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

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
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
      window.removeEventListener("keyup", handleKeyUp);
      clearModel(modelRoot);
      rootRef.current = null;
      guideRootRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      loaderRef.current = null;
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const modelRoot = rootRef.current;

    if (!modelRoot) {
      return;
    }

    highlightModeRef.current = {
      areaThreshold: smallTriangleArea,
      type: "area",
    };
    applyTriangleHighlights(
      modelRoot,
      highlightModeRef.current,
      triangleNormalAngleSumRangeRef.current,
    );
  }, [smallTriangleArea]);

  useEffect(() => {
    const modelRoot = rootRef.current;

    normalAngleRangeRef.current = normalAngleRange;

    if (!modelRoot) {
      return;
    }

    applyNormalAngleLineColors(modelRoot, normalAngleRange);
    applyTriangleHighlights(
      modelRoot,
      highlightModeRef.current,
      triangleNormalAngleSumRangeRef.current,
    );
  }, [normalAngleRange]);

  useEffect(() => {
    const modelRoot = rootRef.current;

    triangleNormalAngleSumRangeRef.current = triangleNormalAngleSumRange;

    if (!modelRoot) {
      return;
    }

    applyTriangleHighlights(modelRoot, highlightModeRef.current, triangleNormalAngleSumRange);
  }, [triangleNormalAngleSumRange]);

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
    clearFaceGuides();
    setGuidesVisible(false);
    setLoadState("loading");
    setStatusText(`Loading ${file.name}`);
    setLineOptimizeStatus("");
    setOptimizeStatus("");

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
        applyNormalAngleLineColors(model, normalAngleRange);

        const areaRange = getTriangleAreaRange(model) ?? defaultTriangleAreaRange;
        const nextSmallTriangleArea = clampAreaThreshold(smallTriangleArea, areaRange);

        setTriangleAreaRange(areaRange);
        setSmallTriangleArea(nextSmallTriangleArea);
        hoveredEdgeRef.current = null;
        highlightModeRef.current = {
          areaThreshold: nextSmallTriangleArea,
          type: "area",
        };
        applyTriangleHighlights(model, highlightModeRef.current, triangleNormalAngleSumRange);
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

      <div className="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".glb,model/gltf-binary"
          className="sr-only"
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="pointer-events-auto rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-wait disabled:opacity-70"
          disabled={loadState === "loading" || isOptimizing}
          onClick={() => inputRef.current?.click()}
        >
          Load GLB
        </button>
        <span
          className="max-w-[min(28rem,calc(100vw-9rem))] truncate rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur"
          aria-live="polite"
        >
          {statusText}
        </span>
        <label className="pointer-events-auto flex items-center gap-2 rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur">
          <span>Small area</span>
          <input
            type="range"
            min={triangleAreaRange.min}
            max={triangleAreaRange.max}
            step={getSliderStep(triangleAreaRange)}
            value={smallTriangleArea}
            className="accent-yellow-400"
            onChange={(event) => setSmallTriangleArea(Number(event.target.value))}
          />
          <span className="tabular-nums">{formatArea(smallTriangleArea)}</span>
          <span className="text-neutral-500 tabular-nums">
            {formatArea(triangleAreaRange.min)}-{formatArea(triangleAreaRange.max)}
          </span>
        </label>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 text-sm text-neutral-700">
        <div className="rounded-md bg-white/85 px-3 py-2 shadow-sm backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span>Line angle sign</span>
            <span className="text-neutral-500 tabular-nums">
              {formatAngle(normalAngleRange.min)} to {formatAngle(normalAngleRange.max)} deg
            </span>
          </div>
          <div className="relative h-7">
            <div
              className="absolute top-2 right-0 left-0 h-3 rounded-sm"
              style={{ background: getNormalAngleRangeGradient(normalAngleRange) }}
            />
            <input
              type="range"
              min={minSignedNormalAngle}
              max={maxColoredNormalAngle}
              step="0.5"
              value={normalAngleRange.min}
              aria-label="Minimum visible signed line normal angle"
              className="angle-range-slider"
              onChange={(event) => {
                const nextMin = Math.min(Number(event.target.value), normalAngleRange.max);

                setNormalAngleRange((current) => ({
                  max: current.max,
                  min: nextMin,
                }));
              }}
            />
            <input
              type="range"
              min={minSignedNormalAngle}
              max={maxColoredNormalAngle}
              step="0.5"
              value={normalAngleRange.max}
              aria-label="Maximum visible signed line normal angle"
              className="angle-range-slider"
              onChange={(event) => {
                const nextMax = Math.max(Number(event.target.value), normalAngleRange.min);

                setNormalAngleRange((current) => ({
                  max: nextMax,
                  min: current.min,
                }));
              }}
            />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex flex-1 justify-between text-xs text-neutral-500">
              <span>-45 in</span>
              <span>0 flat</span>
              <span>+45 out</span>
            </div>
            <button
              type="button"
              className="pointer-events-auto rounded-md bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loadState !== "ready" || isOptimizing}
              onClick={handleLineOptimize}
            >
              {isOptimizing ? "Optimizing" : "Optimize"}
            </button>
          </div>
          {lineOptimizeStatus && (
            <div className="mt-2 truncate text-xs text-neutral-500" aria-live="polite">
              {lineOptimizeStatus}
            </div>
          )}
        </div>

        <div className="rounded-md bg-white/85 px-3 py-2 shadow-sm backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span>Face angle sum</span>
            <span className="text-neutral-500 tabular-nums">
              {formatAngle(triangleNormalAngleSumRange.min)}-
              {formatAngle(triangleNormalAngleSumRange.max)} deg
            </span>
          </div>
          <div className="relative h-7">
            <div
              className="absolute top-2 right-0 left-0 h-3 rounded-sm"
              style={{
                background: getTriangleNormalAngleSumRangeGradient(triangleNormalAngleSumRange),
              }}
            />
            <input
              type="range"
              min="0"
              max={maxTriangleNormalAngleSum}
              step="0.5"
              value={triangleNormalAngleSumRange.min}
              aria-label="Minimum visible face normal angle sum"
              className="angle-range-slider"
              onChange={(event) => {
                const nextMin = Math.min(
                  Number(event.target.value),
                  triangleNormalAngleSumRange.max,
                );

                setTriangleNormalAngleSumRange((current) => ({
                  max: current.max,
                  min: nextMin,
                }));
                clearFaceGuides();
                if (guidesVisible) {
                  setOptimizeStatus("Guides hidden");
                }
                setGuidesVisible(false);
              }}
            />
            <input
              type="range"
              min="0"
              max={maxTriangleNormalAngleSum}
              step="0.5"
              value={triangleNormalAngleSumRange.max}
              aria-label="Maximum visible face normal angle sum"
              className="angle-range-slider"
              onChange={(event) => {
                const nextMax = Math.max(
                  Number(event.target.value),
                  triangleNormalAngleSumRange.min,
                );

                setTriangleNormalAngleSumRange((current) => ({
                  max: nextMax,
                  min: current.min,
                }));
                clearFaceGuides();
                if (guidesVisible) {
                  setOptimizeStatus("Guides hidden");
                }
                setGuidesVisible(false);
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-neutral-500">
            <span>0</span>
            <span>135 deg</span>
            <span>outside dark</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="pointer-events-auto flex-1 rounded-md bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loadState !== "ready" || isOptimizing}
              onClick={handleOptimize}
            >
              {isOptimizing ? "Optimizing" : "Optimize"}
            </button>
            <button
              type="button"
              className="pointer-events-auto flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-300 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loadState !== "ready" || isOptimizing}
              onClick={handleFaceCollapse}
            >
              {isOptimizing ? "Optimizing" : "Collapse"}
            </button>
            <button
              type="button"
              className="pointer-events-auto flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-300 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loadState !== "ready" || isOptimizing}
              onClick={handleGuidesToggle}
            >
              {guidesVisible ? "Hide" : "Guides"}
            </button>
          </div>
          {optimizeStatus && (
            <div className="mt-2 truncate text-xs text-neutral-500" aria-live="polite">
              {optimizeStatus}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
