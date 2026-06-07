export type LoadState = "empty" | "loading" | "ready" | "error";

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
