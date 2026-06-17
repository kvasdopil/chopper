import { useState } from "react";
import type { KeyboardEvent } from "react";
import { LuEye, LuEyeOff, LuMerge } from "react-icons/lu";

import type { SeparatedObjectSummary } from "./types";

type ObjectsPanelProps = {
  objects: SeparatedObjectSummary[];
  onJoinSelectedObjects: () => void;
  onRenameObject: (objectId: number, name: string) => void;
  onSelectObject: (objectId: number, additive?: boolean) => void;
  onToggleVisibility: (objectId: number) => void;
  selectedObjectIds: Set<number>;
};

export function ObjectsPanel({
  objects,
  onJoinSelectedObjects,
  onRenameObject,
  onSelectObject,
  onToggleVisibility,
  selectedObjectIds,
}: ObjectsPanelProps) {
  const [draftName, setDraftName] = useState("");
  const [editingObjectId, setEditingObjectId] = useState<number | null>(null);

  if (objects.length === 0) {
    return null;
  }

  const startEdit = (object: SeparatedObjectSummary) => {
    setEditingObjectId(object.id);
    setDraftName(object.label);
  };

  const commitEdit = () => {
    if (editingObjectId == null) {
      return;
    }

    onRenameObject(editingObjectId, draftName);
    setEditingObjectId(null);
    setDraftName("");
  };

  const cancelEdit = () => {
    setEditingObjectId(null);
    setDraftName("");
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className="pointer-events-auto absolute top-4 right-4 w-56 max-w-[calc(100vw-2rem)] rounded-md bg-white/85 px-3 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate">Objects</span>
        <div className="flex items-center gap-2">
          {selectedObjectIds.size >= 2 ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-sm bg-neutral-950 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
              onClick={(event) => {
                event.stopPropagation();
                onJoinSelectedObjects();
              }}
            >
              <LuMerge aria-hidden="true" className="text-sm" />
              Join
            </button>
          ) : null}
          <span className="text-xs text-neutral-500 tabular-nums">{objects.length}</span>
        </div>
      </div>
      <div className="max-h-56 space-y-1 overflow-auto pr-1">
        {objects.map((object) => {
          const isSelected = selectedObjectIds.has(object.id);
          const isEditing = object.id === editingObjectId;

          return (
            <div
              key={object.id}
              className={`flex items-center justify-between gap-2 rounded-sm px-1 py-0.5 transition ${
                isSelected ? "bg-yellow-300/45 ring-1 ring-yellow-500/50" : ""
              } ${object.visible ? "" : "opacity-60"}`}
              onClick={(event) => onSelectObject(object.id, event.shiftKey)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-neutral-400/60"
                  style={{ backgroundColor: object.color }}
                />
                {isEditing ? (
                  <input
                    type="text"
                    className="min-w-0 flex-1 rounded-sm bg-white px-1 py-0.5 text-sm text-neutral-900 shadow-sm ring-1 ring-yellow-500 focus:outline-none"
                    value={draftName}
                    autoFocus
                    onBlur={commitEdit}
                    onChange={(event) => setDraftName(event.currentTarget.value)}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={handleEditKeyDown}
                    onKeyUp={(event) => event.stopPropagation()}
                  />
                ) : (
                  <span
                    className="truncate"
                    title={object.label}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      startEdit(object);
                    }}
                  >
                    {object.label}
                  </span>
                )}
              </div>
              <span className="text-xs text-neutral-500 tabular-nums">{object.triangleCount}</span>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-base text-neutral-500 transition hover:bg-neutral-950/10 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
                aria-label={`${object.visible ? "Hide" : "Show"} ${object.label}`}
                aria-pressed={!object.visible}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisibility(object.id);
                }}
              >
                {object.visible ? <LuEye aria-hidden="true" /> : <LuEyeOff aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
