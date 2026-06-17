import * as THREE from "three";

import {
  separationProgressCheckInterval,
  applyLinkedFaceSelectionColors,
  applyObjectColors,
  applySelectedObjectJoinPlan,
  applyViewerHistoryMeshStates,
  buildLinkedFaceSelection,
  buildLinkedFaceSelectionCache,
  buildMeshTopology,
  buildSelectionBoundaryLoops,
  collectSelectableMeshes,
  collectSeparatedObjects,
  createLinkedFaceSelectionFromCache,
  createLinkedFaceSelectionOverlay,
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
  refreshObjectWireframes,
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
    rootRef,
    linkedFaceSelectionRef,
    linkedFaceSelectionCacheRef,
    linkedFaceSelectionOverlayRef,
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

  const applyLinkedFaceSelectionVisuals = (selection: LinkedFaceSelectionDetails | null) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !selection) {
      return;
    }

    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    applyLinkedFaceSelectionColors(selection);
    refreshViewportObjectOutlines(modelRoot);
    clearLinkedFaceSelectionOverlay();
    clearSelectionBoundaryLoopOverlay();

    const overlay = createLinkedFaceSelectionOverlay(selection);

    if (overlay) {
      modelRoot.add(overlay);
      linkedFaceSelectionOverlayRef.current = overlay;
    }

    if (separateModeActiveRef.current) {
      const boundaryLoops = buildSelectionBoundaryLoops(selection);
      const boundaryOverlay = createSelectionBoundaryLoopOverlay(selection, boundaryLoops);

      selectionBoundaryLoopsRef.current = boundaryLoops;

      if (boundaryOverlay) {
        (selection.mesh.parent ?? modelRoot).add(boundaryOverlay);
        selectionBoundaryLoopOverlayRef.current = boundaryOverlay;
      }
    }

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

    if (separateModeActiveRef.current) {
      const boundaryLoops = buildSelectionBoundaryLoops(selection);
      const boundaryOverlay = createSelectionBoundaryLoopOverlay(selection, boundaryLoops);

      selectionBoundaryLoopsRef.current = boundaryLoops;

      if (boundaryOverlay) {
        (selection.mesh.parent ?? modelRoot).add(boundaryOverlay);
        selectionBoundaryLoopOverlayRef.current = boundaryOverlay;
      }
    }

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
      setSeparateModeActiveState(false);
      setSeparationProgress(null);
      refreshLooseEdgeLoopCapVisibility(hiddenObjectIdsRef.current);
    }

    if (modelRoot && refreshVisuals) {
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current, separateModeActiveRef.current);

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
    setSeparateModeActiveState(false);
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
    refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current, separateModeActiveRef.current);
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

    setSeparateModeActiveState(nextSeparateModeActive);
    setSeparationProgress(null);

    if (rootRef.current) {
      refreshObjectWireframes(rootRef.current, hiddenObjectIdsRef.current, nextSeparateModeActive);
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
    applyLinkedFaceSelectionVisuals(nextSelection);
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
    refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
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
      setSeparateModeActiveState(false);
      setSeparationProgress(null);
    } else if (nextSelectedObjectIds.size !== selectedObjectIdsRef.current.size) {
      setObjectSelectionState(nextSelectedObjectIds, currentSelectedObjectId);
    }

    refreshLooseEdgeLoopCapVisibility(nextHiddenObjectIds);

    if (modelRoot) {
      refreshObjectMaterialGroups(modelRoot, nextHiddenObjectIds);
      refreshObjectWireframes(modelRoot, nextHiddenObjectIds, separateModeActiveRef.current);
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
    refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current, separateModeActiveRef.current);
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
      refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current, separateModeActiveRef.current);
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
      const topology = buildMeshTopology(selection.mesh);

      if (!topology) {
        return;
      }

      await separateLooseObjectPartsAsync(
        topology,
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

      refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
      applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
      refreshObjectWireframes(modelRoot, hiddenObjectIdsRef.current, separateModeActiveRef.current);
      refreshViewportObjectOutlines(modelRoot);
      refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, selectedObjectIdRef.current);
      syncLooseEdgeLoopCapStates(modelRoot);
      refreshSeparatedObjects();

      const nextSelectionCache = buildLinkedFaceSelectionCache(seedMesh, seedTriangleIndex);

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
        refreshViewportObjectOutlines(modelRoot);
        applyBoundaryCutSelectionVisuals(nextSelection);
        refreshLooseEdgeOverlays(modelRoot, hiddenObjectIdsRef.current, nextSelection.objectId);
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
