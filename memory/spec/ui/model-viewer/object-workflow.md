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
- Object names participate in refresh restore, undo, and export.

## Selection

- Clicking an object row selects that object and highlights the row.
- Clicking a mesh face selects the face's object.
- Shift-clicking additional mesh faces or object rows adds their objects to a multi-selection.
- The most recently clicked object is the primary object for workflows that need one focused object.
- Clicking the background clears object selection.
- Mesh/object selection and edge-loop selection are mutually exclusive.
- Selecting a mesh/object clears edge-loop selection.
- Selecting an edge loop clears active mesh/object selection but highlights the loop's parent object row as contextual focus.

## Joining Objects

- When two or more objects are selected, the object list shows `Join`.
- Join merges each selected group that is connected by at least one shared positional edge.
- The primary selected object is the merge target for its connected group.
- Disconnected selected objects remain unchanged.
- Join reconnects the shared boundary so the joined region behaves as one object.
- Join is undoable.

## Visibility

- The eye control toggles object visibility.
- Hidden objects do not render faces, outlines, wireframes, loose-edge lines, generated edge-loop geometry, or participate in pointer picking.
- Pressing `h` hides all selected objects.
- Pressing `Option+H` or `Command+H` unhides all objects when the browser receives the event.
- Viewer hotkeys are ignored while the active target is an editable text field or content-editable area.

## Focus Outlines

- Visible non-focused objects render a light gray outline.
- Selected objects render a yellow outline.
- The parent object of a selected edge loop is treated as focused, so it does not also receive the non-focused outline.
