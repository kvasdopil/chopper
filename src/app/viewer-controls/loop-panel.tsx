import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";

import type { LooseEdgeLoopMode } from "./types";

type LoopPanelProps = {
  active: boolean;
  canRemoveLoop: boolean;
  cone: boolean;
  mode: LooseEdgeLoopMode;
  onConeChange: (cone: boolean) => void;
  onModeChange: (mode: LooseEdgeLoopMode) => void;
  onRemoveLoop: () => void;
};

type LoopOperation = "none" | "cap" | "extrude" | "cylinder";
type LoopAxis = "x" | "y" | "z" | "normal";

const operations: Array<{ fullLabel: string; label: string; value: LoopOperation }> = [
  { fullLabel: "None", label: "N", value: "none" },
  { fullLabel: "Cap", label: "Cap", value: "cap" },
  { fullLabel: "Extrude", label: "Ex", value: "extrude" },
  { fullLabel: "Cylinder", label: "Cyl", value: "cylinder" },
];

const axes: Array<{ fullLabel: string; label: string; value: LoopAxis }> = [
  { fullLabel: "X", label: "X", value: "x" },
  { fullLabel: "Y", label: "Y", value: "y" },
  { fullLabel: "Z", label: "Z", value: "z" },
  { fullLabel: "Normal", label: "N", value: "normal" },
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

export function LoopPanel({
  active,
  canRemoveLoop,
  cone,
  mode,
  onConeChange,
  onModeChange,
  onRemoveLoop,
}: LoopPanelProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  if (!active) {
    return null;
  }

  const operation = getLoopOperation(mode);
  const axis = getLoopAxis(mode);
  const axisEnabled = operation === "extrude" || operation === "cylinder";
  const coneEnabled = operation === "extrude" || operation === "cylinder";

  return (
    <>
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
                    aria-label={item.fullLabel}
                    aria-pressed={selected}
                    onClick={() => onModeChange(getLoopMode(item.value, axis))}
                    title={item.fullLabel}
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
                    aria-label={item.fullLabel}
                    aria-pressed={selected}
                    disabled={!axisEnabled}
                    onClick={() => onModeChange(getLoopMode(operation, item.value))}
                    title={item.fullLabel}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-[3.25rem_1fr] items-center gap-2">
            <span className="text-xs font-medium text-neutral-500">Shape</span>
            <label
              className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition ${
                coneEnabled
                  ? "cursor-pointer text-neutral-700 hover:bg-white/70"
                  : "cursor-default text-neutral-400"
              }`}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-neutral-950"
                checked={cone}
                disabled={!coneEnabled}
                onChange={(event) => onConeChange(event.target.checked)}
              />
              Cone
            </label>
          </div>
          <button
            type="button"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-500/45 bg-red-50/80 px-2 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-100/70 disabled:text-neutral-400"
            disabled={!canRemoveLoop}
            onClick={() => setConfirmingRemove(true)}
            title={
              canRemoveLoop
                ? "Remove selected cutting loop"
                : "Selected loop is not a removable cutting loop"
            }
          >
            <LuTrash2 aria-hidden="true" className="text-sm" />
            Remove loop
          </button>
        </div>
      </div>
      {confirmingRemove ? (
        <dialog
          open
          className="pointer-events-auto fixed inset-0 z-40 flex h-full w-full max-w-none items-center justify-center bg-transparent p-4 text-sm text-neutral-800"
          aria-labelledby="remove-loop-dialog-title"
        >
          <div className="fixed inset-0 bg-neutral-950/35" aria-hidden="true" />
          <div className="relative w-full max-w-xs rounded-md bg-white p-4 shadow-xl">
            <div id="remove-loop-dialog-title" className="font-medium text-neutral-950">
              Remove loop?
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-600">
              Remove the selected cutting loop and attached generated geometry.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                onClick={() => {
                  setConfirmingRemove(false);
                  onRemoveLoop();
                }}
              >
                <LuTrash2 aria-hidden="true" className="text-sm" />
                Remove
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
