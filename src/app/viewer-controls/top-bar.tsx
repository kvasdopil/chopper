import type { ChangeEvent, RefObject } from "react";
import { LuDownload, LuLoaderCircle, LuUndo2, LuUpload } from "react-icons/lu";

import type { LoadState } from "./types";

type TopBarProps = {
  canExport: boolean;
  canUndo: boolean;
  exportBusy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  loadState: LoadState;
  onExportGlb: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onUndo: () => void;
  statusText: string;
};

export function TopBar({
  canExport,
  canUndo,
  exportBusy,
  inputRef,
  loadState,
  onExportGlb,
  onFileChange,
  onUndo,
  statusText,
}: TopBarProps) {
  return (
    <div className="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="sr-only"
        onChange={onFileChange}
      />
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-wait disabled:opacity-70"
        disabled={loadState === "loading"}
        onClick={() => inputRef.current?.click()}
      >
        <LuUpload aria-hidden="true" className="text-base" />
        Load GLB
      </button>
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canUndo || loadState === "loading"}
        onClick={onUndo}
      >
        <LuUndo2 aria-hidden="true" className="text-base" />
        Undo
      </button>
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canExport || exportBusy || loadState === "loading"}
        onClick={onExportGlb}
      >
        {exportBusy ? (
          <LuLoaderCircle aria-hidden="true" className="animate-spin text-base" />
        ) : (
          <LuDownload aria-hidden="true" className="text-base" />
        )}
        {exportBusy ? "Exporting" : "Export GLB"}
      </button>
      <span
        className="max-w-[min(28rem,calc(100vw-18rem))] truncate rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur"
        aria-live="polite"
      >
        {statusText}
      </span>
    </div>
  );
}
