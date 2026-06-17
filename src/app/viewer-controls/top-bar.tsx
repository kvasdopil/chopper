import { useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { LuChevronDown, LuDownload, LuLoaderCircle, LuUndo2, LuUpload } from "react-icons/lu";

import type { LoadState } from "./types";

type TopBarProps = {
  canExport: boolean;
  canUndo: boolean;
  exportBusy: boolean;
  exportThreeMfBusy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  loadState: LoadState;
  onExportGlb: () => void;
  onExportThreeMf: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onUndo: () => void;
  statusText: string;
};

function getDisplayStatusText(statusText: string) {
  return statusText.replace(/\.glb$/i, "");
}

export function TopBar({
  canExport,
  canUndo,
  exportBusy,
  exportThreeMfBusy,
  inputRef,
  loadState,
  onExportGlb,
  onExportThreeMf,
  onFileChange,
  onUndo,
  statusText,
}: TopBarProps) {
  const displayStatusText = getDisplayStatusText(statusText);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportDisabled = !canExport || exportBusy || exportThreeMfBusy || loadState === "loading";
  const exportMenuBusy = exportBusy || exportThreeMfBusy;

  return (
    <>
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
        <div
          className="pointer-events-auto relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setIsExportMenuOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="inline-flex h-10 items-center gap-1 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Export"
            aria-expanded={isExportMenuOpen}
            aria-haspopup="menu"
            disabled={exportDisabled}
            onClick={() => setIsExportMenuOpen((isOpen) => !isOpen)}
          >
            {exportMenuBusy ? (
              <LuLoaderCircle aria-hidden="true" className="animate-spin text-base" />
            ) : (
              <LuDownload aria-hidden="true" className="text-base" />
            )}
            <LuChevronDown aria-hidden="true" className="text-sm" />
          </button>
          {isExportMenuOpen && !exportDisabled ? (
            <div
              className="absolute top-full left-0 z-20 mt-2 min-w-36 overflow-hidden rounded-md bg-white/95 py-1 text-sm text-neutral-900 shadow-sm ring-1 ring-neutral-200 backdrop-blur"
              role="menu"
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left transition hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
                role="menuitem"
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportGlb();
                }}
              >
                Export GLB
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left transition hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
                role="menuitem"
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportThreeMf();
                }}
              >
                Export 3MF
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <span
        className="pointer-events-none absolute top-4 left-1/2 max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 truncate px-3 py-2 text-center text-sm font-bold text-neutral-900"
        aria-live="polite"
      >
        {displayStatusText}
      </span>
    </>
  );
}
