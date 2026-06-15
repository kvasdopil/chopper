# Viewer Shell

Status: Draft (2026-06-15)

This spec defines viewer-level behavior that is not owned by one editing mode or tool.

Related documents:

- [Model viewer specs](index.md): Overview of the viewer surface and its feature split. Read this to choose the right mode or tool spec.
- [Object workflow](object-workflow.md): Object selection, visibility, and joining rules that the shell presents in the object panel.
- [Separation mode](separation-mode.md): The face-selection mode exposed from the viewer controls.
- [Edge-loop tool](edge-loop-tool.md): The generated-geometry tool whose state participates in restore, undo, and export.

## Model Loading

- The app displays a full-screen 3D viewport for `.glb` files.
- Loading a GLB normalizes the model to fit the viewport and frames the camera around it.
- Opening a new valid `.glb` replaces the current restorable model before parsing starts. If the new load fails, the previously loaded file must not return on the next browser refresh.
- Loading, restore, and save failures must not fail silently. User-facing failures update visible status where applicable and show transient feedback.

## Refresh Restore

- A browser refresh restores the active GLB and durable user edits when a restorable model exists.
- Durable edits include separated object membership, object names, hidden-object state, topology cuts, edited mesh positions, and edge-loop generation choices.
- Runtime-only viewport state is not restored. This includes camera position, viewport focus, hover state, selected items, in-progress separation state, progress text, and active adjustment handles.

## Undo

- Undo history exists only for the current page session.
- Loading a new file or reloading the page clears undo history.
- The undo button and `Command/Ctrl+Z` roll back one durable edit at a time.
- Undo covers object visibility changes, object name changes, separation actions, boundary-cut actions, and edge-loop generation mode, cone, offset, or normal-target changes.

## Export

- The top bar provides `Export GLB` when a model is loaded.
- Export creates a clean GLB containing each separated object as its own named mesh.
- Export preserves object labels and object colors.
- Generated cap, extrusion, and cylinder geometry is included with the matching object.
- Export excludes UI-only overlays such as wireframes, hover highlights, selection outlines, loose-edge overlays, and adjustment handles.
- Export includes hidden objects and hidden generated geometry because hidden state is a runtime view concern.
- Export should avoid producing degenerate faces in the resulting GLB.

## Texture Display

- A texture toggle appears next to the object panel when the loaded GLB contains base color texture maps.
- Textures are hidden by default.
- Texture visibility is runtime-only view state and is not restored after refresh.
- Showing textures uses the original base color maps while preserving object visibility and object-panel controls.

## Viewport Rendering

- Default faces are light gray.
- Separated objects use distinct pronounced colors.
- The viewer renders front-facing triangles only.
- Camera orbit rotates around the current focus point.
- Panning moves the current focus point.

## Feature Tools

- The viewer currently exposes separation mode and edge-loop generation as user-facing tools.
- Disabling a tool removes its controls and interaction behavior from the viewer.
