import { LuImage } from "react-icons/lu";

type TextureToggleProps = {
  available: boolean;
  visible: boolean;
  onToggle: () => void;
};

export function TextureToggle({ available, visible, onToggle }: TextureToggleProps) {
  return (
    <button
      type="button"
      className={`pointer-events-auto absolute bottom-4 left-[168px] inline-flex h-10 w-10 items-center justify-center rounded-md text-lg shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-default disabled:opacity-35 ${
        visible
          ? "bg-neutral-950 text-white hover:bg-neutral-800"
          : "bg-white/85 text-neutral-500 backdrop-blur hover:bg-white hover:text-neutral-900"
      }`}
      aria-label={visible ? "Show color view" : "Show texture view"}
      aria-pressed={visible}
      disabled={!available}
      title={available ? (visible ? "Show color view" : "Show texture view") : "No texture"}
      onClick={onToggle}
    >
      <LuImage aria-hidden="true" />
    </button>
  );
}
