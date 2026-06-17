import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import type {
  HoveredEdge,
  LinkedFaceSelectionCache,
  LinkedFaceSelectionDetails,
  ObjectNameMap,
  RememberedTriangleSelection,
  SelectionBoundaryLoop,
  ViewerHistorySnapshot,
} from "./model-viewer-core";
import type {
  LinkedFaceSelectionGraph,
  LinkedFaceSelectionState,
  LooseEdgeLoopMode,
  SeparatedObjectSummary,
} from "../viewer-controls/types";
import type { PersistedModelSource } from "./persistence";
import type { MutableRef, ViewerCamera } from "./model-viewer-scene-types";

export type SeparationCameraState = {
  far: number;
  near: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  target: THREE.Vector3;
  zoom: number;
};

export type ModelViewerSelectionParams = {
  mountRef: MutableRef<HTMLDivElement | null>;
  cameraRef: MutableRef<ViewerCamera | null>;
  controlsRef: MutableRef<OrbitControls | null>;
  rootRef: MutableRef<THREE.Group | null>;
  separationCameraAnimationFrameRef: MutableRef<number | null>;
  separationCameraStateRef: MutableRef<SeparationCameraState | null>;
  linkedFaceSelectionRef: MutableRef<LinkedFaceSelectionDetails | null>;
  linkedFaceSelectionCacheRef: MutableRef<LinkedFaceSelectionCache | null>;
  selectionBoundaryLoopsRef: MutableRef<SelectionBoundaryLoop[]>;
  selectionBoundaryLoopOverlayRef: MutableRef<LineSegments2 | null>;
  linkedFaceSelectionThresholdRef: MutableRef<number>;
  rememberedTriangleSelectionRef: MutableRef<RememberedTriangleSelection | null>;
  selectedLooseEdgeLoopRef: MutableRef<HoveredEdge | null>;
  hiddenObjectIdsRef: MutableRef<Set<number>>;
  textureVisibleRef: MutableRef<boolean>;
  objectNamesRef: MutableRef<ObjectNameMap>;
  historySnapshotsRef: MutableRef<ViewerHistorySnapshot[]>;
  nextSeparatedObjectIdRef: MutableRef<number>;
  currentModelSourceRef: MutableRef<PersistedModelSource | null>;
  separationBusyRef: MutableRef<boolean>;
  separateModeActiveRef: MutableRef<boolean>;
  selectedObjectIdRef: MutableRef<number | null>;
  selectedObjectIdsRef: MutableRef<Set<number>>;
  isSeparationToolEnabledRef: MutableRef<boolean>;
  textureAvailable: boolean;
  statusText: string;
  clearLooseEdgeLoopCapStates: () => void;
  clearLinkedFaceSelectionOverlay: () => void;
  clearObjectSelectionState: () => void;
  clearSelectedLooseEdgeLoop: () => void;
  clearSelectionBoundaryLoopOverlay: () => void;
  createCurrentViewerHistorySnapshot: () => ViewerHistorySnapshot | null;
  pushViewerHistorySnapshot: (snapshot: ViewerHistorySnapshot | null) => void;
  refreshLooseEdgeLoopCapVisibility: (hiddenObjectIds?: Set<number>) => void;
  refreshLooseEdgeLoopDisplayColors: (modelRoot?: THREE.Object3D | null) => void;
  refreshViewportObjectOutlines: (
    modelRoot?: THREE.Object3D | null,
    hiddenObjectIds?: Set<number>,
  ) => void;
  restoreLooseEdgeLoopCapStates: (
    modelRoot: THREE.Object3D,
    capStates: import("./persistence").PersistedLoopCapState[],
  ) => boolean;
  schedulePersistViewerState: () => void;
  setCanUndo: (canUndo: boolean) => void;
  setLinkedFaceSelection: (
    selection:
      | LinkedFaceSelectionState
      | ((current: LinkedFaceSelectionState) => LinkedFaceSelectionState),
  ) => void;
  setLinkedFaceSelectionGraph: (graph: LinkedFaceSelectionGraph | null) => void;
  setLooseEdgeLoopMode: (mode: LooseEdgeLoopMode) => void;
  setModelStatusText: (text: string) => void;
  setObjectSelectionState: (objectIds: Set<number>, primaryObjectId: number | null) => void;
  setSeparateModeActiveState: (active: boolean) => void;
  setSeparatedObjects: (objects: SeparatedObjectSummary[]) => void;
  setSeparationBusyState: (busy: boolean) => void;
  setSeparationProgress: (progress: string | null) => void;
  setSelectedLooseEdgeLoopActive: (active: boolean) => void;
  setTextureVisible: (visible: boolean) => void;
  showToast: (text: string) => void;
  syncLooseEdgeLoopCapStates: (modelRoot?: THREE.Object3D | null) => void;
};
