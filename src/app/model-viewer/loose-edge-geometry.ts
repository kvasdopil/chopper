import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import {
  defaultObjectId,
  hoverEdgeColor,
  hoverEdgeLineWidth,
  hoverEdgeRenderOrder,
  looseEdgeColor,
  looseEdgeHoverColor,
  looseEdgeHoverOverlayLineWidth,
  looseEdgeHoverRenderOrder,
  looseEdgeUiOverlayLineWidth,
  unclosedLooseEdgeColor,
  getLooseEdgeKey,
  getTriangleObjectIds,
  getVertexKey,
  isSelectableMesh,
  type HoveredEdge,
  type LooseEdgeLoop,
  type LooseEdgeRenderCache,
  type LooseEdgeSegment,
} from "./model-viewer-shared";
import { resetMeshEdgeLoopIds } from "./mesh-edit-state";
import { getTriangleNormal } from "./mesh-topology";
import { getLooseEdgeLoop, getLoopFillPointKey } from "./loose-edge-loops";

export function getClosedLooseEdgeLoopKeys(
  componentKeys: string[],
  looseEdgeSegmentsByKey: Map<string, LooseEdgeSegment>,
) {
  const activeKeys = new Set(componentKeys);
  const keysByVertexKey = new Map<string, Set<string>>();

  const addVertexKey = (vertexKey: string, key: string) => {
    const keys = keysByVertexKey.get(vertexKey);

    if (keys) {
      keys.add(key);
      return;
    }

    keysByVertexKey.set(vertexKey, new Set([key]));
  };

  componentKeys.forEach((key) => {
    const segment = looseEdgeSegmentsByKey.get(key);

    if (!segment) {
      return;
    }

    addVertexKey(segment.startPositionKey, key);
    addVertexKey(segment.endPositionKey, key);
  });

  const pendingVertexKeys = Array.from(keysByVertexKey.entries())
    .filter(([, keys]) => keys.size <= 1)
    .map(([vertexKey]) => vertexKey);

  while (pendingVertexKeys.length > 0) {
    const vertexKey = pendingVertexKeys.pop();

    if (!vertexKey) {
      continue;
    }

    const connectedKeys = keysByVertexKey.get(vertexKey);

    if (!connectedKeys || connectedKeys.size > 1) {
      continue;
    }

    const key = connectedKeys.values().next().value;

    if (!key || !activeKeys.delete(key)) {
      continue;
    }

    const segment = looseEdgeSegmentsByKey.get(key);

    if (!segment) {
      continue;
    }

    [segment.startPositionKey, segment.endPositionKey].forEach((segmentVertexKey) => {
      const segmentConnectedKeys = keysByVertexKey.get(segmentVertexKey);

      if (!segmentConnectedKeys) {
        return;
      }

      segmentConnectedKeys.delete(key);

      if (segmentConnectedKeys.size <= 1) {
        pendingVertexKeys.push(segmentVertexKey);
      }
    });
  }

  return componentKeys.filter((key) => activeKeys.has(key));
}

export function getLooseEdgePositionEdgeKey(start: THREE.Vector3, end: THREE.Vector3) {
  return [getLoopFillPointKey(start), getLoopFillPointKey(end)].sort().join("|");
}

export function getLooseEdgeContactKey(contactObjectIds: number[]) {
  return contactObjectIds.length === 0 ? "outside" : `objects:${contactObjectIds.join(",")}`;
}

export function getLooseEdgeContactSpanGroups(
  segmentKeys: string[],
  looseEdgeSegmentsByKey: Map<string, LooseEdgeSegment>,
) {
  const activeKeys = new Set(segmentKeys);
  const keysByVertexKey = new Map<string, Set<string>>();
  const visitedKeys = new Set<string>();
  const groups: string[][] = [];

  const addVertexKey = (vertexKey: string, key: string) => {
    const keys = keysByVertexKey.get(vertexKey);

    if (keys) {
      keys.add(key);
      return;
    }

    keysByVertexKey.set(vertexKey, new Set([key]));
  };

  segmentKeys.forEach((key) => {
    const segment = looseEdgeSegmentsByKey.get(key);

    if (!segment) {
      return;
    }

    addVertexKey(segment.startPositionKey, key);
    addVertexKey(segment.endPositionKey, key);
  });

  segmentKeys.forEach((seedKey) => {
    if (visitedKeys.has(seedKey)) {
      return;
    }

    const seedSegment = looseEdgeSegmentsByKey.get(seedKey);

    if (!seedSegment) {
      return;
    }

    const groupKeys: string[] = [];
    const pendingKeys = [seedKey];

    while (pendingKeys.length > 0) {
      const key = pendingKeys.pop();

      if (!key || visitedKeys.has(key) || !activeKeys.has(key)) {
        continue;
      }

      const segment = looseEdgeSegmentsByKey.get(key);

      if (!segment || segment.contactKey !== seedSegment.contactKey) {
        continue;
      }

      visitedKeys.add(key);
      groupKeys.push(key);

      [segment.startPositionKey, segment.endPositionKey].forEach((vertexKey) => {
        keysByVertexKey.get(vertexKey)?.forEach((connectedKey) => {
          const connectedSegment = looseEdgeSegmentsByKey.get(connectedKey);

          if (
            connectedSegment &&
            connectedSegment.contactKey === seedSegment.contactKey &&
            !visitedKeys.has(connectedKey)
          ) {
            pendingKeys.push(connectedKey);
          }
        });
      });
    }

    if (groupKeys.length > 0) {
      groups.push(groupKeys);
    }
  });

  return groups;
}

export function isLooseEdgeContactSpanClosed(
  segmentKeys: string[],
  looseEdgeSegmentsByKey: Map<string, LooseEdgeSegment>,
) {
  if (segmentKeys.length < 3) {
    return false;
  }

  const degreeByVertexKey = new Map<string, number>();

  segmentKeys.forEach((key) => {
    const segment = looseEdgeSegmentsByKey.get(key);

    if (!segment) {
      return;
    }

    [segment.startPositionKey, segment.endPositionKey].forEach((vertexKey) => {
      degreeByVertexKey.set(vertexKey, (degreeByVertexKey.get(vertexKey) ?? 0) + 1);
    });
  });

  return (
    degreeByVertexKey.size >= 3 &&
    Array.from(degreeByVertexKey.values()).every((degree) => degree === 2)
  );
}

export function createLooseEdgeGeometry(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  selectedObjectId: number | null,
) {
  const geometry = new LineSegmentsGeometry();
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const editState = resetMeshEdgeLoopIds(mesh);
  const edgeSegments = new Map<
    string,
    {
      count: number;
      end: THREE.Vector3;
      endKey: string;
      endPositionKey: string;
      edgeId?: number;
      edgeKey: string;
      normal: THREE.Vector3;
      objectId: number;
      positionEdgeKey: string;
      start: THREE.Vector3;
      startKey: string;
      startPositionKey: string;
    }
  >();
  const addEdgeSegment = ({
    edgeId,
    edgeKey,
    end,
    endKey,
    normal,
    objectId,
    splitKey,
    start,
    startKey,
  }: {
    edgeId?: number;
    edgeKey: string;
    end: THREE.Vector3;
    endKey: string;
    normal: THREE.Vector3;
    objectId: number;
    splitKey?: string;
    start: THREE.Vector3;
    startKey: string;
  }) => {
    const startPositionKey = getLoopFillPointKey(start);
    const endPositionKey = getLoopFillPointKey(end);
    const positionEdgeKey = getLooseEdgePositionEdgeKey(start, end);
    const key = getLooseEdgeKey(objectId, splitKey ?? edgeKey);
    const existing = edgeSegments.get(key);

    if (existing) {
      existing.count += 1;
      return;
    }

    edgeSegments.set(key, {
      count: 1,
      end,
      endKey,
      endPositionKey,
      edgeId,
      edgeKey,
      normal: normal.clone(),
      objectId,
      positionEdgeKey,
      start,
      startKey,
      startPositionKey,
    });
  };

  if (!(position instanceof THREE.BufferAttribute)) {
    geometry.userData.segmentCount = 0;
    mesh.userData.looseEdgeKeys = new Set<string>();
    mesh.userData.looseEdgeKeysByVertexKey = new Map<string, Set<string>>();
    mesh.userData.looseEdgeLoopById = new Map<number, LooseEdgeLoop>();
    mesh.userData.looseEdgeSegmentsByKey = new Map<string, LooseEdgeSegment>();
    return geometry;
  }

  if (editState && objectIds) {
    editState.edges.forEach((edge) => {
      const start = new THREE.Vector3().fromBufferAttribute(position, edge.vertexIndexes[0]);
      const end = new THREE.Vector3().fromBufferAttribute(position, edge.vertexIndexes[1]);
      const isCutEdge = editState.edgeCut[edge.id] === 1;

      edge.faceIds.forEach((triangleIndex) => {
        const face = editState.faces[triangleIndex];

        if (!face) {
          return;
        }

        const objectId = objectIds[triangleIndex] ?? defaultObjectId;

        addEdgeSegment({
          edgeId: edge.id,
          edgeKey: edge.key,
          end,
          endKey: edge.vertexKeys[1],
          normal: face.normal,
          objectId,
          splitKey: isCutEdge ? `${edge.key}@${triangleIndex}` : undefined,
          start,
          startKey: edge.vertexKeys[0],
        });
      });
    });
  } else {
    for (let index = 0; index < position.count; index += 3) {
      const triangleIndex = index / 3;
      const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;
      const face = editState?.faces[triangleIndex];

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
        { edgeSlot: 0, end: vertices[1], start: vertices[0] },
        { edgeSlot: 1, end: vertices[2], start: vertices[1] },
        { edgeSlot: 2, end: vertices[0], start: vertices[2] },
      ].forEach(({ edgeSlot, start, end }) => {
        const indexedEdgeKey = face?.edgeKeys[edgeSlot];
        const edgeId = face?.edgeIds[edgeSlot];
        const edgeKey = indexedEdgeKey ?? [start.key, end.key].sort().join("|");
        const isCutEdge = edgeId != null && editState?.edgeCut[edgeId] === 1;
        addEdgeSegment({
          edgeId,
          edgeKey,
          end: end.point,
          endKey: end.key,
          normal: normal.clone(),
          objectId,
          splitKey: isCutEdge ? `${edgeKey}@${triangleIndex}` : undefined,
          start: start.point,
          startKey: start.key,
        });
      });
    }
  }

  const looseEdgeRecordsByPositionEdgeKey = new Map<
    string,
    Array<{ key: string; objectId: number }>
  >();

  edgeSegments.forEach((edge, key) => {
    if (edge.count !== 1) {
      return;
    }

    const records = looseEdgeRecordsByPositionEdgeKey.get(edge.positionEdgeKey);

    if (records) {
      records.push({ key, objectId: edge.objectId });
      return;
    }

    looseEdgeRecordsByPositionEdgeKey.set(edge.positionEdgeKey, [{ key, objectId: edge.objectId }]);
  });

  const contactObjectIdsByLooseEdgeKey = new Map<string, number[]>();

  looseEdgeRecordsByPositionEdgeKey.forEach((records) => {
    records.forEach((record) => {
      const contactObjectIds = Array.from(
        new Set(
          records
            .map((candidate) => candidate.objectId)
            .filter((objectId) => objectId !== record.objectId),
        ),
      ).sort((first, second) => first - second);

      contactObjectIdsByLooseEdgeKey.set(record.key, contactObjectIds);
    });
  });

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

    let renderCacheSource = looseEdgeRenderCacheSourceByObjectId.get(edge.objectId);

    if (!renderCacheSource) {
      renderCacheSource = { colors: [], positions: [] };
      looseEdgeRenderCacheSourceByObjectId.set(edge.objectId, renderCacheSource);
    }

    const shouldRenderSegment =
      selectedObjectId != null &&
      !hiddenObjectIds.has(selectedObjectId) &&
      edge.objectId === selectedObjectId;
    const segmentIndex = renderCacheSource.positions.length / 6;
    const contactObjectIds = contactObjectIdsByLooseEdgeKey.get(key) ?? [];
    const contactKey = getLooseEdgeContactKey(contactObjectIds);

    looseEdgeKeys.add(key);
    looseEdgeSegmentsByKey.set(key, {
      contactKey,
      contactObjectIds,
      end: edge.end,
      endKey: edge.endKey,
      endPositionKey: edge.endPositionKey,
      edgeId: edge.edgeId,
      edgeKey: edge.edgeKey,
      index: segmentIndex,
      loopId: -1,
      normal: edge.normal,
      objectId: edge.objectId,
      positionEdgeKey: edge.positionEdgeKey,
      start: edge.start,
      startKey: edge.startKey,
      startPositionKey: edge.startPositionKey,
    });

    [edge.startPositionKey, edge.endPositionKey].forEach((vertexKey) => {
      const connectedKeys = looseEdgeKeysByVertexKey.get(vertexKey);

      if (connectedKeys) {
        connectedKeys.add(key);
      } else {
        looseEdgeKeysByVertexKey.set(vertexKey, new Set([key]));
      }
    });

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
  const visitedLoopSegmentKeys = new Set<string>();

  looseEdgeSegmentsByKey.forEach((seedSegment, seedKey) => {
    if (visitedLoopSegmentKeys.has(seedKey)) {
      return;
    }

    const componentKeys: string[] = [];
    const pendingKeys = [seedKey];

    while (pendingKeys.length > 0) {
      const key = pendingKeys.pop();

      if (!key || visitedLoopSegmentKeys.has(key)) {
        continue;
      }

      const segment = looseEdgeSegmentsByKey.get(key);

      if (!segment) {
        continue;
      }

      visitedLoopSegmentKeys.add(key);
      componentKeys.push(key);

      [segment.startPositionKey, segment.endPositionKey].forEach((vertexKey) => {
        looseEdgeKeysByVertexKey.get(vertexKey)?.forEach((connectedKey) => {
          const connectedSegment = looseEdgeSegmentsByKey.get(connectedKey);

          if (
            connectedSegment &&
            connectedSegment.objectId === seedSegment.objectId &&
            !visitedLoopSegmentKeys.has(connectedKey)
          ) {
            pendingKeys.push(connectedKey);
          }
        });
      });
    }

    const loopSegmentKeys = getClosedLooseEdgeLoopKeys(componentKeys, looseEdgeSegmentsByKey);

    if (loopSegmentKeys.length === 0) {
      return;
    }

    getLooseEdgeContactSpanGroups(loopSegmentKeys, looseEdgeSegmentsByKey).forEach(
      (spanSegmentKeys) => {
        const firstSegment = spanSegmentKeys
          .map((key) => looseEdgeSegmentsByKey.get(key))
          .find((segment): segment is LooseEdgeSegment => Boolean(segment));

        if (!firstSegment) {
          return;
        }

        const loopId = nextLoopId;
        const loopPositions: number[] = [];
        const pairSegmentKeys: string[] = [];
        const segmentIndexes: number[] = [];
        const segmentKeys: string[] = [];

        nextLoopId += 1;

        spanSegmentKeys.forEach((key) => {
          const segment = looseEdgeSegmentsByKey.get(key);

          if (!segment) {
            return;
          }

          segment.loopId = loopId;
          segmentKeys.push(key);
          pairSegmentKeys.push(segment.positionEdgeKey);

          if (segment.index >= 0) {
            segmentIndexes.push(segment.index);
          }

          if (segment.edgeId != null && editState && segment.edgeId < editState.edgeLoopId.length) {
            editState.edgeLoopId[segment.edgeId] = loopId + 1;
          }

          loopPositions.push(
            segment.start.x,
            segment.start.y,
            segment.start.z,
            segment.end.x,
            segment.end.y,
            segment.end.z,
          );
        });

        looseEdgeLoopById.set(loopId, {
          contactKey: firstSegment.contactKey,
          contactObjectIds: [...firstSegment.contactObjectIds],
          id: loopId,
          isClosed: isLooseEdgeContactSpanClosed(segmentKeys, looseEdgeSegmentsByKey),
          objectId: firstSegment.objectId,
          pairKey: pairSegmentKeys.sort().join("~"),
          positions: new Float32Array(loopPositions),
          segmentIndexes,
          segmentKeys,
        });
      },
    );
  });

  const unclosedColor = new THREE.Color(unclosedLooseEdgeColor);

  looseEdgeLoopById.forEach((loop) => {
    if (loop.isClosed) {
      return;
    }

    const renderCache = looseEdgeRenderCacheByObjectId.get(loop.objectId);

    if (!renderCache) {
      return;
    }

    loop.segmentIndexes.forEach((segmentIndex) => {
      if (segmentIndex < 0 || segmentIndex >= renderCache.segmentCount) {
        return;
      }

      const colorIndex = segmentIndex * 6;

      renderCache.colors[colorIndex] = unclosedColor.r;
      renderCache.colors[colorIndex + 1] = unclosedColor.g;
      renderCache.colors[colorIndex + 2] = unclosedColor.b;
      renderCache.colors[colorIndex + 3] = unclosedColor.r;
      renderCache.colors[colorIndex + 4] = unclosedColor.g;
      renderCache.colors[colorIndex + 5] = unclosedColor.b;
    });
  });

  const selectedRenderCache =
    selectedObjectId != null && !hiddenObjectIds.has(selectedObjectId)
      ? looseEdgeRenderCacheByObjectId.get(selectedObjectId)
      : null;
  const renderedPositions = selectedRenderCache?.positions ?? new Float32Array(segmentPositions);
  const renderedColors = selectedRenderCache?.colors ?? new Float32Array(segmentColors);

  geometry.setPositions(renderedPositions);
  geometry.setColors(renderedColors);
  geometry.userData.segmentCount = renderedPositions.length / 6;
  mesh.userData.looseEdgeKeys = looseEdgeKeys;
  mesh.userData.looseEdgeKeysByVertexKey = looseEdgeKeysByVertexKey;
  mesh.userData.looseEdgeLoopById = looseEdgeLoopById;
  mesh.userData.looseEdgeRenderCacheByObjectId = looseEdgeRenderCacheByObjectId;
  mesh.userData.looseEdgeSegmentsByKey = looseEdgeSegmentsByKey;

  return geometry;
}

export function createLooseEdgeRenderGeometryFromCache(
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

export function refreshLooseEdgeOverlay(
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
  const cacheDirty = mesh.userData.looseEdgeCacheDirty === true;
  const geometry =
    rebuildCache || cacheDirty || !hasLooseEdgeCache
      ? createLooseEdgeGeometry(mesh, hiddenObjectIds, selectedObjectId)
      : createLooseEdgeRenderGeometryFromCache(mesh, hiddenObjectIds, selectedObjectId);
  const segmentCount = geometry.userData.segmentCount ?? 0;

  mesh.userData.renderedLooseEdgeObjectId = selectedObjectId;
  mesh.userData.looseEdgeCacheDirty = false;

  looseEdgeOverlays.forEach((looseEdges, index) => {
    if (!looseEdges) {
      return;
    }

    looseEdges.geometry.dispose();
    looseEdges.geometry = index === 0 ? geometry : geometry.clone();
    looseEdges.geometry.userData.segmentCount = segmentCount;
    looseEdges.userData.renderedLooseEdgeObjectId = selectedObjectId;
    looseEdges.visible = segmentCount > 0;
  });
}

export function refreshLooseEdgeOverlays(
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

export function createHoverEdgeGeometry(edge: HoveredEdge) {
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

export function clearHoverEdgeOverlay(edge: HoveredEdge | null) {
  const hoverEdge = edge?.mesh.userData.hoverEdgeOverlay as LineSegments2 | undefined;

  if (hoverEdge) {
    hoverEdge.visible = false;
  }
}

export function setHoverEdgeOverlay(edge: HoveredEdge) {
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
    hoverEdge.material.linewidth = isLoopHover
      ? looseEdgeHoverOverlayLineWidth
      : hoverEdgeLineWidth;
  }

  hoverEdge.visible = true;
}

export function createLooseEdgeLoopOverlay(edge: HoveredEdge, colorValue: number) {
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
