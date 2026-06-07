import type { ChangeEvent, RefObject } from "react";

import type { LoadState } from "./types";

type TopBarProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  loadState: LoadState;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  statusText: string;
};

export function TopBar({ inputRef, loadState, onFileChange, statusText }: TopBarProps) {
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
        className="pointer-events-auto rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-wait disabled:opacity-70"
        disabled={loadState === "loading"}
        onClick={() => inputRef.current?.click()}
      >
        Load GLB
      </button>
      <span
        className="max-w-[min(28rem,calc(100vw-9rem))] truncate rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur"
        aria-live="polite"
      >
        {statusText}
      </span>
    </div>
  );
}
