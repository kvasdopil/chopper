"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const targetModelSize = 4;
const defaultSmallTriangleArea = 0.01;
const defaultTriangleAreaRange = {
  min: 0,
  max: 0.08,
};
const faceColor = new THREE.Color(0x9a9a9a);
const smallTriangleColor = new THREE.Color(0xfacc15);
const selectionBorderColor = 0xfacc15;
const defaultViewDirection = new THREE.Vector3(1.8, 1.15, 2.3).normalize();
const minOrbitDistance = 0.02;
const maxOrbitDistance = 80;
const cameraNearPlane = 0.001;
const clickMoveTolerance = 4;
const flatNormalAngleThreshold = 1;
const flatNormalAngleColor = "#1d4ed8";
const maxColoredNormalAngle = 45;
const hiddenNormalAngleColor = "#4b5563";
const normalAnglePalette = [
  { angle: flatNormalAngleThreshold, color: "#38bdf8" },
  { angle: 12, color: "#22c55e" },
  { angle: 24, color: "#facc15" },
  { angle: 36, color: "#f97316" },
  { angle: maxColoredNormalAngle, color: "#ef4444" },
] as const;
const flatNormalAngleWidth = (flatNormalAngleThreshold / maxColoredNormalAngle) * 100;
const fullNormalAngleGradient = `linear-gradient(to right, ${flatNormalAngleColor} 0%, ${flatNormalAngleColor} ${flatNormalAngleWidth}%, ${normalAnglePalette[0].color} ${flatNormalAngleWidth}%, ${normalAnglePalette
  .map((stop) => `${stop.color} ${(stop.angle / maxColoredNormalAngle) * 100}%`)
  .join(", ")})`;
const defaultNormalAngleRange = {
  max: maxColoredNormalAngle,
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
type HighlightSelection =
  | {
      areaThreshold: number;
      type: "area";
    }
  | {
      mesh: THREE.Mesh;
      triangleStart: number;
      type: "triangle";
    }
  | {
      type: "none";
    };
type BufferAttributeArray = THREE.BufferAttribute["array"];
type BufferAttributeArrayConstructor = new (length: number) => BufferAttributeArray;
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

function getNormalAnglePaletteColor(angleDegrees: number) {
  if (angleDegrees < flatNormalAngleThreshold) {
    return new THREE.Color(flatNormalAngleColor);
  }

  for (let index = 1; index < normalAnglePalette.length; index += 1) {
    const previous = normalAnglePalette[index - 1];
    const next = normalAnglePalette[index];

    if (angleDegrees <= next.angle) {
      const localValue = (angleDegrees - previous.angle) / (next.angle - previous.angle);

      return new THREE.Color(previous.color).lerp(new THREE.Color(next.color), localValue);
    }
  }

  return new THREE.Color(normalAnglePalette[normalAnglePalette.length - 1].color);
}

function getVisibleNormalAngleColor(angleDegrees: number, range: NormalAngleRange) {
  if (
    angleDegrees < range.min ||
    angleDegrees > range.max ||
    angleDegrees > maxColoredNormalAngle
  ) {
    return new THREE.Color(hiddenNormalAngleColor);
  }

  return getNormalAnglePaletteColor(angleDegrees);
}

function getNormalAngleRangeGradient(range: NormalAngleRange) {
  const minPercent = (range.min / maxColoredNormalAngle) * 100;
  const maxPercent = (range.max / maxColoredNormalAngle) * 100;

  return `linear-gradient(to right, ${hiddenNormalAngleColor} 0%, ${hiddenNormalAngleColor} ${minPercent}%, transparent ${minPercent}%, transparent ${maxPercent}%, ${hiddenNormalAngleColor} ${maxPercent}%, ${hiddenNormalAngleColor} 100%), ${fullNormalAngleGradient}`;
}

function createAngleLineGeometry(sourceGeometry: THREE.BufferGeometry) {
  const position = sourceGeometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return new THREE.BufferGeometry();
  }

  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const pointC = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const edges = new Map<
    string,
    {
      normalAngles: THREE.Vector3[];
      vertexA: THREE.Vector3;
      vertexB: THREE.Vector3;
    }
  >();

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
      { index, point: pointA.clone(), vertexKey: getVertexKey(position, index) },
      {
        index: index + 1,
        point: pointB.clone(),
        vertexKey: getVertexKey(position, index + 1),
      },
      {
        index: index + 2,
        point: pointC.clone(),
        vertexKey: getVertexKey(position, index + 2),
      },
    ];

    [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ].forEach(([start, end]) => {
      const key = [start.vertexKey, end.vertexKey].sort().join("|");
      const existing = edges.get(key);

      if (existing) {
        existing.normalAngles.push(normal);
        return;
      }

      edges.set(key, {
        normalAngles: [normal],
        vertexA: start.point,
        vertexB: end.point,
      });
    });
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const angles: number[] = [];

  edges.forEach((edge) => {
    let angle = Math.PI / 2;

    if (edge.normalAngles.length > 1) {
      angle = 0;

      for (let index = 0; index < edge.normalAngles.length; index += 1) {
        for (let nextIndex = index + 1; nextIndex < edge.normalAngles.length; nextIndex += 1) {
          angle = Math.max(angle, edge.normalAngles[index].angleTo(edge.normalAngles[nextIndex]));
        }
      }
    }

    const angleDegrees = THREE.MathUtils.radToDeg(angle);
    const color = getNormalAnglePaletteColor(angleDegrees);

    positions.push(
      edge.vertexA.x,
      edge.vertexA.y,
      edge.vertexA.z,
      edge.vertexB.x,
      edge.vertexB.y,
      edge.vertexB.z,
    );
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    angles.push(angleDegrees, angleDegrees);
  });

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("normalAngle", new THREE.Float32BufferAttribute(angles, 1));

  return geometry;
}

function applyNormalAngleLineColors(model: THREE.Object3D, range: NormalAngleRange) {
  model.traverse((child) => {
    if (child.userData.isAngleLineOverlay !== true || !isDisposableDrawObject(child)) {
      return;
    }

    const angle = child.geometry.getAttribute("normalAngle");
    const color = child.geometry.getAttribute("color");

    if (!(angle instanceof THREE.BufferAttribute) || !(color instanceof THREE.BufferAttribute)) {
      return;
    }

    for (let index = 0; index < angle.count; index += 1) {
      const angleColor = getVisibleNormalAngleColor(angle.getX(index), range);

      color.setXYZ(index, angleColor.r, angleColor.g, angleColor.b);
    }

    color.needsUpdate = true;
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
    mesh.geometry = geometry;

    disposeMaterial(mesh.material);

    mesh.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      roughness: 0.82,
      side: THREE.DoubleSide,
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

    const selectionBorder = mesh.clone(false);
    selectionBorder.geometry = new THREE.BufferGeometry();
    selectionBorder.material = new THREE.MeshBasicMaterial({
      color: selectionBorderColor,
      depthTest: false,
      depthWrite: false,
      wireframe: true,
    });
    selectionBorder.name = "small-triangle-border-overlay";
    selectionBorder.renderOrder = 2;
    selectionBorder.userData.isSelectionBorderOverlay = true;
    mesh.userData.selectionBorderOverlay = selectionBorder;

    overlays.push({
      overlay: wireframe,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: angleLines,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: selectionBorder,
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

function copySelectedAttribute(attribute: THREE.BufferAttribute, triangleStarts: number[]) {
  const source = attribute.array;
  const TargetArray = source.constructor as BufferAttributeArrayConstructor;
  const target = new TargetArray(triangleStarts.length * 3 * attribute.itemSize);
  let targetOffset = 0;

  triangleStarts.forEach((startIndex) => {
    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
      const sourceOffset = (startIndex + vertexOffset) * attribute.itemSize;

      for (let component = 0; component < attribute.itemSize; component += 1) {
        target[targetOffset] = source[sourceOffset + component];
        targetOffset += 1;
      }
    }
  });

  return target;
}

function setSelectionBorderGeometry(
  mesh: THREE.Mesh,
  triangleStarts: number[],
  borderColor: THREE.Color,
) {
  const selectionBorder = mesh.userData.selectionBorderOverlay as THREE.Mesh | undefined;

  if (!selectionBorder) {
    return;
  }

  const geometry = new THREE.BufferGeometry();
  const attributeNames = ["position", "skinIndex", "skinWeight"];

  attributeNames.forEach((name) => {
    const attribute = mesh.geometry.getAttribute(name);

    if (!(attribute instanceof THREE.BufferAttribute)) {
      return;
    }

    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(
        copySelectedAttribute(attribute, triangleStarts),
        attribute.itemSize,
        attribute.normalized,
      ),
    );
  });

  selectionBorder.geometry.dispose();
  selectionBorder.geometry = geometry;
  selectionBorder.visible = triangleStarts.length > 0;

  if (selectionBorder.material instanceof THREE.MeshBasicMaterial) {
    selectionBorder.material.color.copy(borderColor);
  }
}

function applyTriangleHighlights(model: THREE.Object3D, selection: HighlightSelection) {
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
      child.userData.isSelectionBorderOverlay === true
    ) {
      return;
    }

    const position = child.geometry.getAttribute("position");
    const color = child.geometry.getAttribute("color");
    const selectedTriangleStarts: number[] = [];
    const highlightColor = smallTriangleColor;
    const wireframe = child.userData.wireframeOverlay as THREE.Mesh | undefined;
    const angleLines = child.userData.angleLineOverlay as THREE.LineSegments | undefined;

    if (wireframe) {
      wireframe.visible = selection.type !== "none";
    }

    if (angleLines) {
      angleLines.visible = selection.type === "none";
    }

    if (!(color instanceof THREE.BufferAttribute)) {
      return;
    }

    for (let index = 0; index < position.count; index += 3) {
      let isSelected = false;

      if (selection.type === "area") {
        pointA.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
        pointB.fromBufferAttribute(position, index + 1).applyMatrix4(child.matrixWorld);
        pointC.fromBufferAttribute(position, index + 2).applyMatrix4(child.matrixWorld);

        const triangleArea =
          edgeA.subVectors(pointB, pointA).cross(edgeB.subVectors(pointC, pointA)).length() * 0.5;

        isSelected = triangleArea < selection.areaThreshold;
      }

      if (selection.type === "triangle") {
        isSelected = child === selection.mesh && index === selection.triangleStart;
      }

      colorTriangle(color, index, isSelected ? highlightColor : faceColor);

      if (isSelected) {
        selectedTriangleStarts.push(index);
      }
    }

    color.needsUpdate = true;
    setSelectionBorderGeometry(child, selectedTriangleStarts, highlightColor);
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
      child.userData.isSelectionBorderOverlay === true
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
    object.userData.isSelectionBorderOverlay !== true
  );
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const highlightSelectionRef = useRef<HighlightSelection>({
    areaThreshold: defaultSmallTriangleArea,
    type: "area",
  });
  const [loadState, setLoadState] = useState<LoadState>("empty");
  const [statusText, setStatusText] = useState("No model loaded");
  const [smallTriangleArea, setSmallTriangleArea] = useState(defaultSmallTriangleArea);
  const [triangleAreaRange, setTriangleAreaRange] =
    useState<TriangleAreaRange>(defaultTriangleAreaRange);
  const [normalAngleRange, setNormalAngleRange] =
    useState<NormalAngleRange>(defaultNormalAngleRange);

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

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      pointerStart = {
        x: event.clientX,
        y: event.clientY,
      };
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

      const rect = renderer.domElement.getBoundingClientRect();

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);

      const hit = raycaster
        .intersectObjects(modelRoot.children, true)
        .find((intersection) => isSelectableMesh(intersection.object));

      if (!hit || hit.faceIndex == null || !isSelectableMesh(hit.object)) {
        highlightSelectionRef.current = { type: "none" };
        applyTriangleHighlights(modelRoot, highlightSelectionRef.current);
        return;
      }

      highlightSelectionRef.current = {
        mesh: hit.object,
        triangleStart: hit.faceIndex * 3,
        type: "triangle",
      };
      applyTriangleHighlights(modelRoot, highlightSelectionRef.current);
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

    const handleResize = () => {
      const { clientWidth, clientHeight } = mount;

      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
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
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
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

  useEffect(() => {
    const modelRoot = rootRef.current;

    if (!modelRoot) {
      return;
    }

    highlightSelectionRef.current = {
      areaThreshold: smallTriangleArea,
      type: "area",
    };
    applyTriangleHighlights(modelRoot, highlightSelectionRef.current);
  }, [smallTriangleArea]);

  useEffect(() => {
    const modelRoot = rootRef.current;

    if (!modelRoot) {
      return;
    }

    applyNormalAngleLineColors(modelRoot, normalAngleRange);
  }, [normalAngleRange]);

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
        applyNormalAngleLineColors(model, normalAngleRange);

        const areaRange = getTriangleAreaRange(model) ?? defaultTriangleAreaRange;
        const nextSmallTriangleArea = clampAreaThreshold(smallTriangleArea, areaRange);

        setTriangleAreaRange(areaRange);
        setSmallTriangleArea(nextSmallTriangleArea);
        highlightSelectionRef.current = {
          areaThreshold: nextSmallTriangleArea,
          type: "area",
        };
        applyTriangleHighlights(model, highlightSelectionRef.current);
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
          disabled={loadState === "loading"}
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

      <div className="pointer-events-none absolute bottom-4 left-4 w-64 max-w-[calc(100vw-2rem)] rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span>Normal angle</span>
          <span className="text-neutral-500 tabular-nums">
            {formatAngle(normalAngleRange.min)}-{formatAngle(normalAngleRange.max)} deg
          </span>
        </div>
        <div className="relative h-7">
          <div
            className="absolute top-2 right-0 left-0 h-3 rounded-sm"
            style={{ background: getNormalAngleRangeGradient(normalAngleRange) }}
          />
          <input
            type="range"
            min="0"
            max={maxColoredNormalAngle}
            step="0.5"
            value={normalAngleRange.min}
            aria-label="Minimum visible normal angle"
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
            min="0"
            max={maxColoredNormalAngle}
            step="0.5"
            value={normalAngleRange.max}
            aria-label="Maximum visible normal angle"
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
        <div className="mt-1 flex justify-between text-xs text-neutral-500">
          <span>&lt;1 flat</span>
          <span>45 deg</span>
          <span>outside dark</span>
        </div>
      </div>
    </main>
  );
}
