import type { MouseEvent } from "react";

import type { LinkedFaceSelectionGraph, LinkedFaceSelectionState } from "./types";

type LinkedFaceSelectionPanelProps = {
  graph: LinkedFaceSelectionGraph | null;
  graphHeight: number;
  isAvailable: boolean;
  isModeActive: boolean;
  isProcessing: boolean;
  graphWidth: number;
  maxAngle: number;
  onClear: () => void;
  onCommitThreshold: (threshold: number) => void;
  onSeparate: () => void;
  onToggleMode: () => void;
  progressText: string | null;
  selection: LinkedFaceSelectionState;
};

function formatAngle(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function getGraphPoint(
  graph: LinkedFaceSelectionGraph,
  index: number,
  graphWidth: number,
  graphHeight: number,
) {
  const count = graph.counts[index] ?? 1;
  const x = graph.counts.length <= 1 ? 0 : (index / (graph.counts.length - 1)) * graphWidth;
  const y = graphHeight - 2 - (count / Math.max(graph.maxCount, 1)) * (graphHeight - 4);

  return { count, x, y };
}

function getGraphPoints(graph: LinkedFaceSelectionGraph, graphWidth: number, graphHeight: number) {
  return graph.counts
    .map((_, index) => {
      const point = getGraphPoint(graph, index, graphWidth, graphHeight);

      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");
}

function getGraphMarker(
  graph: LinkedFaceSelectionGraph,
  threshold: number,
  graphWidth: number,
  graphHeight: number,
) {
  const index = Math.min(
    Math.max(Math.round(threshold / graph.interval), 0),
    graph.counts.length - 1,
  );

  return getGraphPoint(graph, index, graphWidth, graphHeight);
}

function getClickedGraphThreshold(
  event: MouseEvent<SVGSVGElement>,
  graph: LinkedFaceSelectionGraph,
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
  const rawThreshold = Math.min(Math.max(ratio, 0), 1) * graph.maxThreshold;
  const snappedThreshold = Math.round(rawThreshold / graph.interval) * graph.interval;

  return Number(snappedThreshold.toFixed(3));
}

export function LinkedFaceSelectionPanel({
  graph,
  graphHeight,
  isAvailable,
  isModeActive,
  isProcessing,
  graphWidth,
  maxAngle,
  onClear,
  onCommitThreshold,
  onSeparate,
  onToggleMode,
  progressText,
  selection,
}: LinkedFaceSelectionPanelProps) {
  if (!isAvailable) {
    return null;
  }

  const graphPoints = graph ? getGraphPoints(graph, graphWidth, graphHeight) : "";
  const graphMarker = graph
    ? getGraphMarker(graph, selection.threshold, graphWidth, graphHeight)
    : null;

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 text-sm text-neutral-700">
      <div className="pointer-events-auto rounded-md bg-white/85 px-3 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-wait disabled:opacity-70 ${
              isModeActive
                ? "bg-neutral-950 text-white hover:bg-neutral-800"
                : "bg-white text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-50"
            }`}
            aria-pressed={isModeActive}
            disabled={isProcessing}
            onClick={onToggleMode}
          >
            Separate
          </button>
          {isModeActive && selection.active && (
            <span className="text-neutral-500 tabular-nums">{selection.count} faces</span>
          )}
        </div>
        {isModeActive && !selection.active && (
          <div className="mt-3 text-xs text-neutral-500" aria-live="polite">
            {progressText ?? "select a starting point"}
          </div>
        )}
        {isModeActive && selection.active && (
          <>
            {progressText && (
              <div className="mt-3 text-xs text-neutral-500" aria-live="polite">
                {progressText}
              </div>
            )}
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
              <span>Threshold</span>
              <span className="tabular-nums">{formatAngle(selection.threshold)} deg</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-500">
              <span>0</span>
              <span>{maxAngle} deg</span>
            </div>
            {graph && graphMarker && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
                  <span>0.1 deg steps</span>
                  <span className="tabular-nums">{graph.maxCount} max</span>
                </div>
                <svg
                  viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                  preserveAspectRatio="none"
                  className="h-14 w-full cursor-crosshair rounded-sm bg-neutral-950/5"
                  aria-label="Polygon count by linked face threshold"
                  onClick={(event) => onCommitThreshold(getClickedGraphThreshold(event, graph))}
                >
                  <polyline
                    points={graphPoints}
                    fill="none"
                    stroke="#171717"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={graphMarker.x}
                    y1="0"
                    x2={graphMarker.x}
                    y2={graphHeight}
                    stroke="#facc15"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={graphMarker.x} cy={graphMarker.y} r="2.4" fill="#facc15" />
                </svg>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-md bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
                disabled={isProcessing}
                onClick={() => onSeparate()}
              >
                Apply
              </button>
              <button
                type="button"
                className="flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-300 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
                disabled={isProcessing}
                onClick={() => onClear()}
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
