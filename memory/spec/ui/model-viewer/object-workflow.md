# Object Workflow

Status: Draft (2026-06-15)

This spec defines how users select, name, hide, and join objects inside the model viewer.

Related documents:

- [Model viewer specs](index.md): Overview of the viewer surface and its feature split. Read this to understand how object workflow relates to modes and tools.
- [Viewer shell](viewer-shell.md): Global loading, restore, undo, export, texture, and viewport behavior.
- [Separation mode](separation-mode.md): Mode that creates new objects from linked-face selections.
- [Edge-loop tool](edge-loop-tool.md): Tool whose loop selection temporarily focuses a parent object without making it the active object selection.

## Object Identity

- Every triangle belongs to an editable object.
- A newly loaded model starts with a default object labeled `Default` unless the object is renamed.
- Object names may be edited inline from the object list.
- Clearing an inline object name removes the custom name and restores the generated default label.
- Object rows show a red bullet before the triangle count when that object has at least one unclosed loose-edge loop.
- Object names participate in refresh restore, undo, and export.

## Automatic Naming

- The object list exposes an auto-name action for local development builds.
- Auto naming captures a clean square PNG of the visible model in normal mode without UI selection, split-mode overlays, or viewport controls.
- The capture uses the current camera view rendered through an orthographic projection and fitted to the visible model bounds with minimal empty margin.
- The capture includes one color-matched circular letter marker for each visible object.
- The backend image analysis endpoint returns structured marker-to-name candidates.
- The viewer maps returned marker letters back to visible object ids before applying names.
- Auto naming only updates generated/default labels such as `Default` or `Object N`; user-edited names are preserved.
- Labels matching generated/default names remain auto-name eligible even if the label text was typed manually.
- Auto-applied names are camelCase, unique within the current object name map, undoable, and persisted through the same object-name state as inline edits.
- While auto naming is in progress, the object-list action shows progress and can be cancelled.
- If auto naming is started with Shift, Ctrl, or Cmd-click, a dismissible debug view appears after a successful image-analysis response with the submitted PNG and every returned marker-name pair rendered beside its marker.

## Selection

- Clicking an object row selects that object and highlights the row.
- Clicking a mesh face selects the face's object.
- Shift-clicking additional mesh faces or object rows adds their objects to a multi-selection.
- The most recently clicked object is the primary object for workflows that need one focused object.
- Clicking the background clears object selection.
- Mesh/object selection and edge-loop selection are mutually exclusive.
- Selecting a mesh/object clears edge-loop selection.
- Selecting one or more edge loops clears active mesh/object selection but highlights each selected loop's parent object row as contextual focus.

## Joining Objects

- When two or more objects are selected, the object list shows `Join`.
- Join merges each selected group that is connected by at least one shared positional edge.
- The primary selected object is the merge target for its connected group.
- Disconnected selected objects remain unchanged.
- Join reconnects the shared boundary so the joined region behaves as one object.
- Join is undoable.

## Visibility

- The eye control toggles object visibility.
- Hidden objects do not render faces, outlines, loose-edge lines, generated edge-loop geometry, or participate in pointer picking.
- Visibility toggles update material display state and object-list visibility metadata without rebuilding mesh material groups, repainting the full color buffer, or copying mesh buffers into undo history.
- Pressing `h` hides all selected objects.
- Pressing `Option+H` or `Command+H` unhides all objects when the browser receives the event.
- Viewer hotkeys are ignored while the active target is an editable text field or content-editable area.

## Focus Outlines

- Visible non-focused objects render a light gray outline.
- Selected objects render a yellow outline.
- The parent object of each selected edge loop is treated as focused, so it does not also receive the non-focused outline.
