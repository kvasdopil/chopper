import * as THREE from "three";

import {
  collectSelectableMeshes,
  defaultObjectId,
  disposeObject,
  getSeparatedObjectColor,
  getTriangleObjectIds,
  type LooseEdgeLoopCapState,
} from "./model-viewer-core";

const autoNameCaptureSize = 1024;
const capturePadding = 1.12;
const markerRadius = 17;
const generatedObjectLabelPattern = /^Object\s+\d+$/;

export type AutoNamedImageObject = {
  marker: string;
  name: string;
};

export type ObjectNamingMarker = {
  fillColor: string;
  marker: string;
  objectId: number;
  textColor: string;
  x: number;
  y: number;
};

export type ObjectNamingCapture = {
  blob: Blob;
  dispose: () => void;
  getMarker: (marker: string) => ObjectNamingMarker | null;
  markers: ObjectNamingMarker[];
  size: number;
};

function getObjectPositions(positionsByObjectId: Map<number, number[]>, objectId: number) {
  let positions = positionsByObjectId.get(objectId);

  if (!positions) {
    positions = [];
    positionsByObjectId.set(objectId, positions);
  }

  return positions;
}

function appendPoint(
  positions: number[],
  point: THREE.Vector3,
  matrixWorld: THREE.Matrix4,
  bounds: THREE.Box3,
) {
  point.applyMatrix4(matrixWorld);
  positions.push(point.x, point.y, point.z);
  bounds.expandByPoint(point);
}

function appendGeometryTriangles(
  positionsByObjectId: Map<number, number[]>,
  objectId: number,
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  bounds: THREE.Box3,
) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const point = new THREE.Vector3();
  const positions = getObjectPositions(positionsByObjectId, objectId);

  if (!(position instanceof THREE.BufferAttribute)) {
    return;
  }

  if (index) {
    for (let itemIndex = 0; itemIndex + 2 < index.count; itemIndex += 3) {
      for (let offset = 0; offset < 3; offset += 1) {
        appendPoint(
          positions,
          point.fromBufferAttribute(position, index.getX(itemIndex + offset)),
          matrixWorld,
          bounds,
        );
      }
    }

    return;
  }

  for (let vertexIndex = 0; vertexIndex + 2 < position.count; vertexIndex += 3) {
    for (let offset = 0; offset < 3; offset += 1) {
      appendPoint(
        positions,
        point.fromBufferAttribute(position, vertexIndex + offset),
        matrixWorld,
        bounds,
      );
    }
  }
}

function collectObjectNamingPositions(
  modelRoot: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  const bounds = new THREE.Box3();
  const positionsByObjectId = new Map<number, number[]>();
  const point = new THREE.Vector3();

  modelRoot.updateMatrixWorld(true);
  collectSelectableMeshes(modelRoot).forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const objectIds = getTriangleObjectIds(mesh);

    if (!(position instanceof THREE.BufferAttribute)) {
      return;
    }

    mesh.updateMatrixWorld(true);

    for (let vertexIndex = 0; vertexIndex + 2 < position.count; vertexIndex += 3) {
      const triangleIndex = vertexIndex / 3;
      const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;

      if (hiddenObjectIds.has(objectId)) {
        continue;
      }

      const positions = getObjectPositions(positionsByObjectId, objectId);

      for (let offset = 0; offset < 3; offset += 1) {
        appendPoint(
          positions,
          point.fromBufferAttribute(position, vertexIndex + offset),
          mesh.matrixWorld,
          bounds,
        );
      }
    }
  });

  loopCapStates.forEach((state) => {
    const fill = state.fill;

    if (!fill || state.mode === "none" || hiddenObjectIds.has(state.objectId)) {
      return;
    }

    fill.updateMatrixWorld(true);
    appendGeometryTriangles(
      positionsByObjectId,
      state.objectId,
      fill.geometry,
      fill.matrixWorld,
      bounds,
    );
  });

  return { bounds, positionsByObjectId };
}

function fitCameraToPositions(
  camera: THREE.OrthographicCamera,
  sourceCamera: THREE.Camera,
  positionsByObjectId: Map<number, number[]>,
  bounds: THREE.Box3,
) {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const cameraPoint = new THREE.Vector3();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minDistance = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxDistance = Number.NEGATIVE_INFINITY;

  sourceCamera.updateMatrixWorld(true);
  camera.position.copy(sourceCamera.position);
  camera.quaternion.copy(sourceCamera.quaternion);
  camera.up.copy(sourceCamera.up);
  camera.updateMatrixWorld(true);

  positionsByObjectId.forEach((positions) => {
    for (let index = 0; index + 2 < positions.length; index += 3) {
      cameraPoint
        .set(positions[index], positions[index + 1], positions[index + 2])
        .applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, cameraPoint.x);
      minY = Math.min(minY, cameraPoint.y);
      minDistance = Math.min(minDistance, -cameraPoint.z);
      maxX = Math.max(maxX, cameraPoint.x);
      maxY = Math.max(maxY, cameraPoint.y);
      maxDistance = Math.max(maxDistance, -cameraPoint.z);
    }
  });

  const projectedWidth = maxX - minX;
  const projectedHeight = maxY - minY;
  const projectedSpan = Math.max(projectedWidth, projectedHeight, 0.001) * capturePadding;
  const projectedCenterX = (minX + maxX) / 2;
  const projectedCenterY = (minY + maxY) / 2;
  const halfSpan = projectedSpan / 2;

  camera.left = projectedCenterX - halfSpan;
  camera.right = projectedCenterX + halfSpan;
  camera.top = projectedCenterY + halfSpan;
  camera.bottom = projectedCenterY - halfSpan;
  camera.near = Math.max(0.001, minDistance - sphere.radius);
  camera.far = Math.max(camera.near + 1, maxDistance + sphere.radius, 100);
  camera.updateProjectionMatrix();
}

function createCaptureMeshes(positionsByObjectId: Map<number, number[]>, scene: THREE.Scene) {
  const meshes: THREE.Mesh[] = [];

  Array.from(positionsByObjectId.entries())
    .sort(([firstObjectId], [secondObjectId]) => firstObjectId - secondObjectId)
    .forEach(([objectId, positions]) => {
      if (positions.length < 9) {
        return;
      }

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: getSeparatedObjectColor(objectId),
          metalness: 0,
          roughness: 0.82,
          side: THREE.FrontSide,
        }),
      );

      mesh.userData.objectId = objectId;
      scene.add(mesh);
      meshes.push(mesh);
    });

  return meshes;
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Could not create object naming screenshot."));
    }, "image/png");
  });
}

function getObjectMarkerLabel(index: number) {
  let label = "";
  let value = index;

  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return label;
}

function getObjectMarkerColors(objectId: number) {
  const color = getSeparatedObjectColor(objectId);
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

  return {
    fillColor: `#${color.getHexString()}`,
    textColor: luminance > 0.55 ? "#111827" : "#ffffff",
  };
}

function getObjectNamingMarkers(
  camera: THREE.OrthographicCamera,
  positionsByObjectId: Map<number, number[]>,
) {
  const markers: ObjectNamingMarker[] = [];
  const cameraPoint = new THREE.Vector3();
  const width = camera.right - camera.left;
  const height = camera.top - camera.bottom;

  Array.from(positionsByObjectId.entries())
    .sort(([firstObjectId], [secondObjectId]) => firstObjectId - secondObjectId)
    .forEach(([objectId, positions], markerIndex) => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      for (let index = 0; index + 2 < positions.length; index += 3) {
        cameraPoint
          .set(positions[index], positions[index + 1], positions[index + 2])
          .applyMatrix4(camera.matrixWorldInverse);
        minX = Math.min(minX, cameraPoint.x);
        minY = Math.min(minY, cameraPoint.y);
        maxX = Math.max(maxX, cameraPoint.x);
        maxY = Math.max(maxY, cameraPoint.y);
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const colors = getObjectMarkerColors(objectId);

      markers.push({
        fillColor: colors.fillColor,
        marker: getObjectMarkerLabel(markerIndex),
        objectId,
        textColor: colors.textColor,
        x: THREE.MathUtils.clamp(
          ((centerX - camera.left) / width) * autoNameCaptureSize,
          markerRadius + 2,
          autoNameCaptureSize - markerRadius - 2,
        ),
        y: THREE.MathUtils.clamp(
          ((camera.top - centerY) / height) * autoNameCaptureSize,
          markerRadius + 2,
          autoNameCaptureSize - markerRadius - 2,
        ),
      });
    });

  return markers;
}

function createMarkerCaptureCanvas(sourceCanvas: HTMLCanvasElement, markers: ObjectNamingMarker[]) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceCanvas;
  }

  canvas.width = autoNameCaptureSize;
  canvas.height = autoNameCaptureSize;
  context.drawImage(sourceCanvas, 0, 0, autoNameCaptureSize, autoNameCaptureSize);

  markers.forEach((marker) => {
    context.save();
    context.fillStyle = marker.fillColor;
    context.strokeStyle = marker.textColor === "#ffffff" ? "#111827" : "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(marker.x, marker.y, markerRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = marker.textColor;
    context.font = `700 ${marker.marker.length > 1 ? 16 : 19}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(marker.marker, marker.x, marker.y + 0.5);
    context.restore();
  });

  return canvas;
}

export async function createObjectNamingCapture(
  modelRoot: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
  sourceCamera: THREE.Camera,
): Promise<ObjectNamingCapture | null> {
  const { bounds, positionsByObjectId } = collectObjectNamingPositions(
    modelRoot,
    hiddenObjectIds,
    loopCapStates,
  );

  if (bounds.isEmpty() || positionsByObjectId.size === 0) {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100);
  const canvas = document.createElement("canvas");

  scene.background = new THREE.Color(0xf2f2f0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);

  keyLight.position.copy(sourceCamera.position);
  scene.add(keyLight);

  const meshes = createCaptureMeshes(positionsByObjectId, scene);

  if (meshes.length === 0) {
    disposeObject(scene);
    return null;
  }

  fitCameraToPositions(camera, sourceCamera, positionsByObjectId, bounds);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setSize(autoNameCaptureSize, autoNameCaptureSize, false);
  renderer.render(scene, camera);

  const markers = getObjectNamingMarkers(camera, positionsByObjectId);
  const markerByLabel = new Map(markers.map((marker) => [marker.marker, marker]));
  const blob = await canvasToPngBlob(createMarkerCaptureCanvas(canvas, markers));

  renderer.dispose();

  return {
    blob,
    dispose: () => disposeObject(scene),
    getMarker: (marker: string) => markerByLabel.get(marker.trim().toUpperCase()) ?? null,
    markers,
    size: autoNameCaptureSize,
  };
}

export function toCamelCaseObjectName(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "object";
  }

  return words
    .map((word, index) => {
      const normalized = word.toLowerCase();

      if (index === 0) {
        return normalized;
      }

      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join("");
}

export function getUniqueAutoObjectName(baseName: string, usedNames: Set<string>) {
  const cleanBaseName = toCamelCaseObjectName(baseName);
  let candidate = cleanBaseName;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${cleanBaseName}${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function isAutoNameEligibleObjectLabel(label: string) {
  const trimmedLabel = label.trim();

  return trimmedLabel === "Default" || generatedObjectLabelPattern.test(trimmedLabel);
}
