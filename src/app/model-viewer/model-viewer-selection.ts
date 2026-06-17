import * as THREE from "three";

import {
  cameraNearPlane,
  separationProgressCheckInterval,
  applyLinkedFaceSelectionColors,
  applyObjectColors,
  applySelectedObjectJoinPlan,
  applyViewerHistoryMeshStates,
  buildLinkedFaceSelection,
  buildLinkedFaceSelectionCache,
  buildSelectionBoundaryLoops,
  collectSelectableMeshes,
  collectSeparatedObjects,
  createLinkedFaceSelectionFromCache,
  createSelectedObjectJoinPlan,
  createSelectionBoundaryLoopOverlay,
  createThrottledProgressReporter,
  cutSelectionBoundaryLoopTopology,
  getDefaultSeparatedObjectLabel,
  getTriangleObjectId,
  getTriangleObjectIds,
  isSelectableMesh,
  refreshLooseEdgeOverlays,
  refreshObjectMaterialGroups,
  separateLooseObjectPartsAsync,
  updateHoverEdgeResolution,
  waitForBrowserPaint,
  type LinkedFaceSelectionDetails,
  type SelectionBoundaryLoop,
  type ViewerHistorySnapshot,
} from "./model-viewer-core";
import type { ModelViewerSelectionParams } from "./model-viewer-selection-types";

export function useModelViewerSelection(params: ModelViewerSelectionParams) {
  const {
    mountRef,
    cameraRef,
    controlsRef,
    rootRef,
    separationCameraAnimationFrameRef,
    separationCameraStateRef,
    linkedFaceSelectionRef,
    linkedFaceSelectionCacheRef,
    selectionBoundaryLoopsRef,
    selectionBoundaryLoopOverlayRef,
    linkedFaceSelectionThresholdRef,
    rememberedTriangleSelectionRef,
    selectedLooseEdgeLoopRef,
    hiddenObjectIdsRef,
    textureVisibleRef,
    objectNamesRef,
    historySnapshotsRef,
    nextSeparatedObjectIdRef,
    currentModelSourceRef,
    separationBusyRef,
    separateModeActiveRef,
    selectedObjectIdRef,
    selectedObjectIdsRef,
    isSeparationToolEnabledRef,
    textureAvailable,
    statusText,
    clearLooseEdgeLoopCapStates,
    clearLinkedFaceSelectionOverlay,
    clearObjectSelectionState,
    clearSelectedLooseEdgeLoop,
    clearSelectionBoundaryLoopOverlay,
    createCurrentViewerHistorySnapshot,
    pushViewerHistorySnapshot,
    refreshLooseEdgeLoopCapVisibility,
    refreshLooseEdgeLoopDisplayColors,
    refreshViewportObjectOutlines,
    restoreLooseEdgeLoopCapStates,
    schedulePersistViewerState,
    setCanUndo,
    setLinkedFaceSelection,
    setLinkedFaceSelectionGraph,
    setLooseEdgeLoopMode,
    setModelStatusText,
    setObjectSelectionState,
    setSeparateModeActiveState,
    setSeparatedObjects,
    setSeparationBusyState,
    setSeparationProgress,
    setSelectedLooseEdgeLoopActive,
    setTextureVisible,
    showToast,
    syncLooseEdgeLoopCapStates,
  } = params;

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

  const cancelSeparationCameraAnimation = () => {
    if (separationCameraAnimationFrameRef.current == null) {
      return;
    }

    window.cancelAnimationFrame(separationCameraAnimationFrameRef.current);
    separationCameraAnimationFrameRef.current = null;
  };

  const getCameraState = (
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    controls: { target: THREE.Vector3 },
  ) => ({
    far: camera.far,
    near: camera.near,
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: controls.target.clone(),
    zoom: camera.zoom,
  });

  const applyCameraState = (
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    controls: { target: THREE.Vector3; update: () => void },
    state: ReturnType<typeof getCameraState>,
  ) => {
    camera.position.copy(state.position);
    camera.quaternion.copy(state.quaternion);
    camera.near = state.near;
    camera.far = state.far;
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
    controls.target.copy(state.target);
    controls.update();
  };

  const animateCameraState = (
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    controls: { target: THREE.Vector3; update: () => void },
    nextState: ReturnType<typeof getCameraState>,
  ) => {
    const startState = getCameraState(camera, controls);
    const startTime = performance.now();
    const durationMs = 420;

    cancelSeparationCameraAnimation();

    const step = (now: number) => {
      const rawProgress = Math.min(Math.max((now - startTime) / durationMs, 0), 1);
      const progress = 1 - Math.pow(1 - rawProgress, 3);

      camera.position.lerpVectors(startState.position, nextState.position, progress);
      camera.quaternion.slerpQuaternions(startState.quaternion, nextState.quaternion, progress);
      camera.near = THREE.MathUtils.lerp(startState.near, nextState.near, progress);
      camera.far = THREE.MathUtils.lerp(startState.far, nextState.far, progress);
      camera.zoom = THREE.MathUtils.lerp(startState.zoom, nextState.zoom, progress);
      camera.updateProjectionMatrix();
      controls.target.lerpVectors(startState.target, nextState.target, progress);
      controls.update();

      if (rawProgress < 1) {
        separationCameraAnimationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        separationCameraAnimationFrameRef.current = null;
        applyCameraState(camera, controls, nextState);
      }
    };

    separationCameraAnimationFrameRef.current = window.requestAnimationFrame(step);
  };

  const getSeparatedObjectBounds = (modelRoot: THREE.Object3D, objectId: number) => {
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();

    modelRoot.updateMatrixWorld(true);
    collectSelectableMeshes(modelRoot).forEach((mesh) => {
      const position = mesh.geometry.getAttribute("position");
      const objectIds = getTriangleObjectIds(mesh);

      if (!(position instanceof THREE.BufferAttribute) || !objectIds) {
        return;
      }

      mesh.updateMatrixWorld(true);

      for (let index = 0; index + 2 < position.count; index += 3) {
        const triangleIndex = index / 3;

        if ((objectIds[triangleIndex] ?? 0) !== objectId) {
          continue;
        }

        for (let offset = 0; offset < 3; offset += 1) {
          bounds.expandByPoint(
            point.fromBufferAttribute(position, index + offset).applyMatrix4(mesh.matrixWorld),
          );
        }
      }
    });

    return bounds.isEmpty() ? null : bounds;
  };

  const getFramedCameraStateForBounds = (
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    controls: { target: THREE.Vector3 },
    bounds: THREE.Box3,
  ) => {
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(sphere.radius, 0.001);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const aspect =
      camera instanceof THREE.PerspectiveCamera
        ? camera.aspect
        : (camera.right - camera.left) / Math.max(camera.top - camera.bottom, 0.0001);
    const verticalFov =
      camera instanceof THREE.PerspectiveCamera
        ? THREE.MathUtils.degToRad(camera.fov)
        : Math.PI / 4;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const fitFov = Math.min(verticalFov, horizontalFov);
    const distance =
      camera instanceof THREE.PerspectiveCamera
        ? (radius / Math.sin(fitFov / 2)) * 1.08
        : Math.max(camera.position.distanceTo(controls.target), radius * 4);

    if (direction.lengthSq() === 0) {
      direction.set(1, 1, 1).normalize();
    }

    const nextState = getCameraState(camera, controls);

    nextState.target.copy(center);
    nextState.position.copy(center).addScaledVector(direction, distance);
    nextState.near = cameraNearPlane;
    nextState.far = Math.max(distance + radius * 24, distance * 12, 100);

    if (camera instanceof THREE.OrthographicCamera) {
      const width = camera.right - camera.left;
      const height = camera.top - camera.bottom;
      const diameter = radius * 2.16;

      nextState.zoom = Math.max(0.01, Math.min(width / diameter, height / diameter));
    }

    return nextState;
  };

  const focusCameraOnSelectedObjectForSeparation = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const modelRoot = rootRef.current;
    const selectedObjectId = selectedObjectIdRef.current;

    if (!camera || !controls || !modelRoot || selectedObjectId == null) {
      return;
    }

    const bounds = getSeparatedObjectBounds(modelRoot, selectedObjectId);

    if (!bounds) {
      return;
    }

    separationCameraStateRef.current = getCameraState(camera, controls);
    animateCameraState(camera, controls, getFramedCameraStateForBounds(camera, controls, bounds));
  };

  const restoreCameraAfterSeparation = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const previousState = separationCameraStateRef.current;

    separationCameraStateRef.current = null;

    if (!camera || !controls || !previousState) {
      cancelSeparationCameraAnimation();
      return;
    }

    animateCameraState(camera, controls, previousState);
  };

  const setSeparateModeInactive = () => {
    restoreCameraAfterSeparation();
    setSeparateModeActiveState(false);
  };

  const getSeparateModeFocusedObjectIds = () =>
    separateModeActiveRef.current && selectedObjectIdRef.current != null
      ? new Set([selectedObjectIdRef.current])
      : null;

  const refreshObjectMaterials = (modelRoot: THREE.Object3D) => {
    refreshObjectMaterialGroups(
      modelRoot,
      hiddenObjectIdsRef.current,
      getSeparateModeFocusedObjectIds(),
    );
  };

  const getLinkedFaceSelectionColorCache = (selection: LinkedFaceSelectionDetails) => {
    const cache = linkedFaceSelectionCacheRef.current;

    return cache &&
      cache.mesh === selection.mesh &&
      cache.objectId === selection.objectId &&
      cache.seedTriangleIndex === selection.seedTriangleIndex
      ? cache
      : null;
  };

  const refreshSelectionBoundaryLoops = (selection: LinkedFaceSelectionDetails) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !separateModeActiveRef.current) {
      selectionBoundaryLoopsRef.current = [];
      return;
    }

    const boundaryLoops = buildSelectionBoundaryLoops(selection);
    const boundaryOverlay = createSelectionBoundaryLoopOverlay(selection, boundaryLoops);

    selectionBoundaryLoopsRef.current = boundaryLoops;

    if (boundaryOverlay) {
      (selection.mesh.parent ?? modelRoot).add(boundaryOverlay);
      selectionBoundaryLoopOverlayRef.current = boundaryOverlay;
    }
  };

  const refreshLinkedFaceSelectionThresholdVisuals = (
    selection: LinkedFaceSelectionDetails | null,
  ) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !selection) {
      return;
    }

    clearSelectionBoundaryLoopOverlay();
    refreshSelectionBoundaryLoops(selection);
    updateHoverEdgeResolution(
      modelRoot,
      mountRef.current?.clientWidth ?? 1,
      mountRef.current?.clientHeight ?? 1,
    );
  };

  const applyLinkedFaceSelectionVisuals = (selection: LinkedFaceSelectionDetails | null) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !selection) {
      return;
    }

    refreshObjectMaterials(modelRoot);
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    applyLinkedFaceSelectionColors(selection, getLinkedFaceSelectionColorCache(selection));
    refreshViewportObjectOutlines(modelRoot);
    clearLinkedFaceSelectionOverlay();
    clearSelectionBoundaryLoopOverlay();
    refreshSelectionBoundaryLoops(selection);

    updateHoverEdgeResolution(
      modelRoot,
      mountRef.current?.clientWidth ?? 1,
      mountRef.current?.clientHeight ?? 1,
    );
  };

  const applyBoundaryCutSelectionVisuals = (selection: LinkedFaceSelectionDetails | null) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !selection) {
      return;
    }

    clearLinkedFaceSelectionOverlay();
    clearSelectionBoundaryLoopOverlay();
    refreshSelectionBoundaryLoops(selection);

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
      clearObjectSelectionState();
      setSeparateModeInactive();
      setSeparationProgress(null);
      refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
    }

    if (modelRoot && refreshVisuals) {
      refreshObjectMaterials(modelRoot);

      if (hadLinkedFaceSelection) {
        applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      }

      refreshViewportObjectOutlines(modelRoot);
      refreshLooseEdgeOverlays(
        modelRoot,
        hiddenObjectIdsRef.current,
        selectedObjectIdRef.current,
        false,
      );
      refreshLooseEdgeLoopDisplayColors(modelRoot);
    }
  };

  const restoreViewerHistorySnapshot = (snapshot: ViewerHistorySnapshot) => {
    const modelRoot = rootRef.current;

    if (!modelRoot) {
      return false;
    }

    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection(true, false);
    clearLooseEdgeLoopCapStates();
    rememberedTriangleSelectionRef.current = null;
    setSeparateModeInactive();
    setSeparationProgress(null);
    setLooseEdgeLoopMode("none");
    setSelectedLooseEdgeLoopActive(false);
    setLinkedFaceSelectionGraph(null);
    setLinkedFaceSelection({
      active: false,
      count: 0,
      threshold: linkedFaceSelectionThresholdRef.current,
    });

    const hadInvalidMeshState = applyViewerHistoryMeshStates(modelRoot, snapshot.meshes);

    hiddenObjectIdsRef.current = new Set(snapshot.hiddenObjectIds);
    objectNamesRef.current = { ...snapshot.objectNames };
    nextSeparatedObjectIdRef.current = snapshot.nextObjectId;
    clearObjectSelectionState();
    refreshObjectMaterials(modelRoot);
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    refreshViewportObjectOutlines(modelRoot);
    refreshLooseEdgeOverlays(
      modelRoot,
      hiddenObjectIdsRef.current,
      selectedObjectIdRef.current,
      true,
    );
    const hadInvalidCapState = restoreLooseEdgeLoopCapStates(modelRoot, snapshot.loopCapStates);

    refreshSeparatedObjects();
    schedulePersistViewerState();

    return hadInvalidMeshState || hadInvalidCapState;
  };

  const undoLastViewerAction = () => {
    if (separationBusyRef.current) {
      return;
    }

    const snapshot = historySnapshotsRef.current.pop();

    setCanUndo(historySnapshotsRef.current.length > 0);

    if (!snapshot) {
      return;
    }

    const hadInvalidState = restoreViewerHistorySnapshot(snapshot);

    setModelStatusText(currentModelSourceRef.current?.name ?? statusText);

    if (hadInvalidState) {
      showToast("Some history state could not be restored.");
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

    if (nextSeparateModeActive) {
      setSeparateModeActiveState(true);
      focusCameraOnSelectedObjectForSeparation();
    } else {
      setSeparateModeInactive();
    }
    setSeparationProgress(null);

    if (rootRef.current) {
      refreshObjectMaterials(rootRef.current);
    }

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
    refreshLinkedFaceSelectionThresholdVisuals(nextSelection);
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
      setObjectSelectionState(new Set([selection.objectId]), selection.objectId);
      refreshObjectMaterials(rootRef.current ?? selection.mesh);
      refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
      refreshLooseEdgeOverlays(
        rootRef.current ?? selection.mesh,
        hiddenObjectIdsRef.current,
        selection.objectId,
        false,
      );
      refreshLooseEdgeLoopDisplayColors(rootRef.current ?? selection.mesh);
      refreshViewportObjectOutlines(rootRef.current ?? selection.mesh);
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

  const setModelTextureVisibility = (visible: boolean) => {
    const modelRoot = rootRef.current;

    textureVisibleRef.current = visible;
    setTextureVisible(visible);

    if (!modelRoot) {
      return;
    }

    collectSelectableMeshes(modelRoot).forEach((mesh) => {
      mesh.userData.textureVisible = visible;
    });
    refreshObjectMaterials(modelRoot);
  };

  const toggleTextureVisibility = () => {
    if (!textureAvailable) {
      return;
    }

    setModelTextureVisibility(!textureVisibleRef.current);
  };

  const applyObjectVisibility = (nextHiddenObjectIds: Set<number>, recordHistory = true) => {
    const modelRoot = rootRef.current;
    const selection = linkedFaceSelectionRef.current;
    const currentSelectedObjectId = selectedObjectIdRef.current;
    const selectedLooseEdgeLoop = selectedLooseEdgeLoopRef.current;
    const visibilityChanged =
      nextHiddenObjectIds.size !== hiddenObjectIdsRef.current.size ||
      Array.from(nextHiddenObjectIds).some((objectId) => !hiddenObjectIdsRef.current.has(objectId));
    const nextSelectedObjectIds = new Set(
      Array.from(selectedObjectIdsRef.current).filter(
        (objectId) => !nextHiddenObjectIds.has(objectId),
      ),
    );

    if (recordHistory && visibilityChanged) {
      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
    }

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
      setObjectSelectionState(
        nextSelectedObjectIds,
        nextSelectedObjectIds.values().next().value ?? null,
      );
      setSeparateModeInactive();
      setSeparationProgress(null);
    } else if (nextSelectedObjectIds.size !== selectedObjectIdsRef.current.size) {
      setObjectSelectionState(nextSelectedObjectIds, currentSelectedObjectId);
    }

    refreshLooseEdgeLoopCapVisibility(nextHiddenObjectIds);

    if (modelRoot) {
      refreshObjectMaterialGroups(
        modelRoot,
        nextHiddenObjectIds,
        getSeparateModeFocusedObjectIds(),
      );
      refreshViewportObjectOutlines(modelRoot, nextHiddenObjectIds);
      refreshLooseEdgeOverlays(modelRoot, nextHiddenObjectIds, selectedObjectIdRef.current, false);
      refreshLooseEdgeLoopDisplayColors(modelRoot);
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
    const selectedObjectIds =
      selectedObjectIdsRef.current.size > 0
        ? Array.from(selectedObjectIdsRef.current)
        : linkedFaceSelectionRef.current?.objectId != null
          ? [linkedFaceSelectionRef.current.objectId]
          : [];

    if (selectedObjectIds.length === 0) {
      return;
    }

    const nextHiddenObjectIds = new Set(hiddenObjectIdsRef.current);

    selectedObjectIds.forEach((objectId) => {
      nextHiddenObjectIds.add(objectId);
    });
    applyObjectVisibility(nextHiddenObjectIds);
  };

  const showAllObjects = () => {
    if (hiddenObjectIdsRef.current.size === 0) {
      return;
    }

    applyObjectVisibility(new Set<number>());
  };

  const joinSelectedObjects = () => {
    const modelRoot = rootRef.current;

    if (!modelRoot || separationBusyRef.current || selectedObjectIdsRef.current.size < 2) {
      return;
    }

    const plan = createSelectedObjectJoinPlan(
      modelRoot,
      selectedObjectIdsRef.current,
      selectedObjectIdRef.current,
    );

    if (!plan) {
      showToast("Selected objects do not share an edge.");
      return;
    }

    const historySnapshot = createCurrentViewerHistorySnapshot();

    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection(false, false);

    if (!applySelectedObjectJoinPlan(modelRoot, plan)) {
      showToast("Selected objects could not be joined.");
      return;
    }

    pushViewerHistorySnapshot(historySnapshot);
    plan.objectIdToTargetId.forEach((_targetObjectId, sourceObjectId) => {
      hiddenObjectIdsRef.current.delete(sourceObjectId);
      delete objectNamesRef.current[sourceObjectId];
    });

    const nextSelectedObjectIds = new Set(plan.targetObjectIds);
    const currentObjectId = selectedObjectIdRef.current;
    const nextPrimaryObjectId =
      currentObjectId != null && nextSelectedObjectIds.has(currentObjectId)
        ? currentObjectId
        : (nextSelectedObjectIds.values().next().value ?? null);

    rememberedTriangleSelectionRef.current = null;
    setObjectSelectionState(nextSelectedObjectIds, nextPrimaryObjectId);
    refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
    refreshObjectMaterials(modelRoot);
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    refreshViewportObjectOutlines(modelRoot);
    refreshLooseEdgeOverlays(
      modelRoot,
      hiddenObjectIdsRef.current,
      selectedObjectIdRef.current,
      true,
    );
    syncLooseEdgeLoopCapStates(modelRoot);
    refreshSeparatedObjects();
    refreshLooseEdgeLoopDisplayColors(modelRoot);
    setModelStatusText(
      `Joined ${plan.objectIdToTargetId.size + plan.targetObjectIds.size} objects`,
    );
    schedulePersistViewerState();
  };

  const selectSeparatedObject = (objectId: number, additive = false) => {
    if (separationBusyRef.current) {
      return;
    }

    const currentObjectId = selectedObjectIdRef.current;
    const currentObjectIds = selectedObjectIdsRef.current;
    const hasLinkedFaceSelection = linkedFaceSelectionRef.current != null;

    if (
      !additive &&
      currentObjectId === objectId &&
      currentObjectIds.size === 1 &&
      currentObjectIds.has(objectId) &&
      !hasLinkedFaceSelection
    ) {
      return;
    }

    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection(false, false);
    setSeparationProgress(null);
    const nextObjectIds = additive ? new Set(currentObjectIds) : new Set<number>();

    nextObjectIds.add(objectId);
    setObjectSelectionState(nextObjectIds, objectId);
    refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);

    const modelRoot = rootRef.current;

    if (modelRoot) {
      if (separateModeActiveRef.current) {
        refreshObjectMaterials(modelRoot);
      }

      if (hasLinkedFaceSelection) {
        applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      }

      refreshViewportObjectOutlines(modelRoot);
      refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, objectId, false);
      refreshLooseEdgeLoopDisplayColors(modelRoot);
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

    if ((objectNamesRef.current[objectId] ?? "") === (nextObjectNames[objectId] ?? "")) {
      return;
    }

    pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
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

      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
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
      refreshObjectMaterials(modelRoot);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshViewportObjectOutlines(modelRoot);
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

      const seedMesh = selection.mesh;
      const seedTriangleIndex = selection.seedTriangleIndex;
      const historySnapshot = createCurrentViewerHistorySnapshot();

      if (!cutSelectionBoundaryLoopTopology(selection, boundaryLoop)) {
        return;
      }

      pushViewerHistorySnapshot(historySnapshot);

      await separateLooseObjectPartsAsync(
        selection.topology,
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

      refreshObjectMaterials(modelRoot);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshSeparatedObjects();

      const nextSelectionCache = buildLinkedFaceSelectionCache(
        seedMesh,
        seedTriangleIndex,
        selection.topology,
      );

      if (nextSelectionCache) {
        const nextSelection = createLinkedFaceSelectionFromCache(
          nextSelectionCache,
          linkedFaceSelectionThresholdRef.current,
        );

        rememberTriangleSelection(seedMesh, seedTriangleIndex);
        linkedFaceSelectionRef.current = nextSelection;
        linkedFaceSelectionCacheRef.current = nextSelectionCache;
        setObjectSelectionState(new Set([nextSelection.objectId]), nextSelection.objectId);
        refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
        setLinkedFaceSelectionGraph(nextSelectionCache);
        setLinkedFaceSelection({
          active: true,
          count: nextSelection.selectedTriangleIndexes.size,
          threshold: linkedFaceSelectionThresholdRef.current,
        });
        applyLinkedFaceSelectionColors(nextSelection, nextSelectionCache);
        refreshViewportObjectOutlines(modelRoot);
        applyBoundaryCutSelectionVisuals(nextSelection);
        refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, nextSelection.objectId);
        syncLooseEdgeLoopCapStates(modelRoot);
      } else {
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
        refreshViewportObjectOutlines(modelRoot);
        refreshLooseEdgeOverlays(
          modelRoot,
          hiddenObjectIdsRef.current,
          selectedObjectIdRef.current,
        );
        syncLooseEdgeLoopCapStates(modelRoot);
      }

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

  return {
    clearLinkedFaceSelection,
    commitLinkedFaceSelectionThreshold,
    handleSeparateSelection,
    hideSelectedObject,
    joinSelectedObjects,
    rememberTriangleSelection,
    renameSeparatedObject,
    selectLinkedFace,
    selectSeparatedObject,
    separateByBoundaryLoop,
    showAllObjects,
    toggleObjectVisibility,
    toggleSeparateMode,
    toggleTextureVisibility,
    undoLastViewerAction,
  };
}
