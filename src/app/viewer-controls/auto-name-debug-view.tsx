import Image from "next/image";
import { LuX } from "react-icons/lu";

type AutoNameDebugMarker = {
  marker: string;
  name: string;
  x: number;
  y: number;
};

type AutoNameDebugViewProps = {
  imageSize: number;
  imageUrl: string;
  markers: AutoNameDebugMarker[];
  onDismiss: () => void;
};

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function getMarkerPosition(marker: AutoNameDebugMarker, imageSize: number) {
  return {
    left: `${clampPercent((marker.x / imageSize) * 100)}%`,
    top: `${clampPercent((marker.y / imageSize) * 100)}%`,
  };
}

function getMarkerLabelPosition(marker: AutoNameDebugMarker, imageSize: number) {
  if (marker.x > imageSize * 0.72) {
    return "right-2";
  }

  return "left-2";
}

export function AutoNameDebugView({
  imageSize,
  imageUrl,
  markers,
  onDismiss,
}: AutoNameDebugViewProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto max-w-[calc(100vw-2rem)] rounded-md bg-neutral-950/90 p-2 shadow-xl ring-1 ring-white/20 backdrop-blur">
        <div className="mb-2 flex items-center justify-end">
          <button
            type="button"
            className="rounded-sm p-1 text-base text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Dismiss auto-name debug view"
            onClick={onDismiss}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
        <div className="relative aspect-square w-[min(72vw,72vh,520px)] overflow-hidden rounded-sm bg-neutral-200">
          <Image
            src={imageUrl}
            alt="Auto-name analysis"
            className="object-contain"
            fill
            sizes="520px"
            unoptimized
          />
          {markers.map((marker, index) => (
            <div
              key={`${marker.name}-${index}`}
              className="pointer-events-none absolute"
              style={getMarkerPosition(marker, imageSize)}
            >
              <span
                className={`absolute top-0 max-w-36 -translate-y-1/2 truncate rounded-sm bg-neutral-950/85 px-1.5 py-0.5 text-xs font-medium text-white shadow ${getMarkerLabelPosition(marker, imageSize)}`}
              >
                {marker.marker}: {marker.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
