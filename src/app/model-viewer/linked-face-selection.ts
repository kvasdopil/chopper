import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import {
  defaultObjectId,
  linkedFaceSelectionColor,
  linkedFaceSelectionGraphInterval,
  linkedFaceSelectionLineWidth,
  looseEdgeColor,
  looseEdgeHoverRenderOrder,
  looseEdgeLineWidth,
  maxLinkedFaceSelectionAngle,
  ensureVertexTopologyIds,
  getNextVertexTopologyId,
  getTriangleObjectIds,
  type LinkedFaceSelectionCache,
  type LinkedFaceSelectionDetails,
  type SelectionBoundaryLoop,
} from "./model-viewer-shared";
import {
  buildMeshTopology,
  colorTriangle,
  getTriangleEdgeKeys,
  getTopologyEdgeNormalAngle,
  getTriangleVertices,
} from "./mesh-topology";
import { getPointFromVertexKey } from "./model-persistence";

export function buildLinkedFaceSelection(
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

export function findLinkedFaceGraphParent(parents: number[], index: number) {
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

export function unionLinkedFaceCacheTriangles(
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

export function buildLinkedFaceSelectionCache(
  mesh: THREE.Mesh,
  seedTriangleIndex: number,
  existingTopology: LinkedFaceSelectionCache["topology"] | null = null,
): LinkedFaceSelectionCache | null {
  const topology = existingTopology?.mesh === mesh ? existingTopology : buildMeshTopology(mesh);

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

export function createLinkedFaceSelectionFromCache(
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

const linkedFaceGradientBlue = new THREE.Color(0x1e3a8a);
const linkedFaceGradientGreen = new THREE.Color(0x22c55e);
const linkedFaceGradientRed = new THREE.Color(0xef4444);

function getLinkedFaceSelectionGradientColor(
  threshold: number,
  maxThreshold: number,
  target: THREE.Color,
) {
  const normalized = maxThreshold > 0 ? THREE.MathUtils.clamp(threshold / maxThreshold, 0, 1) : 0;

  if (normalized < 0.5) {
    return target.copy(linkedFaceGradientBlue).lerp(linkedFaceGradientGreen, normalized * 2);
  }

  return target.copy(linkedFaceGradientGreen).lerp(linkedFaceGradientRed, (normalized - 0.5) * 2);
}

function getLinkedFaceSelectionGraphStepIndex(cache: LinkedFaceSelectionCache, threshold: number) {
  if (threshold <= 0 || cache.interval <= 0) {
    return 0;
  }

  return Math.min(
    Math.max(Math.ceil((threshold - Number.EPSILON) / cache.interval), 0),
    cache.counts.length - 1,
  );
}

export function applyLinkedFaceSelectionColors(
  selection: LinkedFaceSelectionDetails | null,
  cache: LinkedFaceSelectionCache | null = null,
) {
  if (!selection) {
    return;
  }

  const color = selection.mesh.geometry.getAttribute("color");

  if (!(color instanceof THREE.BufferAttribute)) {
    return;
  }

  if (
    cache &&
    cache.mesh === selection.mesh &&
    cache.objectId === selection.objectId &&
    cache.seedTriangleIndex === selection.seedTriangleIndex
  ) {
    const gradientColor = new THREE.Color();
    const maxThreshold = cache.maxThreshold;

    cache.thresholdByTriangle.forEach((threshold, triangleIndex) => {
      if (!Number.isFinite(threshold) || triangleIndex * 3 + 2 >= color.count) {
        return;
      }

      const stepIndex = getLinkedFaceSelectionGraphStepIndex(cache, threshold);
      const graphThreshold = stepIndex * cache.interval;

      colorTriangle(
        color,
        triangleIndex * 3,
        getLinkedFaceSelectionGradientColor(graphThreshold, maxThreshold, gradientColor),
      );
    });
  } else {
    selection.selectedTriangleIndexes.forEach((triangleIndex) => {
      colorTriangle(color, triangleIndex * 3, linkedFaceSelectionColor);
    });
  }

  color.needsUpdate = true;
}

export function createLinkedFaceSelectionOverlay(selection: LinkedFaceSelectionDetails) {
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

export function buildSelectionBoundaryLoops(selection: LinkedFaceSelectionDetails) {
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

export function createSelectionBoundaryLoopOverlay(
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

export function getBoundaryLoopRegionTriangleIndexes(
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

function replaceTopologyTriangleEdgeKeys(
  topology: LinkedFaceSelectionDetails["topology"],
  triangleIndex: number,
  nextEdgeKeys: string[],
) {
  const triangle = topology.triangles[triangleIndex];

  if (!triangle) {
    return;
  }

  triangle.edgeKeys.forEach((edgeKey) => {
    const triangleIndexes = topology.edgeToTriangles.get(edgeKey);

    if (!triangleIndexes) {
      return;
    }

    const index = triangleIndexes.indexOf(triangleIndex);

    if (index >= 0) {
      triangleIndexes.splice(index, 1);
    }

    if (triangleIndexes.length === 0) {
      topology.edgeToTriangles.delete(edgeKey);
    }
  });

  triangle.edgeKeys = nextEdgeKeys;
  nextEdgeKeys.forEach((edgeKey) => {
    const triangleIndexes = topology.edgeToTriangles.get(edgeKey);

    if (triangleIndexes) {
      triangleIndexes.push(triangleIndex);
    } else {
      topology.edgeToTriangles.set(edgeKey, [triangleIndex]);
    }
  });
}

function refreshCutRegionTopology(
  topology: LinkedFaceSelectionDetails["topology"],
  regionTriangleIndexes: Set<number>,
) {
  regionTriangleIndexes.forEach((triangleIndex) => {
    const vertices = getTriangleVertices(topology.position, triangleIndex * 3);

    if (!vertices) {
      return;
    }

    topology.triangles[triangleIndex].vertices = vertices;
    replaceTopologyTriangleEdgeKeys(topology, triangleIndex, getTriangleEdgeKeys(vertices));
  });
}

export function cutSelectionBoundaryLoopTopology(
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

  if (changed) {
    refreshCutRegionTopology(selection.topology, regionTriangleIndexes);
  }

  return changed;
}
