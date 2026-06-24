import Link from "next/link";
import { useState } from "react";
import { LuChevronDown, LuChevronLeft, LuDownload, LuLoaderCircle, LuUndo2 } from "react-icons/lu";

import type { LoadState } from "./types";

type TopBarProps = {
  backHref: string;
  canExport: boolean;
  canUndo: boolean;
  exportBusy: boolean;
  exportThreeMfBusy: boolean;
  loadState: LoadState;
  onExportGlb: () => void;
  onExportThreeMf: () => void;
  onOpenBambuStudio: () => void;
  onUndo: () => void;
  statusText: string;
};

function getDisplayStatusText(statusText: string) {
  return statusText.replace(/\.glb$/i, "");
}

export function TopBar({
  backHref,
  canExport,
  canUndo,
  exportBusy,
  exportThreeMfBusy,
  loadState,
  onExportGlb,
  onExportThreeMf,
  onOpenBambuStudio,
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
        <Link
          href={backHref}
          className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-md bg-neutral-950 text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
          aria-label="Back to files"
        >
          <LuChevronLeft aria-hidden="true" className="text-xl" />
        </Link>
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
              className="absolute top-full left-0 z-20 mt-2 min-w-44 overflow-hidden rounded-md bg-white/95 py-1 text-sm text-neutral-900 shadow-sm ring-1 ring-neutral-200 backdrop-blur"
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
              <button
                type="button"
                className="block w-full px-3 py-2 text-left transition hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
                role="menuitem"
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onOpenBambuStudio();
                }}
              >
                Open in Bambu Studio
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
