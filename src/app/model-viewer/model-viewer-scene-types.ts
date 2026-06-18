import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import type {
  HoveredEdge,
  LinkedFaceSelectionDetails,
  LooseEdgeLoopCapState,
  CapOffsetDragState,
  SelectionBoundaryLoop,
  ViewerHistorySnapshot,
} from "./model-viewer-core";
import type { LoadState } from "../viewer-controls/types";
import type { CameraMode } from "../viewer-controls/camera-mode-toggle";

export type MutableRef<T> = {
  current: T;
};

export type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export type ModelViewerSceneParams = {
  mountRef: MutableRef<HTMLDivElement | null>;
  cameraRef: MutableRef<ViewerCamera | null>;
  controlsRef: MutableRef<OrbitControls | null>;
  loaderRef: MutableRef<GLTFLoader | null>;
  rootRef: MutableRef<THREE.Group | null>;
  capNormalTargetRef: MutableRef<THREE.Object3D | null>;
  capNormalTransformControlsRef: MutableRef<TransformControls | null>;
  capNormalTransformHelperRef: MutableRef<THREE.Object3D | null>;
  capNormalTransformHistorySnapshotRef: MutableRef<ViewerHistorySnapshot | null>;
  capNormalTransformChangedRef: MutableRef<boolean>;
  capOffsetDragRef: MutableRef<CapOffsetDragState | null>;
  capOffsetGizmoHandleRef: MutableRef<THREE.Object3D | null>;
  capOffsetGizmoRef: MutableRef<THREE.Group | null>;
  selectedLooseEdgeLoopRef: MutableRef<HoveredEdge | null>;
  selectedLooseEdgeLoopsRef: MutableRef<HoveredEdge[]>;
  hoveredEdgeRef: MutableRef<HoveredEdge | null>;
  linkedFaceSelectionRef: MutableRef<LinkedFaceSelectionDetails | null>;
  selectionBoundaryLoopsRef: MutableRef<SelectionBoundaryLoop[]>;
  hiddenObjectIdsRef: MutableRef<Set<number>>;
  separateModeActiveRef: MutableRef<boolean>;
  separationBusyRef: MutableRef<boolean>;
  selectedObjectIdRef: MutableRef<number | null>;
  isEdgeLoopCapToolEnabledRef: MutableRef<boolean>;
  isSeparationToolEnabledRef: MutableRef<boolean>;
  looseEdgeLoopCapStatesRef: MutableRef<Map<string, LooseEdgeLoopCapState>>;
  cameraModeRef: MutableRef<CameraMode>;
  persistenceSaveTimeoutRef: MutableRef<number | null>;
  toastTimeoutRef: MutableRef<number | null>;
  toggleCameraModeHandlerRef: MutableRef<(() => void) | null>;
  setLooseEdgeLoopCapTargetHandlerRef: MutableRef<
    ((edge: HoveredEdge, target: THREE.Vector3) => void) | null
  >;
  schedulePersistViewerStateHandlerRef: MutableRef<(() => void) | null>;
  getLooseEdgeLoopCapStateHandlerRef: MutableRef<
    ((edge: HoveredEdge) => LooseEdgeLoopCapState | null) | null
  >;
  setLooseEdgeLoopCapOffsetHandlerRef: MutableRef<
    ((edge: HoveredEdge, offset: number) => void) | null
  >;
  separateByBoundaryLoopHandlerRef: MutableRef<((loopId: number) => void) | null>;
  selectLooseEdgeLoopHandlerRef: MutableRef<
    ((edge: HoveredEdge, additive?: boolean) => void) | null
  >;
  clearSelectedLooseEdgeLoopHandlerRef: MutableRef<(() => void) | null>;
  selectLinkedFaceHandlerRef: MutableRef<
    ((mesh: THREE.Mesh, triangleIndex: number) => void) | null
  >;
  selectSeparatedObjectHandlerRef: MutableRef<
    ((objectId: number, additive?: boolean) => void) | null
  >;
  clearLinkedFaceSelectionHandlerRef: MutableRef<
    ((clearObjectSelection?: boolean, refreshVisuals?: boolean) => void) | null
  >;
  undoLastViewerActionHandlerRef: MutableRef<(() => void) | null>;
  showAllObjectsHandlerRef: MutableRef<(() => void) | null>;
  hideSelectedObjectHandlerRef: MutableRef<(() => void) | null>;
  restorePersistedViewerStateHandlerRef: MutableRef<
    | ((
        modelRoot: THREE.Group,
        camera: ViewerCamera,
        controls: OrbitControls,
        loader: GLTFLoader,
        isCancelled: () => boolean,
      ) => Promise<void>)
    | null
  >;
  createCurrentViewerHistorySnapshot: () => ViewerHistorySnapshot | null;
  pushViewerHistorySnapshot: (snapshot: ViewerHistorySnapshot | null) => void;
  removeCapOffsetGizmo: () => void;
  rememberTriangleSelection: (mesh: THREE.Mesh, triangleIndex: number) => void;
  setCameraMode: (mode: CameraMode) => void;
  setLoadState: (state: LoadState) => void;
  setStatusText: (text: string) => void;
};
