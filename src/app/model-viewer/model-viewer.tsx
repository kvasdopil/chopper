"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useModelViewerScene } from "./model-viewer-scene";
import type { ViewerCamera } from "./model-viewer-scene-types";
import type { SeparationCameraState } from "./model-viewer-selection-types";
import { useModelViewerLoopCaps } from "./model-viewer-loop-caps";
import { useModelViewerSelection } from "./model-viewer-selection";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  selectedLooseEdgeLoopColor,
  defaultLinkedFaceSelectionAngle,
  maxLinkedFaceSelectionAngle,
  linkedFaceSelectionGraphWidth,
  linkedFaceSelectionGraphHeight,
  persistenceSaveDelayMs,
  toastDurationMs,
  cloneArrayBuffer,
  disposeObject,
  clearModel,
  collectSeparatedObjects,
  modelHasSourceTextureMaps,
  refreshObjectMaterialGroups,
  styleModel,
  refreshObjectOutlines,
  refreshLooseEdgeOverlays,
  setLooseEdgeLoopColor,
  getCappedLooseEdgePositionEdgeKeys,
  getLooseEdgeLoopDisplayColor,
  updateHoverEdgeResolution,
  applyObjectColors,
  normalizeModel,
  frameModel,
  isSelectableMesh,
  getMaxObjectId,
  createPersistedViewerState,
  createViewerHistorySnapshot,
  applyPersistedMeshStates,
  getRestoredObjectNames,
  getBlenderExportFileName,
  getThreeMfExportFileName,
  createBlenderExportScene,
  downloadArrayBuffer,
  type HoveredEdge,
  type LooseEdgeLoop,
  type LooseEdgeLoopCapState,
  type ViewerHistorySnapshot,
  type ViewerHistorySnapshotOptions,
  type CapOffsetDragState,
  type LinkedFaceSelectionDetails,
  type SelectionBoundaryLoop,
  type LinkedFaceSelectionCache,
  type RememberedTriangleSelection,
  type ObjectNameMap,
  type ToastMessage,
} from "./model-viewer-core";
import {
  clearPersistedViewerState,
  readPersistedViewerState,
  savePersistedViewerState,
  type PersistedModelSource,
  type PersistedViewerState,
} from "./persistence";
import {
  applyEditorGlbMeshStates,
  getEditorGlbMetadata,
  removeEditorGeneratedLoopMeshes,
} from "./editor-metadata";
import {
  createObjectNamingCapture,
  getUniqueAutoObjectName,
  isAutoNameEligibleObjectLabel,
  type AutoNamedImageObject,
} from "./auto-object-naming";
import { createThreeMfPackage } from "./three-mf";
import { EdgeLoopCapToolPanel } from "./tools/edge-loop-cap-tool";
import { SeparationToolPanel } from "./tools/separation-tool";
import type { ViewerTool, ViewerToolId } from "./tools";
import { AutoNameDebugView } from "../viewer-controls/auto-name-debug-view";
import { ObjectsPanel } from "../viewer-controls/objects-panel";
import { TopBar } from "../viewer-controls/top-bar";
import { CameraModeToggle, type CameraMode } from "../viewer-controls/camera-mode-toggle";
import { TextureToggle } from "../viewer-controls/texture-toggle";
import type {
  LinkedFaceSelectionGraph,
  LinkedFaceSelectionState,
  LoadState,
  LooseEdgeLoopMode,
  SeparatedObjectSummary,
} from "../viewer-controls/types";

type ModelViewerProps = {
  tools: ViewerTool[];
};

type AutoNameDebugState = {
  imageSize: number;
  imageUrl: string;
  markers: Array<AutoNamedImageObject & { x: number; y: number }>;
};

export function ModelViewer({ tools }: ModelViewerProps) {
  const enabledToolIds = new Set<ViewerToolId>(tools.map((tool) => tool.id));
  const isSeparationToolEnabled = enabledToolIds.has("separation");
  const isEdgeLoopCapToolEnabled = enabledToolIds.has("edge-loop-cap");
  const mountRef = useRef<HTMLDivElement | null>(null);
  const isSeparationToolEnabledRef = useRef(isSeparationToolEnabled);
  const isEdgeLoopCapToolEnabledRef = useRef(isEdgeLoopCapToolEnabled);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const linkedFaceSelectionRef = useRef<LinkedFaceSelectionDetails | null>(null);
  const linkedFaceSelectionCacheRef = useRef<LinkedFaceSelectionCache | null>(null);
  const linkedFaceSelectionOverlayRef = useRef<LineSegments2 | null>(null);
  const selectionBoundaryLoopsRef = useRef<SelectionBoundaryLoop[]>([]);
  const selectionBoundaryLoopOverlayRef = useRef<LineSegments2 | null>(null);
  const linkedFaceSelectionThresholdRef = useRef(defaultLinkedFaceSelectionAngle);
  const looseEdgeLoopCapStatesRef = useRef<Map<string, LooseEdgeLoopCapState>>(new Map());
  const capOffsetDragRef = useRef<CapOffsetDragState | null>(null);
  const capOffsetGizmoHandleRef = useRef<THREE.Object3D | null>(null);
  const capOffsetGizmoRef = useRef<THREE.Group | null>(null);
  const capNormalTargetRef = useRef<THREE.Object3D | null>(null);
  const capNormalTransformControlsRef = useRef<TransformControls | null>(null);
  const capNormalTransformHelperRef = useRef<THREE.Object3D | null>(null);
  const rememberedTriangleSelectionRef = useRef<RememberedTriangleSelection | null>(null);
  const selectedLooseEdgeLoopRef = useRef<HoveredEdge | null>(null);
  const selectedLooseEdgeLoopOverlayRef = useRef<LineSegments2 | null>(null);
  const currentModelSourceRef = useRef<PersistedModelSource | null>(null);
  const autoNameAbortControllerRef = useRef<AbortController | null>(null);
  const autoNameDebugImageUrlRef = useRef<string | null>(null);
  const persistenceSaveTimeoutRef = useRef<number | null>(null);
  const persistenceSaveFailedRef = useRef(false);
  const isRestoringPersistedStateRef = useRef(false);
  const modelLoadVersionRef = useRef(0);
  const historySnapshotsRef = useRef<ViewerHistorySnapshot[]>([]);
  const capNormalTransformHistorySnapshotRef = useRef<ViewerHistorySnapshot | null>(null);
  const capNormalTransformChangedRef = useRef(false);
  const nextSeparatedObjectIdRef = useRef(1);
  const hiddenObjectIdsRef = useRef<Set<number>>(new Set());
  const textureVisibleRef = useRef(false);
  const objectNamesRef = useRef<ObjectNameMap>({});
  const toastTimeoutRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  const separationBusyRef = useRef(false);
  const separateModeActiveRef = useRef(false);
  const selectedObjectIdRef = useRef<number | null>(null);
  const selectedObjectIdsRef = useRef<Set<number>>(new Set());
  const clearLinkedFaceSelectionHandlerRef = useRef<
    ((clearObjectSelection?: boolean, refreshVisuals?: boolean) => void) | null
  >(null);
  const clearSelectedLooseEdgeLoopHandlerRef = useRef<(() => void) | null>(null);
  const hideSelectedObjectHandlerRef = useRef<(() => void) | null>(null);
  const selectLooseEdgeLoopHandlerRef = useRef<((edge: HoveredEdge) => void) | null>(null);
  const selectSeparatedObjectHandlerRef = useRef<
    ((objectId: number, additive?: boolean) => void) | null
  >(null);
  const separateByBoundaryLoopHandlerRef = useRef<((loopId: number) => void) | null>(null);
  const schedulePersistViewerStateHandlerRef = useRef<(() => void) | null>(null);
  const getLooseEdgeLoopCapStateHandlerRef = useRef<
    ((edge: HoveredEdge) => LooseEdgeLoopCapState | null) | null
  >(null);
  const setLooseEdgeLoopCapOffsetHandlerRef = useRef<
    ((edge: HoveredEdge, offset: number) => void) | null
  >(null);
  const setLooseEdgeLoopCapTargetHandlerRef = useRef<
    ((edge: HoveredEdge, target: THREE.Vector3) => void) | null
  >(null);
  const showAllObjectsHandlerRef = useRef<(() => void) | null>(null);
  const undoLastViewerActionHandlerRef = useRef<(() => void) | null>(null);
  const syncLooseEdgeLoopCapStatesHandlerRef = useRef<
    ((modelRoot?: THREE.Object3D | null) => void) | null
  >(null);
  const restorePersistedViewerStateHandlerRef = useRef<
    | ((
        modelRoot: THREE.Group,
        camera: ViewerCamera,
        controls: OrbitControls,
        loader: GLTFLoader,
        isCancelled: () => boolean,
      ) => Promise<void>)
    | null
  >(null);
  const selectLinkedFaceHandlerRef = useRef<
    ((mesh: THREE.Mesh, triangleIndex: number) => void) | null
  >(null);
  const cameraRef = useRef<ViewerCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const separationCameraAnimationFrameRef = useRef<number | null>(null);
  const separationCameraStateRef = useRef<SeparationCameraState | null>(null);
  const hoveredEdgeRef = useRef<HoveredEdge | null>(null);
  const cameraModeRef = useRef<CameraMode>("perspective");
  const toggleCameraModeHandlerRef = useRef<(() => void) | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("perspective");
  const [autoNameBusy, setAutoNameBusy] = useState(false);
  const [autoNameDebug, setAutoNameDebug] = useState<AutoNameDebugState | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportThreeMfBusy, setExportThreeMfBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("empty");
  const [statusText, setStatusText] = useState("No model loaded");
  const [linkedFaceSelection, setLinkedFaceSelection] = useState<LinkedFaceSelectionState>({
    active: false,
    count: 0,
    threshold: defaultLinkedFaceSelectionAngle,
  });
  const [linkedFaceSelectionGraph, setLinkedFaceSelectionGraph] =
    useState<LinkedFaceSelectionGraph | null>(null);
  const [looseEdgeLoopCone, setLooseEdgeLoopCone] = useState(false);
  const [looseEdgeLoopMode, setLooseEdgeLoopMode] = useState<LooseEdgeLoopMode>("none");
  const [separateModeActive, setSeparateModeActive] = useState(false);
  const [separationBusy, setSeparationBusy] = useState(false);
  const [separationProgress, setSeparationProgress] = useState<string | null>(null);
  const [separatedObjects, setSeparatedObjects] = useState<SeparatedObjectSummary[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<number>>(new Set());
  const [selectedLooseEdgeLoopActive, setSelectedLooseEdgeLoopActive] = useState(false);
  const [textureAvailable, setTextureAvailable] = useState(false);
  const [textureVisible, setTextureVisible] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const setCameraModeState = (mode: CameraMode) => {
    cameraModeRef.current = mode;
    setCameraMode(mode);
  };

  const showToast = (text: string) => {
    if (toastTimeoutRef.current != null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    const id = toastIdRef.current + 1;

    toastIdRef.current = id;
    setToast({ id, text });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
      toastTimeoutRef.current = null;
    }, toastDurationMs);
  };

  const clearAutoNameDebugView = () => {
    if (autoNameDebugImageUrlRef.current) {
      URL.revokeObjectURL(autoNameDebugImageUrlRef.current);
    }

    autoNameDebugImageUrlRef.current = null;
    setAutoNameDebug(null);
  };

  const showAutoNameDebugView = (
    blob: Blob,
    markers: Array<AutoNamedImageObject & { x: number; y: number }>,
    imageSize: number,
  ) => {
    const imageUrl = URL.createObjectURL(blob);

    if (autoNameDebugImageUrlRef.current) {
      URL.revokeObjectURL(autoNameDebugImageUrlRef.current);
    }

    autoNameDebugImageUrlRef.current = imageUrl;
    setAutoNameDebug({ imageSize, imageUrl, markers });
  };

  useEffect(() => {
    return () => {
      autoNameAbortControllerRef.current?.abort();

      if (autoNameDebugImageUrlRef.current) {
        URL.revokeObjectURL(autoNameDebugImageUrlRef.current);
      }
    };
  }, []);

  const setObjectSelectionState = (objectIds: Set<number>, primaryObjectId: number | null) => {
    const nextObjectIds = new Set(objectIds);

    selectedObjectIdsRef.current = nextObjectIds;
    selectedObjectIdRef.current = primaryObjectId;
    setSelectedObjectIds(nextObjectIds);
    setSelectedObjectId(primaryObjectId);
  };

  const clearObjectSelectionState = () => {
    setObjectSelectionState(new Set<number>(), null);
  };

  const getFocusedObjectIds = () => {
    const focusedObjectIds = new Set(selectedObjectIdsRef.current);
    const selectedLoop = selectedLooseEdgeLoopRef.current;

    if (selectedLoop && !hiddenObjectIdsRef.current.has(selectedLoop.objectId)) {
      focusedObjectIds.add(selectedLoop.objectId);
    }

    return focusedObjectIds;
  };

  const refreshViewportObjectOutlines = (
    modelRoot: THREE.Object3D | null = rootRef.current,
    hiddenObjectIds = hiddenObjectIdsRef.current,
  ) => {
    if (!modelRoot) {
      return;
    }

    refreshObjectOutlines(
      modelRoot,
      hiddenObjectIds,
      selectedObjectIdsRef.current,
      getFocusedObjectIds(),
    );
  };

  const refreshLooseEdgeLoopDisplayColors = (
    modelRoot: THREE.Object3D | null = rootRef.current,
  ) => {
    if (!modelRoot) {
      return;
    }

    const cappedPositionEdgeKeys = getCappedLooseEdgePositionEdgeKeys(
      modelRoot,
      looseEdgeLoopCapStatesRef.current,
    );

    modelRoot.traverse((child) => {
      if (!isSelectableMesh(child)) {
        return;
      }

      const loopsById = child.userData.looseEdgeLoopById;

      if (!(loopsById instanceof Map)) {
        return;
      }

      loopsById.forEach((loop) => {
        const typedLoop = loop as LooseEdgeLoop;

        setLooseEdgeLoopColor(
          child,
          typedLoop.id,
          getLooseEdgeLoopDisplayColor(
            child,
            typedLoop,
            looseEdgeLoopCapStatesRef.current,
            modelRoot,
            cappedPositionEdgeKeys,
          ),
        );
      });
    });

    const selectedLoop = selectedLooseEdgeLoopRef.current;

    if (selectedLoop) {
      setLooseEdgeLoopColor(selectedLoop.mesh, selectedLoop.loopId, selectedLooseEdgeLoopColor);
    }
  };

  const persistViewerStateNow = async () => {
    const modelRoot = rootRef.current;
    const source = currentModelSourceRef.current;

    if (isRestoringPersistedStateRef.current || !modelRoot || !source) {
      return;
    }

    try {
      await savePersistedViewerState(
        createPersistedViewerState(
          modelRoot,
          source,
          hiddenObjectIdsRef.current,
          objectNamesRef.current,
          nextSeparatedObjectIdRef.current,
          looseEdgeLoopCapStatesRef.current,
        ),
      );
      persistenceSaveFailedRef.current = false;
    } catch {
      if (!persistenceSaveFailedRef.current) {
        showToast("Could not save this model. Changes may not survive refresh.");
      }

      persistenceSaveFailedRef.current = true;
    }
  };

  const schedulePersistViewerState = () => {
    if (isRestoringPersistedStateRef.current || !currentModelSourceRef.current) {
      return;
    }

    if (persistenceSaveTimeoutRef.current != null) {
      window.clearTimeout(persistenceSaveTimeoutRef.current);
    }

    persistenceSaveTimeoutRef.current = window.setTimeout(() => {
      persistenceSaveTimeoutRef.current = null;
      void persistViewerStateNow();
    }, persistenceSaveDelayMs);
  };

  const createCurrentViewerHistorySnapshot = (options?: ViewerHistorySnapshotOptions) => {
    const modelRoot = rootRef.current;

    if (!modelRoot || !currentModelSourceRef.current) {
      return null;
    }

    return createViewerHistorySnapshot(
      modelRoot,
      hiddenObjectIdsRef.current,
      objectNamesRef.current,
      nextSeparatedObjectIdRef.current,
      looseEdgeLoopCapStatesRef.current,
      options,
    );
  };

  const pushViewerHistorySnapshot = (snapshot: ViewerHistorySnapshot | null) => {
    if (!snapshot) {
      return;
    }

    historySnapshotsRef.current.push(snapshot);
    setCanUndo(true);
  };

  const clearViewerHistory = () => {
    historySnapshotsRef.current = [];
    capNormalTransformHistorySnapshotRef.current = null;
    capNormalTransformChangedRef.current = false;
    setCanUndo(false);
  };

  const clearScheduledPersistenceSave = () => {
    if (persistenceSaveTimeoutRef.current == null) {
      return;
    }

    window.clearTimeout(persistenceSaveTimeoutRef.current);
    persistenceSaveTimeoutRef.current = null;
  };

  const setSeparateModeActiveState = (active: boolean) => {
    separateModeActiveRef.current = active;
    setSeparateModeActive(active);
  };

  const setSeparationBusyState = (busy: boolean) => {
    separationBusyRef.current = busy;
    setSeparationBusy(busy);
  };

  const clearLinkedFaceSelectionOverlay = () => {
    const overlay = linkedFaceSelectionOverlayRef.current;

    if (!overlay) {
      return;
    }

    overlay.parent?.remove(overlay);
    disposeObject(overlay);
    linkedFaceSelectionOverlayRef.current = null;
  };

  const clearSelectionBoundaryLoopOverlay = () => {
    const overlay = selectionBoundaryLoopOverlayRef.current;

    selectionBoundaryLoopsRef.current = [];

    if (!overlay) {
      return;
    }

    overlay.parent?.remove(overlay);
    disposeObject(overlay);
    selectionBoundaryLoopOverlayRef.current = null;
  };

  const {
    clearLooseEdgeLoopCapStates,
    clearSelectedLooseEdgeLoop,
    getLooseEdgeLoopCapState,
    handleLooseEdgeLoopConeChange,
    handleLooseEdgeLoopModeChange,
    refreshLooseEdgeLoopCapVisibility,
    removeCapOffsetGizmo,
    restoreLooseEdgeLoopCapStates,
    selectLooseEdgeLoop,
    setLooseEdgeLoopCapOffset,
    setLooseEdgeLoopCapTarget,
    syncLooseEdgeLoopCapStates,
  } = useModelViewerLoopCaps({
    rootRef,
    controlsRef,
    capOffsetDragRef,
    capOffsetGizmoHandleRef,
    capOffsetGizmoRef,
    capNormalTargetRef,
    capNormalTransformControlsRef,
    capNormalTransformHelperRef,
    looseEdgeLoopCapStatesRef,
    selectedLooseEdgeLoopRef,
    selectedLooseEdgeLoopOverlayRef,
    hiddenObjectIdsRef,
    selectedObjectIdRef,
    isEdgeLoopCapToolEnabled,
    isEdgeLoopCapToolEnabledRef,
    clearLinkedFaceSelectionHandlerRef,
    createCurrentViewerHistorySnapshot,
    pushViewerHistorySnapshot,
    refreshLooseEdgeLoopDisplayColors,
    refreshViewportObjectOutlines,
    schedulePersistViewerState,
    setLooseEdgeLoopCone,
    setLooseEdgeLoopMode,
    setSelectedLooseEdgeLoopActive,
  });

  const resetViewerStateForModelLoad = () => {
    autoNameAbortControllerRef.current?.abort();
    autoNameAbortControllerRef.current = null;
    setAutoNameBusy(false);
    clearAutoNameDebugView();
    clearScheduledPersistenceSave();
    if (separationCameraAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(separationCameraAnimationFrameRef.current);
      separationCameraAnimationFrameRef.current = null;
    }
    separationCameraStateRef.current = null;
    clearViewerHistory();
    currentModelSourceRef.current = null;
    persistenceSaveFailedRef.current = false;
    nextSeparatedObjectIdRef.current = 1;
    hiddenObjectIdsRef.current = new Set();
    textureVisibleRef.current = false;
    objectNamesRef.current = {};
    rememberedTriangleSelectionRef.current = null;
    clearObjectSelectionState();
    linkedFaceSelectionThresholdRef.current = defaultLinkedFaceSelectionAngle;
    setSeparateModeActiveState(false);
    setSeparationBusyState(false);
    setSeparationProgress(null);
    clearLooseEdgeLoopCapStates();
    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelection();
    setLinkedFaceSelectionGraph(null);
    setLinkedFaceSelection({
      active: false,
      count: 0,
      threshold: defaultLinkedFaceSelectionAngle,
    });
    setLooseEdgeLoopCone(false);
    setLooseEdgeLoopMode("none");
    setSeparatedObjects([]);
    setSelectedLooseEdgeLoopActive(false);
    setTextureAvailable(false);
    setTextureVisible(false);
  };

  const {
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
  } = useModelViewerSelection({
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
    setModelStatusText: setStatusText,
    setObjectSelectionState,
    setSeparateModeActiveState,
    setSeparatedObjects,
    setSeparationBusyState,
    setSeparationProgress,
    setSelectedLooseEdgeLoopActive,
    setTextureVisible,
    showToast,
    syncLooseEdgeLoopCapStates,
  });

  useEffect(() => {
    isSeparationToolEnabledRef.current = isSeparationToolEnabled;
    isEdgeLoopCapToolEnabledRef.current = isEdgeLoopCapToolEnabled;
    clearLinkedFaceSelectionHandlerRef.current = clearLinkedFaceSelection;
    clearSelectedLooseEdgeLoopHandlerRef.current = clearSelectedLooseEdgeLoop;
    hideSelectedObjectHandlerRef.current = hideSelectedObject;
    selectLinkedFaceHandlerRef.current = selectLinkedFace;
    selectLooseEdgeLoopHandlerRef.current = selectLooseEdgeLoop;
    selectSeparatedObjectHandlerRef.current = selectSeparatedObject;
    schedulePersistViewerStateHandlerRef.current = schedulePersistViewerState;
    separateByBoundaryLoopHandlerRef.current = separateByBoundaryLoop;
    getLooseEdgeLoopCapStateHandlerRef.current = getLooseEdgeLoopCapState;
    setLooseEdgeLoopCapOffsetHandlerRef.current = setLooseEdgeLoopCapOffset;
    setLooseEdgeLoopCapTargetHandlerRef.current = setLooseEdgeLoopCapTarget;
    showAllObjectsHandlerRef.current = showAllObjects;
    syncLooseEdgeLoopCapStatesHandlerRef.current = syncLooseEdgeLoopCapStates;
    undoLastViewerActionHandlerRef.current = undoLastViewerAction;
  });

  const loadModelIntoViewer = async (
    modelRoot: THREE.Group,
    camera: ViewerCamera,
    controls: OrbitControls,
    loader: GLTFLoader,
    source: PersistedModelSource,
    persistedState: PersistedViewerState | null = null,
    isCancelled: () => boolean = () => false,
  ) => {
    const gltf = await loader.parseAsync(cloneArrayBuffer(source.data), "");

    if (isCancelled()) {
      return false;
    }

    const model = gltf.scene;
    const editorGlbMetadata = getEditorGlbMetadata(model);
    const persistedEditorMetadata = persistedState?.metadata;
    let hadInvalidPersistedState = false;

    resetViewerStateForModelLoad();
    clearModel(modelRoot);
    removeEditorGeneratedLoopMeshes(model, Boolean(editorGlbMetadata));
    styleModel(model);
    setTextureAvailable(modelHasSourceTextureMaps(model));
    normalizeModel(model);

    if (persistedState) {
      const metadata = persistedEditorMetadata ?? persistedState;

      hadInvalidPersistedState = applyPersistedMeshStates(model, persistedState.meshes);
      hiddenObjectIdsRef.current = new Set(
        metadata.hiddenObjectIds.filter((objectId) => Number.isFinite(objectId)),
      );
      objectNamesRef.current = getRestoredObjectNames(metadata.objectNames);
      nextSeparatedObjectIdRef.current = Math.max(
        metadata.nextObjectId,
        getMaxObjectId(model) + 1,
        1,
      );
    } else if (editorGlbMetadata) {
      hadInvalidPersistedState = applyEditorGlbMeshStates(model, editorGlbMetadata.meshes);
      hiddenObjectIdsRef.current = new Set(
        editorGlbMetadata.hiddenObjectIds.filter((objectId) => Number.isFinite(objectId)),
      );
      objectNamesRef.current = getRestoredObjectNames(editorGlbMetadata.objectNames);
      nextSeparatedObjectIdRef.current = Math.max(
        editorGlbMetadata.nextObjectId,
        getMaxObjectId(model) + 1,
        1,
      );
    }

    modelRoot.add(model);
    updateHoverEdgeResolution(
      model,
      mountRef.current?.clientWidth ?? 1,
      mountRef.current?.clientHeight ?? 1,
    );
    hoveredEdgeRef.current = null;
    refreshObjectMaterialGroups(model, hiddenObjectIdsRef.current);
    applyObjectColors(model, hiddenObjectIdsRef.current);
    refreshViewportObjectOutlines(model);
    refreshLooseEdgeOverlays(model, hiddenObjectIdsRef.current, selectedObjectIdRef.current);

    const restoredLoopCapStates = persistedState
      ? (persistedEditorMetadata?.loopCapStates ?? persistedState.loopCapStates)
      : editorGlbMetadata?.loopCapStates;

    if (restoredLoopCapStates) {
      hadInvalidPersistedState =
        restoreLooseEdgeLoopCapStates(model, restoredLoopCapStates) || hadInvalidPersistedState;
    }

    setSeparatedObjects(
      collectSeparatedObjects(modelRoot, hiddenObjectIdsRef.current, objectNamesRef.current),
    );
    frameModel(cameraRef.current ?? camera, controls, model);
    currentModelSourceRef.current = {
      ...source,
      data: cloneArrayBuffer(source.data),
    };
    setLoadState("ready");
    setStatusText(source.name);

    if (hadInvalidPersistedState) {
      showToast("Some saved edits could not be restored.");
    }

    return true;
  };

  const restorePersistedViewerState = async (
    modelRoot: THREE.Group,
    camera: ViewerCamera,
    controls: OrbitControls,
    loader: GLTFLoader,
    isCancelled: () => boolean,
  ) => {
    let persistedState: PersistedViewerState | null = null;
    const restoreLoadVersion = modelLoadVersionRef.current;
    const isRestoreCancelled = () =>
      isCancelled() || modelLoadVersionRef.current !== restoreLoadVersion;

    try {
      persistedState = await readPersistedViewerState();
    } catch {
      if (!isRestoreCancelled()) {
        showToast("Could not read the saved model.");
      }

      return;
    }

    if (!persistedState || isRestoreCancelled()) {
      return;
    }

    isRestoringPersistedStateRef.current = true;
    setLoadState("loading");
    setStatusText(`Restoring ${persistedState.source.name}`);

    try {
      await loadModelIntoViewer(
        modelRoot,
        camera,
        controls,
        loader,
        persistedState.source,
        persistedState,
        isRestoreCancelled,
      );
    } catch {
      if (!isRestoreCancelled()) {
        resetViewerStateForModelLoad();
        clearModel(modelRoot);
        setLoadState("error");
        setStatusText("Could not restore saved model");
        showToast("Could not restore the saved model.");

        try {
          await clearPersistedViewerState();
        } catch {
          showToast("Could not clear the failed saved model.");
        }
      }
    } finally {
      isRestoringPersistedStateRef.current = false;
    }
  };

  useEffect(() => {
    restorePersistedViewerStateHandlerRef.current = restorePersistedViewerState;
  });

  useModelViewerScene({
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
    setCameraMode: setCameraModeState,
    setLoadState,
    setStatusText,
  });
  const openGlbFile = async (file: File) => {
    const loader = loaderRef.current;
    const modelRoot = rootRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!loader || !modelRoot || !camera || !controls) {
      setLoadState("error");
      setStatusText("Viewer is still starting");
      showToast("Viewer is still starting.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".glb")) {
      setLoadState("error");
      setStatusText("Choose a .glb file");
      showToast("Choose a .glb file.");
      return;
    }

    modelLoadVersionRef.current += 1;
    const loadVersion = modelLoadVersionRef.current;
    const isCancelled = () => modelLoadVersionRef.current !== loadVersion;

    setLoadState("loading");
    setStatusText(`Loading ${file.name}`);
    resetViewerStateForModelLoad();
    clearModel(modelRoot);

    try {
      await clearPersistedViewerState();
    } catch {
      showToast("Could not reset saved model state.");
    }

    try {
      const data = await file.arrayBuffer();

      if (isCancelled()) {
        return;
      }

      await loadModelIntoViewer(
        modelRoot,
        camera,
        controls,
        loader,
        {
          data,
          lastModified: file.lastModified,
          name: file.name,
          size: file.size,
          type: file.type,
        },
        null,
        isCancelled,
      );

      if (!isCancelled()) {
        await persistViewerStateNow();
      }
    } catch {
      if (isCancelled()) {
        return;
      }

      currentModelSourceRef.current = null;
      clearScheduledPersistenceSave();
      clearModel(modelRoot);
      setLoadState("error");
      setStatusText("Could not load this GLB");
      showToast("Could not load this GLB.");
    }
  };

  const exportBlenderGlb = async () => {
    const modelRoot = rootRef.current;
    const source = currentModelSourceRef.current;

    if (exportBusy) {
      return;
    }

    if (!modelRoot || !source || loadState !== "ready") {
      showToast("Load a GLB before exporting.");
      return;
    }

    let exportScene: THREE.Scene | null = null;
    const exportFileName = getBlenderExportFileName(source.name);

    setExportBusy(true);
    setStatusText(`Exporting ${exportFileName}`);

    try {
      exportScene = createBlenderExportScene(
        modelRoot,
        hiddenObjectIdsRef.current,
        objectNamesRef.current,
        nextSeparatedObjectIdRef.current,
        looseEdgeLoopCapStatesRef.current,
      );

      if (exportScene.children.length === 0) {
        throw new Error("Export scene is empty");
      }

      const result = await new GLTFExporter().parseAsync(exportScene, {
        binary: true,
        forceIndices: true,
        onlyVisible: false,
      });

      if (!(result instanceof ArrayBuffer)) {
        throw new Error("GLB exporter returned JSON");
      }

      downloadArrayBuffer(result, exportFileName, "model/gltf-binary");
      setStatusText(`Exported ${exportFileName}`);
    } catch (error) {
      console.error(`Could not export GLB "${exportFileName}"`, error);
      setStatusText("Could not export GLB");
      showToast("Could not export GLB. Check the console for details.");
    } finally {
      if (exportScene) {
        disposeObject(exportScene);
      }

      setExportBusy(false);
    }
  };

  const exportThreeMf = async () => {
    const modelRoot = rootRef.current;
    const source = currentModelSourceRef.current;

    if (exportThreeMfBusy) {
      return;
    }

    if (!modelRoot || !source || loadState !== "ready") {
      showToast("Load a GLB before exporting.");
      return;
    }

    let exportScene: THREE.Scene | null = null;
    const exportFileName = getThreeMfExportFileName(source.name);

    setExportThreeMfBusy(true);
    setStatusText(`Exporting ${exportFileName}`);

    try {
      exportScene = createBlenderExportScene(
        modelRoot,
        hiddenObjectIdsRef.current,
        objectNamesRef.current,
        nextSeparatedObjectIdRef.current,
        looseEdgeLoopCapStatesRef.current,
      );

      const result = createThreeMfPackage(exportScene);

      if (!result) {
        throw new Error("3MF export scene is empty");
      }

      downloadArrayBuffer(result, exportFileName, "model/3mf");
      setStatusText(`Exported ${exportFileName}`);
    } catch (error) {
      console.error(`Could not export 3MF "${exportFileName}"`, error);
      setStatusText("Could not export 3MF");
      showToast("Could not export 3MF. Check the console for details.");
    } finally {
      if (exportScene) {
        disposeObject(exportScene);
      }

      setExportThreeMfBusy(false);
    }
  };

  const getAutoNameEligibleObjects = () => {
    const modelRoot = rootRef.current;

    return modelRoot
      ? collectSeparatedObjects(
          modelRoot,
          hiddenObjectIdsRef.current,
          objectNamesRef.current,
        ).filter((object) => object.visible && isAutoNameEligibleObjectLabel(object.label))
      : [];
  };

  const applyAutoObjectNames = (objects: Array<AutoNamedImageObject & { objectId: number }>) => {
    const modelRoot = rootRef.current;

    if (!modelRoot) {
      return 0;
    }

    const eligibleObjectIds = new Set(getAutoNameEligibleObjects().map((object) => object.id));

    if (eligibleObjectIds.size === 0) {
      return 0;
    }

    const nextObjectNames = { ...objectNamesRef.current };
    const usedNames = new Set(
      Object.values(nextObjectNames)
        .map((name) => name.trim())
        .filter(Boolean),
    );
    const renamedObjectIds = new Set<number>();

    objects.forEach((object) => {
      if (renamedObjectIds.has(object.objectId) || !eligibleObjectIds.has(object.objectId)) {
        return;
      }

      const name = getUniqueAutoObjectName(object.name, usedNames);

      nextObjectNames[object.objectId] = name;
      usedNames.add(name);
      renamedObjectIds.add(object.objectId);
    });

    if (renamedObjectIds.size === 0) {
      return 0;
    }

    pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
    objectNamesRef.current = nextObjectNames;
    setSeparatedObjects(
      collectSeparatedObjects(modelRoot, hiddenObjectIdsRef.current, objectNamesRef.current),
    );
    schedulePersistViewerState();

    return renamedObjectIds.size;
  };

  const readAnalyzeImageError = async (response: Response) => {
    try {
      const payload = (await response.json()) as { error?: unknown };

      return typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : response.statusText;
    } catch {
      return response.statusText;
    }
  };

  const autoNameObjects = async (showDebugView = false) => {
    if (autoNameBusy) {
      autoNameAbortControllerRef.current?.abort();
      return;
    }

    clearAutoNameDebugView();

    const modelRoot = rootRef.current;
    const sourceCamera = cameraRef.current;

    if (!modelRoot || !sourceCamera || loadState !== "ready") {
      showToast("Load a GLB before auto naming objects.");
      return;
    }

    const eligibleObjects = getAutoNameEligibleObjects();

    if (eligibleObjects.length === 0) {
      showToast("No default object names to update.");
      return;
    }

    const abortController = new AbortController();
    let capture: Awaited<ReturnType<typeof createObjectNamingCapture>> = null;

    autoNameAbortControllerRef.current = abortController;
    setAutoNameBusy(true);
    setStatusText("Auto naming objects");

    try {
      capture = await createObjectNamingCapture(
        modelRoot,
        hiddenObjectIdsRef.current,
        looseEdgeLoopCapStatesRef.current,
        sourceCamera,
      );

      if (abortController.signal.aborted) {
        return;
      }

      if (!capture) {
        showToast("No visible objects to auto name.");
        return;
      }

      const formData = new FormData();

      formData.append("image", capture.blob, "object-naming.png");
      formData.append("imageWidth", String(capture.size));
      formData.append("imageHeight", String(capture.size));

      const response = await fetch("/image/analyze", {
        body: formData,
        method: "POST",
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(await readAnalyzeImageError(response));
      }

      const payload = (await response.json()) as { objects?: AutoNamedImageObject[] };
      const detectedObjects = payload.objects ?? [];
      const debugMarkers = detectedObjects
        .map((object) => {
          const marker = capture?.getMarker(object.marker) ?? null;

          return marker ? { ...object, x: marker.x, y: marker.y } : null;
        })
        .filter(
          (marker): marker is AutoNamedImageObject & { x: number; y: number } => marker !== null,
        );

      if (showDebugView) {
        showAutoNameDebugView(capture.blob, debugMarkers, capture.size);
      }

      const mappedObjects = detectedObjects
        .map((object) => {
          const marker = capture?.getMarker(object.marker) ?? null;

          return marker ? { ...object, objectId: marker.objectId } : null;
        })
        .filter((object): object is AutoNamedImageObject & { objectId: number } => object !== null);
      const renamedCount = applyAutoObjectNames(mappedObjects);

      if (renamedCount === 0) {
        showToast("Could not match any default-named objects.");
        setStatusText(currentModelSourceRef.current?.name ?? statusText);
        return;
      }

      setStatusText(`Auto named ${renamedCount} object${renamedCount === 1 ? "" : "s"}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusText(currentModelSourceRef.current?.name ?? statusText);
        return;
      }

      console.error("Could not auto name objects", error);
      setStatusText("Could not auto name objects");
      showToast(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Could not auto name objects.",
      );
    } finally {
      capture?.dispose();

      if (autoNameAbortControllerRef.current === abortController) {
        autoNameAbortControllerRef.current = null;
      }

      setAutoNameBusy(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    void openGlbFile(file);
  };

  const objectListSelectedIds =
    selectedObjectIds.size > 0
      ? selectedObjectIds
      : selectedLooseEdgeLoopActive && selectedLooseEdgeLoopRef.current
        ? new Set([selectedLooseEdgeLoopRef.current.objectId])
        : new Set<number>();

  return (
    <main className="fixed inset-0 overflow-hidden bg-neutral-200 text-neutral-950">
      <div
        ref={mountRef}
        className={`absolute inset-0 ${isSeparationToolEnabled && separateModeActive ? "cursor-crosshair" : ""}`}
        aria-label="3D viewport"
      />

      <TopBar
        canExport={loadState === "ready" && currentModelSourceRef.current !== null}
        canUndo={canUndo && loadState === "ready" && !separationBusy}
        exportBusy={exportBusy}
        exportThreeMfBusy={exportThreeMfBusy}
        inputRef={inputRef}
        loadState={loadState}
        statusText={statusText}
        onExportGlb={exportBlenderGlb}
        onExportThreeMf={exportThreeMf}
        onFileChange={handleFileChange}
        onUndo={undoLastViewerAction}
      />
      <ObjectsPanel
        autoNaming={autoNameBusy}
        objects={separatedObjects}
        selectedObjectIds={objectListSelectedIds}
        onAutoNameObjects={autoNameObjects}
        onJoinSelectedObjects={joinSelectedObjects}
        onRenameObject={renameSeparatedObject}
        onSelectObject={selectSeparatedObject}
        onToggleVisibility={toggleObjectVisibility}
      />
      <CameraModeToggle mode={cameraMode} onToggle={() => toggleCameraModeHandlerRef.current?.()} />
      {separatedObjects.length > 0 ? (
        <TextureToggle
          available={textureAvailable}
          visible={textureVisible}
          onToggle={toggleTextureVisibility}
        />
      ) : null}
      {isSeparationToolEnabled ? (
        <SeparationToolPanel
          graph={linkedFaceSelectionGraph}
          graphHeight={linkedFaceSelectionGraphHeight}
          graphWidth={linkedFaceSelectionGraphWidth}
          isAvailable={selectedObjectId != null}
          isModeActive={separateModeActive}
          isProcessing={separationBusy}
          maxAngle={maxLinkedFaceSelectionAngle}
          progressText={separationProgress}
          selection={linkedFaceSelection}
          onClear={() => clearLinkedFaceSelection(false)}
          onCommitThreshold={commitLinkedFaceSelectionThreshold}
          onSeparate={handleSeparateSelection}
          onToggleMode={toggleSeparateMode}
        />
      ) : null}
      {isEdgeLoopCapToolEnabled ? (
        <EdgeLoopCapToolPanel
          active={selectedLooseEdgeLoopActive}
          cone={looseEdgeLoopCone}
          mode={looseEdgeLoopMode}
          onConeChange={handleLooseEdgeLoopConeChange}
          onModeChange={handleLooseEdgeLoopModeChange}
        />
      ) : null}
      {autoNameDebug ? (
        <AutoNameDebugView
          imageSize={autoNameDebug.imageSize}
          imageUrl={autoNameDebug.imageUrl}
          markers={autoNameDebug.markers}
          onDismiss={clearAutoNameDebugView}
        />
      ) : null}
      {toast ? (
        <div
          role="alert"
          className="pointer-events-none absolute bottom-4 left-4 max-w-[calc(100vw-2rem)] rounded-md bg-red-950/90 px-3 py-2 text-sm text-white shadow-lg"
        >
          {toast.text}
        </div>
      ) : null}
    </main>
  );
}
