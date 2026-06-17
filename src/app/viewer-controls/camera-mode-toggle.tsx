import { LuBox, LuScanEye } from "react-icons/lu";

export type CameraMode = "orthographic" | "perspective";

type CameraModeToggleProps = {
  mode: CameraMode;
  onToggle: () => void;
};

export function CameraModeToggle({ mode, onToggle }: CameraModeToggleProps) {
  const isOrthographic = mode === "orthographic";

  return (
    <button
      type="button"
      className="pointer-events-auto absolute bottom-4 left-[120px] inline-flex h-10 w-10 items-center justify-center rounded-md bg-neutral-950 text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
      aria-label={isOrthographic ? "Switch to perspective camera" : "Switch to orthographic camera"}
      aria-pressed={isOrthographic}
      title={isOrthographic ? "Orthographic" : "Perspective"}
      onClick={onToggle}
    >
      {isOrthographic ? (
        <LuBox aria-hidden="true" className="text-lg" />
      ) : (
        <LuScanEye aria-hidden="true" className="text-lg" />
      )}
    </button>
  );
}
