import type { LooseEdgeLoopMode } from "./types";

type LoopPanelProps = {
  active: boolean;
  mode: LooseEdgeLoopMode;
  onModeChange: (mode: LooseEdgeLoopMode) => void;
};

type LoopOperation = "none" | "cap" | "extrude" | "cylinder";
type LoopAxis = "x" | "y" | "z" | "normal";

const operations: Array<{ label: string; value: LoopOperation }> = [
  { label: "None", value: "none" },
  { label: "Cap", value: "cap" },
  { label: "Extrude", value: "extrude" },
  { label: "Cylinder", value: "cylinder" },
];

const axes: Array<{ label: string; value: LoopAxis }> = [
  { label: "X", value: "x" },
  { label: "Y", value: "y" },
  { label: "Z", value: "z" },
  { label: "Normal", value: "normal" },
];

function getLoopOperation(mode: LooseEdgeLoopMode): LoopOperation {
  if (mode === "fill") {
    return "cap";
  }

  if (mode.startsWith("extrude-")) {
    return "extrude";
  }

  if (mode.startsWith("cylinder-")) {
    return "cylinder";
  }

  return "none";
}

function getLoopAxis(mode: LooseEdgeLoopMode): LoopAxis {
  if (mode.endsWith("-x")) {
    return "x";
  }

  if (mode.endsWith("-y")) {
    return "y";
  }

  if (mode.endsWith("-z")) {
    return "z";
  }

  return "normal";
}

function getLoopMode(operation: LoopOperation, axis: LoopAxis): LooseEdgeLoopMode {
  if (operation === "none") {
    return "none";
  }

  if (operation === "cap") {
    return "fill";
  }

  if (operation === "extrude") {
    return axis === "normal" ? "extrude-normal" : `extrude-${axis}`;
  }

  return axis === "normal" ? "cylinder-normal" : `cylinder-${axis}`;
}

export function LoopPanel({ active, mode, onModeChange }: LoopPanelProps) {
  if (!active) {
    return null;
  }

  const operation = getLoopOperation(mode);
  const axis = getLoopAxis(mode);
  const axisEnabled = operation === "extrude" || operation === "cylinder";

  return (
    <div className="pointer-events-auto absolute top-20 left-4 w-72 max-w-[calc(100vw-2rem)] rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span>Loop</span>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[3.25rem_1fr] items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Mode</span>
          <div className="grid grid-cols-4 gap-1 rounded-md bg-neutral-950/10 p-1">
            {operations.map((item) => {
              const selected = item.value === operation;

              return (
                <button
                  key={item.value}
                  type="button"
                  className={`rounded-sm px-2 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 ${
                    selected
                      ? "bg-neutral-950 text-white shadow-sm"
                      : "text-neutral-700 hover:bg-white/70"
                  }`}
                  aria-pressed={selected}
                  onClick={() => onModeChange(getLoopMode(item.value, axis))}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-[3.25rem_1fr] items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Axis</span>
          <div className="grid grid-cols-4 gap-1 rounded-md bg-neutral-950/10 p-1">
            {axes.map((item) => {
              const selected = item.value === axis;

              return (
                <button
                  key={item.value}
                  type="button"
                  className={`rounded-sm px-2 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-default disabled:opacity-45 ${
                    selected
                      ? "bg-neutral-950 text-white shadow-sm"
                      : "text-neutral-700 hover:bg-white/70 disabled:hover:bg-transparent"
                  }`}
                  aria-pressed={selected}
                  disabled={!axisEnabled}
                  onClick={() => onModeChange(getLoopMode(operation, item.value))}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
