import * as THREE from "three";
import type { Dispatch, SetStateAction } from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import type {
  HoveredEdge,
  LooseEdgeLoopCapState,
  ObjectNameMap,
  ViewerHistorySnapshot,
} from "./model-viewer-core";
import type { LooseEdgeLoopMode, SeparatedObjectSummary } from "../viewer-controls/types";
import type { MutableRef } from "./model-viewer-scene-types";

export type ModelViewerLoopCapsParams = {
  rootRef: MutableRef<THREE.Group | null>;
  controlsRef: MutableRef<OrbitControls | null>;
  capOffsetDragRef: MutableRef<import("./model-viewer-core").CapOffsetDragState | null>;
  capOffsetGizmoHandleRef: MutableRef<THREE.Object3D | null>;
  capOffsetGizmoRef: MutableRef<THREE.Group | null>;
  capNormalTargetRef: MutableRef<THREE.Object3D | null>;
  capNormalTransformControlsRef: MutableRef<TransformControls | null>;
  capNormalTransformHelperRef: MutableRef<THREE.Object3D | null>;
  looseEdgeLoopCapStatesRef: MutableRef<Map<string, LooseEdgeLoopCapState>>;
  selectedLooseEdgeLoopRef: MutableRef<HoveredEdge | null>;
  selectedLooseEdgeLoopsRef: MutableRef<HoveredEdge[]>;
  selectedLooseEdgeLoopOverlayRef: MutableRef<
    Map<string, import("three/examples/jsm/lines/LineSegments2.js").LineSegments2>
  >;
  hiddenObjectIdsRef: MutableRef<Set<number>>;
  objectNamesRef: MutableRef<ObjectNameMap>;
  selectedObjectIdRef: MutableRef<number | null>;
  isEdgeLoopCapToolEnabled: boolean;
  isEdgeLoopCapToolEnabledRef: MutableRef<boolean>;
  clearLinkedFaceSelectionHandlerRef: MutableRef<
    ((clearObjectSelection?: boolean, refreshVisuals?: boolean) => void) | null
  >;
  createCurrentViewerHistorySnapshot: () => ViewerHistorySnapshot | null;
  pushViewerHistorySnapshot: (snapshot: ViewerHistorySnapshot | null) => void;
  refreshLooseEdgeLoopDisplayColors: (modelRoot?: THREE.Object3D | null) => void;
  refreshViewportObjectOutlines: (
    modelRoot?: THREE.Object3D | null,
    hiddenObjectIds?: Set<number>,
  ) => void;
  schedulePersistViewerState: () => void;
  setLooseEdgeLoopCone: (cone: boolean) => void;
  setLooseEdgeLoopMode: (mode: LooseEdgeLoopMode) => void;
  setSelectedLooseEdgeLoopActive: (active: boolean) => void;
  setSelectedLooseEdgeLoopRemovable: (removable: boolean) => void;
  setSeparatedObjects: Dispatch<SetStateAction<SeparatedObjectSummary[]>>;
};
