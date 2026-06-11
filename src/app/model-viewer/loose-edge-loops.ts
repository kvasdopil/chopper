import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import {
  cappedLooseEdgeColor,
  looseEdgeColor,
  isSelectableMesh,
  type HoveredEdge,
  type LooseEdgeLoop,
  type LooseEdgeLoopCapState,
  type LooseEdgeLoopMember,
  type LooseEdgeRenderCache,
  type LooseEdgeSegment,
} from "./model-viewer-shared";

export function getLooseEdgeLoop(mesh: THREE.Mesh, loopId: number | undefined) {
  const loopsById = mesh.userData.looseEdgeLoopById;

  if (loopId == null || !(loopsById instanceof Map)) {
    return null;
  }

  return (loopsById.get(loopId) as LooseEdgeLoop | undefined) ?? null;
}

export function isSameLooseEdgeLoop(first: HoveredEdge | null, second: HoveredEdge | null) {
  return (
    first?.isLooseEdge === true &&
    second?.isLooseEdge === true &&
    first.mesh === second.mesh &&
    first.objectId === second.objectId &&
    first.loopId === second.loopId
  );
}

export function setLooseEdgeLoopColor(
  mesh: THREE.Mesh,
  loopId: number | undefined,
  colorValue: number,
) {
  const loop = getLooseEdgeLoop(mesh, loopId);

  if (!loop) {
    return;
  }

  const color = new THREE.Color(colorValue);
  const renderCacheByObjectId = mesh.userData.looseEdgeRenderCacheByObjectId as
    | Map<number, LooseEdgeRenderCache>
    | undefined;
  const renderCache = renderCacheByObjectId?.get(loop.objectId);
  const overlays = [
    mesh.userData.obstructedLooseEdgeOverlay as LineSegments2 | undefined,
    mesh.userData.looseEdgeOverlay as LineSegments2 | undefined,
  ];

  if (renderCache) {
    loop.segmentIndexes.forEach((segmentIndex) => {
      if (segmentIndex < 0 || segmentIndex >= renderCache.segmentCount) {
        return;
      }

      const colorIndex = segmentIndex * 6;

      renderCache.colors[colorIndex] = color.r;
      renderCache.colors[colorIndex + 1] = color.g;
      renderCache.colors[colorIndex + 2] = color.b;
      renderCache.colors[colorIndex + 3] = color.r;
      renderCache.colors[colorIndex + 4] = color.g;
      renderCache.colors[colorIndex + 5] = color.b;
    });
  }

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
      if (segmentIndex < 0 || segmentIndex >= startColor.count || segmentIndex >= endColor.count) {
        return;
      }

      startColor.setXYZ(segmentIndex, color.r, color.g, color.b);
      endColor.setXYZ(segmentIndex, color.r, color.g, color.b);
    });

    startColor.needsUpdate = true;
    endColor.needsUpdate = true;
  });
}

export function getScreenPoint(
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

export function getPointToSegmentDistance(
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

export function getLoopFillPointKey(point: THREE.Vector3) {
  const precision = 100000;

  return [
    Math.round(point.x * precision),
    Math.round(point.y * precision),
    Math.round(point.z * precision),
  ].join(",");
}

export function getLooseEdgeLoopCacheKey(mesh: THREE.Mesh, loop: LooseEdgeLoop) {
  return `${mesh.uuid}:${[...loop.segmentKeys].sort().join("~")}`;
}

export function getLooseEdgeLoopMember(
  mesh: THREE.Mesh,
  loop: LooseEdgeLoop,
): LooseEdgeLoopMember | null {
  const edge = createLooseEdgeFromLoop(mesh, loop);

  if (!edge) {
    return null;
  }

  return {
    edge,
    key: getLooseEdgeLoopCacheKey(mesh, loop),
    loop,
    mesh,
  };
}

export function getLinkedLooseEdgeLoopMembers(
  modelRoot: THREE.Object3D | null,
  edge: HoveredEdge,
): LooseEdgeLoopMember[] {
  const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);
  const fallbackMember = loop ? getLooseEdgeLoopMember(edge.mesh, loop) : null;

  if (!modelRoot || !loop || !fallbackMember || loop.pairKey.length === 0) {
    return fallbackMember ? [fallbackMember] : [];
  }

  const members: LooseEdgeLoopMember[] = [];

  modelRoot.traverse((child) => {
    if (!isSelectableMesh(child)) {
      return;
    }

    const loopsById = child.userData.looseEdgeLoopById;

    if (!(loopsById instanceof Map)) {
      return;
    }

    loopsById.forEach((candidateLoop) => {
      const typedLoop = candidateLoop as LooseEdgeLoop;

      if (typedLoop.pairKey !== loop.pairKey) {
        return;
      }

      const member = getLooseEdgeLoopMember(child, typedLoop);

      if (member) {
        members.push(member);
      }
    });
  });

  const objectIds = new Set(members.map((member) => member.loop.objectId));

  return members.length === 2 && objectIds.size === 2 ? members : [fallbackMember];
}

export function getLooseEdgeLoopFillKey(edge: HoveredEdge) {
  const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);

  return loop
    ? getLooseEdgeLoopCacheKey(edge.mesh, loop)
    : `${edge.mesh.uuid}:${edge.objectId}:${edge.loopId ?? -1}`;
}

export function getLooseEdgeLoopDisplayColor(
  mesh: THREE.Mesh,
  loop: LooseEdgeLoop,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  return loopCapStates.has(getLooseEdgeLoopCacheKey(mesh, loop))
    ? cappedLooseEdgeColor
    : looseEdgeColor;
}

export function createLooseEdgeFromLoop(mesh: THREE.Mesh, loop: LooseEdgeLoop): HoveredEdge | null {
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
