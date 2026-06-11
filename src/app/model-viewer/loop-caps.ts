import * as THREE from "three";

import {
  defaultObjectId,
  looseEdgeLoopCylinderConeOffsetScale,
  looseEdgeLoopCylinderShapeScale,
  targetModelSize,
  getSeparatedObjectColor,
  getTriangleObjectIds,
  type HoveredEdge,
  type LooseEdgeSegment,
  type LooseEdgeLoopCapAxisData,
  type LooseEdgeLoopFillData,
  type LooseEdgeLoopFillSegment,
} from "./model-viewer-shared";
import type { LooseEdgeLoopMode } from "../viewer-controls/types";
import { isCylinderLoopMode } from "./model-viewer-shared";
import { getLooseEdgeLoop, getLooseEdgeLoopFillKey, getLoopFillPointKey } from "./loose-edge-loops";

export function getMeshObjectLocalCenter(mesh: THREE.Mesh, objectId: number) {
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

export function getMeshObjectProjectionSize(
  mesh: THREE.Mesh,
  objectId: number,
  axis: THREE.Vector3,
) {
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

export function pushLoopFillTriangle(
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

export function createLoopFillGeometry(vertices: number[]) {
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

export function getLoopTriangleOutwardNormal(
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

export function appendForceClosingSegments(
  points: THREE.Vector3[],
  segments: LooseEdgeLoopFillSegment[],
) {
  const degreeByPointIndex = new Map<number, number>();

  segments.forEach((segment) => {
    degreeByPointIndex.set(
      segment.startIndex,
      (degreeByPointIndex.get(segment.startIndex) ?? 0) + 1,
    );
    degreeByPointIndex.set(segment.endIndex, (degreeByPointIndex.get(segment.endIndex) ?? 0) + 1);
  });

  const openPointIndexes = points
    .map((_point, index) => index)
    .filter((index) => (degreeByPointIndex.get(index) ?? 0) % 2 === 1);
  let forceClosed = false;

  while (openPointIndexes.length >= 2) {
    const startIndex = openPointIndexes.shift();

    if (startIndex == null) {
      break;
    }

    let nearestIndex = -1;
    let nearestDistance = Infinity;

    openPointIndexes.forEach((candidateIndex, listIndex) => {
      const distance = points[startIndex].distanceToSquared(points[candidateIndex]);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = listIndex;
      }
    });

    const endIndex = nearestIndex >= 0 ? openPointIndexes.splice(nearestIndex, 1)[0] : undefined;

    if (endIndex == null || nearestDistance <= 0.000000000001) {
      continue;
    }

    segments.push({
      end: points[endIndex].clone(),
      endIndex,
      start: points[startIndex].clone(),
      startIndex,
    });
    forceClosed = true;
  }

  return forceClosed;
}

export function getLooseEdgeLoopFillData(edge: HoveredEdge): LooseEdgeLoopFillData | null {
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

  const forceClosed = loop.isClosed ? false : appendForceClosingSegments(points, segments);

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
    forceClosed,
    objectCenter,
    points,
    referenceNormal,
    segments,
  };
}

export function getLooseEdgeLoopCapAxisData(
  edge: HoveredEdge,
  mode: LooseEdgeLoopMode,
  normalTarget: THREE.Vector3 | null = null,
): LooseEdgeLoopCapAxisData | null {
  const data = getLooseEdgeLoopFillData(edge);

  if (!data || mode === "none") {
    return null;
  }

  let axis: THREE.Vector3 | null;

  if (mode !== "fill" && normalTarget) {
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

export function getLooseEdgeLoopCapOffsetBounds(
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
  const limit = Math.max(span * 2, Math.abs(axisData.defaultOffset));

  return mode === "fill" ? { max: span, min: -span } : { max: limit, min: -limit };
}

export function clampLooseEdgeLoopCapOffset(
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

export function createLooseEdgeLoopFlatFillGeometry(
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

export function getLooseEdgeLoopExtrusionAxis(
  mode: LooseEdgeLoopMode,
  data: LooseEdgeLoopFillData,
) {
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

export function createLooseEdgeLoopExtrusionGeometry(
  data: LooseEdgeLoopFillData,
  axis: THREE.Vector3,
  capOffset: number,
) {
  if (axis.lengthSq() === 0) {
    return null;
  }

  const extrusionLength = capOffset;

  if (Math.abs(extrusionLength) <= 0.000001) {
    return createLooseEdgeLoopFlatFillGeometry(data, axis, 0);
  }

  const vertices: number[] = [];
  const capNormal = axis.clone().multiplyScalar(Math.sign(extrusionLength) || 1);
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
    pushLoopFillTriangle(vertices, capCenter, capStart, capEnd, capNormal);
  });

  return createLoopFillGeometry(vertices);
}

export function getLoopPointsProjectedToAxisPlane(
  points: THREE.Vector3[],
  planeCenter: THREE.Vector3,
  axis: THREE.Vector3,
) {
  return points.map((point) => {
    const projectedPoint = point.clone();
    const planeDistance = projectedPoint.clone().sub(planeCenter).dot(axis);

    return projectedPoint.addScaledVector(axis, -planeDistance);
  });
}

export function createLooseEdgeLoopCylinderGeometry(
  data: LooseEdgeLoopFillData,
  axis: THREE.Vector3,
  capOffset: number,
  cone: boolean,
) {
  if (axis.lengthSq() === 0) {
    return null;
  }

  const vertices: number[] = [];
  const offsetSign = Math.sign(capOffset) || 1;
  const topNormal = axis.clone().multiplyScalar(offsetSign);
  const baseNormal = topNormal.clone().negate();
  const scaledPoints = data.points.map((point) =>
    data.center.clone().lerp(point, looseEdgeLoopCylinderShapeScale),
  );
  const basePoints = getLoopPointsProjectedToAxisPlane(scaledPoints, data.center, axis);

  const appendCap = (
    center: THREE.Vector3,
    capPoints: THREE.Vector3[],
    capNormal: THREE.Vector3,
  ) => {
    data.segments.forEach((segment) => {
      const start = capPoints[segment.startIndex];
      const end = capPoints[segment.endIndex];

      if (!start || !end) {
        return;
      }

      pushLoopFillTriangle(vertices, center, start, end, capNormal);
    });
  };

  if (Math.abs(capOffset) <= 0.000001) {
    appendCap(data.center, basePoints, axis);

    return createLoopFillGeometry(vertices);
  }

  const topCenter = data.center.clone().addScaledVector(axis, capOffset);
  const topPoints = basePoints.map((point) => point.clone().addScaledVector(axis, capOffset));
  const appendSideWalls = (
    startPoints: THREE.Vector3[],
    endPoints: THREE.Vector3[],
    startOffset: number,
    endOffset: number,
  ) => {
    data.segments.forEach((segment) => {
      const start = startPoints[segment.startIndex]?.clone().addScaledVector(axis, startOffset);
      const end = startPoints[segment.endIndex]?.clone().addScaledVector(axis, startOffset);
      const capStart = endPoints[segment.startIndex]?.clone().addScaledVector(axis, endOffset);
      const capEnd = endPoints[segment.endIndex]?.clone().addScaledVector(axis, endOffset);

      if (!start || !end || !capStart || !capEnd) {
        return;
      }

      pushLoopFillTriangle(
        vertices,
        start,
        end,
        capEnd,
        getLoopTriangleOutwardNormal(start, end, capEnd, data.objectCenter),
      );
      pushLoopFillTriangle(
        vertices,
        start,
        capEnd,
        capStart,
        getLoopTriangleOutwardNormal(start, capEnd, capStart, data.objectCenter),
      );
    });
  };

  if (cone) {
    const coneOffset = capOffset * looseEdgeLoopCylinderConeOffsetScale;

    appendSideWalls(data.points, basePoints, 0, coneOffset);
    appendSideWalls(basePoints, basePoints, coneOffset, capOffset);
  } else {
    appendCap(data.center, basePoints, baseNormal);
    appendSideWalls(basePoints, basePoints, 0, capOffset);
  }

  appendCap(topCenter, topPoints, topNormal);

  return createLoopFillGeometry(vertices);
}

export function createLooseEdgeLoopFill(
  edge: HoveredEdge,
  mode: LooseEdgeLoopMode,
  capOffset: number,
  normalTarget: THREE.Vector3 | null = null,
  cone = false,
) {
  const axisData = getLooseEdgeLoopCapAxisData(edge, mode, normalTarget);

  if (!axisData) {
    return null;
  }

  const geometry =
    mode === "fill"
      ? createLooseEdgeLoopFlatFillGeometry(axisData.data, axisData.axis, capOffset)
      : isCylinderLoopMode(mode)
        ? createLooseEdgeLoopCylinderGeometry(axisData.data, axisData.axis, capOffset, cone)
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
