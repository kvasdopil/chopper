import { useEffect } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ViewportGizmo } from "three-viewport-gizmo";

import {
  targetModelSize,
  defaultObjectId,
  minOrbitDistance,
  maxOrbitDistance,
  cameraNearPlane,
  clickMoveTolerance,
  looseEdgeHoverHitTolerancePx,
  looseEdgeHoverRenderOrder,
  capOffsetGizmoHitTolerancePx,
  capOffsetGizmoForceClosedHitTolerancePx,
  capOffsetGizmoMinLength,
  capOffsetGizmoColor,
  hoverEdgeColor,
  clearModel,
  getTriangleObjectIds,
  getTriangleObjectId,
  isSelectableMesh,
  isEditableHotkeyEvent,
  isDisposableDrawObject,
  getLooseEdgeLoop,
  isSameLooseEdgeLoop,
  setLooseEdgeLoopColor,
  getScreenPoint,
  getPointToSegmentDistance,
  clearHoverEdgeOverlay,
  setHoverEdgeOverlay,
  getLooseEdgeLoopDisplayColor,
  getLooseEdgeLoopCapAxisData,
  getLooseEdgeLoopCapAxisDataForEdges,
  isNormalTargetLoopMode,
  updateHoverEdgeResolution,
  type HoveredEdge,
  type CapOffsetDragState,
  type LooseEdgeSegment,
} from "./model-viewer-core";

import type { ModelViewerSceneParams } from "./model-viewer-scene-types";
import type { ViewerCamera } from "./model-viewer-scene-types";
import type { CameraMode } from "../viewer-controls/camera-mode-toggle";

type CapOffsetDragHit = Omit<CapOffsetDragState, "historySnapshot">;

export function useModelViewerScene(params: ModelViewerSceneParams) {
  const {
    mountRef,
    cameraRef,
    controlsRef,
    loaderRef,
    rootRef,
    capNormalTargetRef,
    capNormalTransformControlsRef,
    capNormalTransformHelperRef,
    capNormalTransformHistorySnapshotRef,
    capNormalTransformChangedRef,
    capOffsetDragRef,
    capOffsetGizmoHandleRef,
    capOffsetGizmoRef,
    selectedLooseEdgeLoopRef,
    selectedLooseEdgeLoopsRef,
    hoveredEdgeRef,
    linkedFaceSelectionRef,
    selectionBoundaryLoopsRef,
    hiddenObjectIdsRef,
    separateModeActiveRef,
    separationBusyRef,
    selectedObjectIdRef,
    isEdgeLoopCapToolEnabledRef,
    isSeparationToolEnabledRef,
    looseEdgeLoopCapStatesRef,
    cameraModeRef,
    persistenceSaveTimeoutRef,
    toastTimeoutRef,
    toggleCameraModeHandlerRef,
    setLooseEdgeLoopCapTargetHandlerRef,
    schedulePersistViewerStateHandlerRef,
    getLooseEdgeLoopCapStateHandlerRef,
    setLooseEdgeLoopCapOffsetHandlerRef,
    separateByBoundaryLoopHandlerRef,
    selectLooseEdgeLoopHandlerRef,
    clearSelectedLooseEdgeLoopHandlerRef,
    selectLinkedFaceHandlerRef,
    selectSeparatedObjectHandlerRef,
    clearLinkedFaceSelectionHandlerRef,
    undoLastViewerActionHandlerRef,
    showAllObjectsHandlerRef,
    hideSelectedObjectHandlerRef,
    restorePersistedViewerStateHandlerRef,
    createCurrentViewerHistorySnapshot,
    pushViewerHistorySnapshot,
    removeCapOffsetGizmo,
    rememberTriangleSelection,
    setCameraMode,
    setLoadState,
    setStatusText,
  } = params;

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f2f0);

    const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, cameraNearPlane, 1000);
    const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, cameraNearPlane, 1000);
    let activeCamera: ViewerCamera =
      cameraModeRef.current === "orthographic" ? orthographicCamera : perspectiveCamera;

    perspectiveCamera.position.set(4, 3, 6);
    orthographicCamera.position.copy(perspectiveCamera.position);
    orthographicCamera.quaternion.copy(perspectiveCamera.quaternion);
    cameraRef.current = activeCamera;

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

    const controls = new OrbitControls(activeCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = minOrbitDistance;
    controls.maxDistance = maxOrbitDistance;
    controls.minZoom = 0.01;
    controls.maxZoom = 1000;
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

    const capNormalTransformControls = new TransformControls(activeCamera, renderer.domElement);
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

    const viewportGizmo = new ViewportGizmo(activeCamera, renderer, {
      animated: true,
      container: mount,
      offset: {
        bottom: 16,
        left: 16,
      },
      placement: "bottom-left",
      size: 96,
      type: "cube",
    });

    viewportGizmo.attachControls(controls);

    const getPerspectiveDistanceForOrthographicZoom = () =>
      1 /
      Math.max(
        orthographicCamera.zoom * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2)),
        0.0001,
      );

    const getOrthographicZoomForPerspectiveDistance = () =>
      1 /
      Math.max(
        perspectiveCamera.position.distanceTo(controls.target) *
          Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2)),
        0.0001,
      );

    const syncInactiveCameraFromActiveCamera = () => {
      if (activeCamera === perspectiveCamera) {
        orthographicCamera.position.copy(perspectiveCamera.position);
        orthographicCamera.quaternion.copy(perspectiveCamera.quaternion);
        orthographicCamera.near = perspectiveCamera.near;
        orthographicCamera.far = perspectiveCamera.far;
        orthographicCamera.zoom = getOrthographicZoomForPerspectiveDistance();
        orthographicCamera.updateProjectionMatrix();
        return;
      }

      const direction = orthographicCamera.position.clone().sub(controls.target).normalize();
      const distance = getPerspectiveDistanceForOrthographicZoom();

      if (direction.lengthSq() === 0) {
        direction.copy(new THREE.Vector3(1, 1, 1).normalize());
      }

      perspectiveCamera.position.copy(controls.target).addScaledVector(direction, distance);
      perspectiveCamera.quaternion.copy(orthographicCamera.quaternion);
      perspectiveCamera.near = orthographicCamera.near;
      perspectiveCamera.far = orthographicCamera.far;
      perspectiveCamera.updateProjectionMatrix();
    };

    const setActiveCamera = (mode: CameraMode) => {
      const nextCamera = mode === "orthographic" ? orthographicCamera : perspectiveCamera;

      if (nextCamera === activeCamera) {
        return;
      }

      syncInactiveCameraFromActiveCamera();
      activeCamera = nextCamera;
      cameraModeRef.current = mode;
      cameraRef.current = activeCamera;
      controls.object = activeCamera;
      capNormalTransformControls.camera = activeCamera;
      viewportGizmo.camera = activeCamera;
      viewportGizmo.attachControls(controls);
      activeCamera.updateProjectionMatrix();
      controls.update();
      viewportGizmo.update(false);
      setCameraMode(mode);
    };

    toggleCameraModeHandlerRef.current = () => {
      setActiveCamera(cameraModeRef.current === "perspective" ? "orthographic" : "perspective");
    };

    const handleCapNormalTransformDragging = (event: { value: unknown }) => {
      const isDragging = event.value === true;

      controls.enabled = !isDragging;

      if (isDragging) {
        capNormalTransformHistorySnapshotRef.current = createCurrentViewerHistorySnapshot();
        capNormalTransformChangedRef.current = false;
        return;
      }

      if (capNormalTransformChangedRef.current) {
        handleCapNormalTransformChange();
        pushViewerHistorySnapshot(capNormalTransformHistorySnapshotRef.current);
        schedulePersistViewerStateHandlerRef.current?.();
      }

      capNormalTransformHistorySnapshotRef.current = null;
      capNormalTransformChangedRef.current = false;
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

      capNormalTransformChangedRef.current = true;
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
    const isLooseEdgeLoopSelected = (edge: HoveredEdge) =>
      selectedLooseEdgeLoopsRef.current.some((selectedLoop) =>
        isSameLooseEdgeLoop(selectedLoop, edge),
      );

    const clearHoveredEdge = () => {
      const currentEdge = hoveredEdgeRef.current;

      clearHoverEdgeOverlay(currentEdge);

      if (currentEdge?.isLooseEdge && !isLooseEdgeLoopSelected(currentEdge)) {
        const loop = getLooseEdgeLoop(currentEdge.mesh, currentEdge.loopId);

        if (loop) {
          setLooseEdgeLoopColor(
            currentEdge.mesh,
            currentEdge.loopId,
            getLooseEdgeLoopDisplayColor(
              currentEdge.mesh,
              loop,
              looseEdgeLoopCapStatesRef.current,
              rootRef.current,
            ),
          );
        }
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

      if (edge.isLooseEdge && separateModeActiveRef.current) {
        return;
      }

      if (edge.isLooseEdge) {
        if (isLooseEdgeLoopSelected(edge)) {
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
      raycaster.setFromCamera(pointer, activeCamera);

      return raycaster.intersectObjects(modelRoot.children, true).find((intersection) => {
        if (!isSelectableMesh(intersection.object) || intersection.faceIndex == null) {
          return false;
        }

        const objectIds = getTriangleObjectIds(intersection.object);
        const objectId = objectIds?.[intersection.faceIndex] ?? defaultObjectId;

        return !hiddenObjectIdsRef.current.has(objectId);
      });
    };

    const getLooseEdgeAtPointer = (event: PointerEvent): HoveredEdge | null => {
      if (!isEdgeLoopCapToolEnabledRef.current || separateModeActiveRef.current) {
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
          if (segment.loopId < 0 || hiddenObjectIdsRef.current.has(segment.objectId)) {
            return;
          }

          const start = getScreenPoint(
            segment.start.clone().applyMatrix4(child.matrixWorld),
            activeCamera,
            viewport,
          );
          const end = getScreenPoint(
            segment.end.clone().applyMatrix4(child.matrixWorld),
            activeCamera,
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

    const getSelectionBoundaryEdgeAtPointer = (event: PointerEvent): HoveredEdge | null => {
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
            activeCamera,
            viewport,
          );
          const endScreen = getScreenPoint(
            endWorld.copy(end).applyMatrix4(selection.mesh.matrixWorld),
            activeCamera,
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

      const dragState = getLooseEdgeLoopCapStateHandlerRef.current?.(drag.edge) ?? null;
      const offsetChanged =
        dragState != null && Math.abs(dragState.offset - drag.startOffset) >= 0.0001;

      capOffsetDragRef.current = null;
      controls.enabled = true;
      setCapOffsetGizmoHovered(false);

      if (offsetChanged) {
        pushViewerHistorySnapshot(drag.historySnapshot);
        schedulePersistViewerStateHandlerRef.current?.();
      }

      return true;
    };

    const isCapNormalTransformActive = () =>
      isEdgeLoopCapToolEnabledRef.current &&
      (capNormalTransformControls.dragging || capNormalTransformControls.axis !== null);

    const isCapNormalTransformDragging = () =>
      isEdgeLoopCapToolEnabledRef.current && capNormalTransformControls.dragging;

    const setCapOffsetGizmoHovered = (hovered: boolean) => {
      const arrow = capOffsetGizmoRef.current?.userData.arrowHelper as
        | THREE.ArrowHelper
        | undefined;

      arrow?.setColor(hovered ? hoverEdgeColor : capOffsetGizmoColor);
    };

    const getCapOffsetDragHitAtPointer = (event: PointerEvent): CapOffsetDragHit | null => {
      if (!isEdgeLoopCapToolEnabledRef.current) {
        return null;
      }

      const handle = capOffsetGizmoHandleRef.current;
      const gizmo = capOffsetGizmoRef.current;
      const edge = selectedLooseEdgeLoopRef.current;

      if (!handle || !gizmo || !edge || !handle.visible || !gizmo.visible) {
        return null;
      }

      const state = getLooseEdgeLoopCapStateHandlerRef.current?.(edge) ?? null;
      const axisTarget =
        state && isNormalTargetLoopMode(state.mode)
          ? (state.normalAxisTarget ?? state.normalTarget)
          : (state?.normalTarget ?? null);
      const axisData =
        state && state.groupLoopKeys && state.groupLoopKeys.length > 1
          ? getLooseEdgeLoopCapAxisDataForEdges(
              edge,
              selectedLooseEdgeLoopsRef.current,
              state.mode,
              axisTarget,
            )
          : state
            ? getLooseEdgeLoopCapAxisData(edge, state.mode, axisTarget)
            : null;

      if (!state || !axisData) {
        return null;
      }

      const rect = renderer.domElement.getBoundingClientRect();

      edge.mesh.updateMatrixWorld(true);
      gizmo.updateMatrixWorld(true);

      const targetOffset = axisData.axis.clone().multiplyScalar(state.offset);
      const arrowDirection =
        targetOffset.lengthSq() > 0 ? targetOffset.clone().normalize() : axisData.axis.clone();
      const loopSize = new THREE.Box3()
        .setFromPoints(axisData.data.points)
        .getSize(new THREE.Vector3());
      const loopSpan = Math.max(loopSize.x, loopSize.y, loopSize.z);
      const visualLength = Math.max(
        targetOffset.length(),
        loopSpan * 0.12,
        capOffsetGizmoMinLength,
      );
      const hitStartLocal =
        gizmo.userData.hitStartLocal instanceof THREE.Vector3
          ? (gizmo.userData.hitStartLocal as THREE.Vector3)
          : axisData.data.center;
      const hitEndLocal =
        gizmo.userData.hitEndLocal instanceof THREE.Vector3
          ? (gizmo.userData.hitEndLocal as THREE.Vector3)
          : axisData.data.center.clone().addScaledVector(arrowDirection, visualLength);
      const hitVisualLength =
        typeof gizmo.userData.hitVisualLength === "number"
          ? (gizmo.userData.hitVisualLength as number)
          : visualLength;
      const hitStartWorld = gizmo.localToWorld(hitStartLocal.clone());
      const hitEndWorld = gizmo.localToWorld(hitEndLocal.clone());
      const startScreen = getScreenPoint(hitStartWorld, activeCamera, rect);
      const endScreen = getScreenPoint(hitEndWorld, activeCamera, rect);

      if (!startScreen || !endScreen) {
        return null;
      }

      const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);
      const hitTolerance =
        axisData.data.forceClosed || loop?.isClosed === false
          ? capOffsetGizmoForceClosedHitTolerancePx
          : capOffsetGizmoHitTolerancePx;
      const hitDistance = getPointToSegmentDistance(
        event.clientX,
        event.clientY,
        startScreen.x,
        startScreen.y,
        endScreen.x,
        endScreen.y,
      );

      if (
        hitDistance > hitTolerance &&
        Math.hypot(event.clientX - endScreen.x, event.clientY - endScreen.y) > hitTolerance
      ) {
        return null;
      }

      const screenAxis = new THREE.Vector2(0, -1);
      let pixelsPerOffsetUnit = 80;

      screenAxis.set(endScreen.x - startScreen.x, endScreen.y - startScreen.y);
      pixelsPerOffsetUnit = screenAxis.length() / hitVisualLength;

      if (pixelsPerOffsetUnit >= 4) {
        screenAxis.normalize();
      } else {
        screenAxis.set(0, -1);
        pixelsPerOffsetUnit = 80;
      }

      return {
        edge,
        offsetDirection: state.offset < 0 ? -1 : 1,
        pixelsPerOffsetUnit,
        pointerId: event.pointerId,
        screenAxis,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset: state.offset,
      };
    };

    const getCapOffsetDragAtPointer = (event: PointerEvent): CapOffsetDragState | null => {
      const hit = getCapOffsetDragHitAtPointer(event);

      return hit ? { ...hit, historySnapshot: createCurrentViewerHistorySnapshot() } : null;
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
        drag.startOffset + (drag.offsetDirection * deltaPixels) / drag.pixelsPerOffsetUnit,
      );
      event.preventDefault();

      return true;
    };

    const startCapOffsetDrag = (event: PointerEvent, drag: CapOffsetDragState) => {
      capOffsetDragRef.current = drag;
      pointerStart = null;
      controls.enabled = false;
      setCapOffsetGizmoHovered(true);
      clearHoveredEdge();
      renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const handleCapOffsetPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0 || isCapNormalTransformDragging()) {
        return;
      }

      const capOffsetDrag = getCapOffsetDragAtPointer(event);

      if (!capOffsetDrag) {
        return;
      }

      startCapOffsetDrag(event, capOffsetDrag);
      event.stopImmediatePropagation();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      if (isCapNormalTransformDragging()) {
        pointerStart = null;
        clearHoveredEdge();
        return;
      }

      const capOffsetDrag = getCapOffsetDragAtPointer(event);

      if (capOffsetDrag) {
        startCapOffsetDrag(event, capOffsetDrag);
        return;
      }

      if (isCapNormalTransformActive()) {
        pointerStart = null;
        clearHoveredEdge();
        return;
      }

      let clickedEdge: HoveredEdge | null = null;

      const hoveredEdge = hoveredEdgeRef.current;

      clickedEdge = event.shiftKey
        ? hoveredEdge?.isLooseEdge === true && !separateModeActiveRef.current
          ? hoveredEdge
          : getLooseEdgeAtPointer(event)
        : hoveredEdge?.isSelectionBoundary === true ||
            (hoveredEdge?.isLooseEdge === true && !separateModeActiveRef.current)
          ? hoveredEdge
          : (getSelectionBoundaryEdgeAtPointer(event) ?? getLooseEdgeAtPointer(event));

      pointerStart = {
        edge: clickedEdge,
        x: event.clientX,
        y: event.clientY,
      };

      clearHoveredEdge();
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

      if (clickedEdge?.isLooseEdge) {
        selectLooseEdgeLoopHandlerRef.current?.(clickedEdge, true);
        return;
      }

      clearHoveredEdge();
      const triangle = getTriangleAtPointer(event);

      if (!triangle) {
        return;
      }

      const objectId = getTriangleObjectId(triangle.mesh, triangle.triangleIndex);

      rememberTriangleSelection(triangle.mesh, triangle.triangleIndex);
      selectSeparatedObjectHandlerRef.current?.(objectId, true);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (updateCapOffsetDrag(event)) {
        setCapOffsetGizmoHovered(true);
        return;
      }

      const capOffsetDragHit = getCapOffsetDragHitAtPointer(event);

      if (capOffsetDragHit) {
        setCapOffsetGizmoHovered(true);
        clearHoveredEdge();
        return;
      }

      setCapOffsetGizmoHovered(false);

      if (isCapNormalTransformActive()) {
        clearHoveredEdge();
        return;
      }

      const edge = event.shiftKey
        ? getLooseEdgeAtPointer(event)
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
      if (capOffsetDragRef.current) {
        return;
      }

      setCapOffsetGizmoHovered(false);

      if (isCapNormalTransformActive()) {
        return;
      }

      clearHoveredEdge();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      setCapOffsetGizmoHovered(false);
      finishCapOffsetDrag(event);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isEditableHotkeyEvent(event)) {
        return;
      }

      if (event.key === "Shift") {
        clearHoveredEdge();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableHotkeyEvent(event)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastViewerActionHandlerRef.current?.();
        return;
      }

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

    renderer.domElement.addEventListener("pointerdown", handleCapOffsetPointerDownCapture, {
      capture: true,
    });
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const handleResize = () => {
      const { clientWidth, clientHeight } = mount;

      renderer.setSize(clientWidth, clientHeight);
      perspectiveCamera.aspect = clientWidth / clientHeight;
      perspectiveCamera.updateProjectionMatrix();
      orthographicCamera.left = -clientWidth / clientHeight;
      orthographicCamera.right = clientWidth / clientHeight;
      orthographicCamera.top = 1;
      orthographicCamera.bottom = -1;
      orthographicCamera.updateProjectionMatrix();
      updateHoverEdgeResolution(modelRoot, clientWidth, clientHeight);
      controls.update();
      viewportGizmo.update(false);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    let animationFrame = 0;

    const render = () => {
      controls.update();
      syncInactiveCameraFromActiveCamera();
      renderer.render(scene, activeCamera);
      viewportGizmo.render();
      animationFrame = window.requestAnimationFrame(render);
    };

    render();

    let disposed = false;

    void restorePersistedViewerStateHandlerRef.current?.(
      modelRoot,
      activeCamera,
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
      renderer.domElement.removeEventListener("pointerdown", handleCapOffsetPointerDownCapture, {
        capture: true,
      });
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
      toggleCameraModeHandlerRef.current = null;
      viewportGizmo.dispose();
      clearModel(modelRoot);
      rootRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      loaderRef.current = null;
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The scene owns long-lived Three.js objects and reads mutable refs for current handlers/state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
