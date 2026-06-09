export type LoadState = "empty" | "loading" | "ready" | "error";

export type LooseEdgeLoopMode =
  | "none"
  | "fill"
  | "extrude-x"
  | "extrude-y"
  | "extrude-z"
  | "extrude-normal"
  | "cylinder-x"
  | "cylinder-y"
  | "cylinder-z"
  | "cylinder-normal";

export type LinkedFaceSelectionState = {
  active: boolean;
  count: number;
  threshold: number;
};

export type LinkedFaceSelectionGraph = {
  counts: number[];
  interval: number;
  maxCount: number;
  maxThreshold: number;
};

export type SeparatedObjectSummary = {
  color: string;
  id: number;
  label: string;
  triangleCount: number;
  visible: boolean;
};
