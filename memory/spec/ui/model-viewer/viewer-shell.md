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
- Loading an exported playground GLB restores embedded editor metadata when present. Generated edge-loop groups or legacy generated loop meshes from that GLB are removed before editor overlays and generated geometry are rebuilt from metadata.
- Loading, restore, and save failures must not fail silently. User-facing failures update visible status where applicable and show transient feedback.
- The visible model status label is centered at the top of the viewport as bold text without a background card. Loaded `.glb` filenames display without the `.glb` extension.

## Refresh Restore

- A browser refresh restores the active GLB and durable user edits when a restorable model exists.
- Durable edits include separated object membership, object names, hidden-object state, topology cuts, edited mesh positions, and edge-loop generation choices.
- Local refresh persistence uses the same editor metadata payload as exported playground GLBs for object names, hidden-object state, next object id, and edge-loop generation choices, plus local mesh deltas for per-triangle membership, topology cuts, and edited positions.
- Runtime-only viewport state is not restored. This includes camera position, viewport focus, hover state, selected items, in-progress separation state, progress text, and active adjustment handles.
- Camera projection mode is runtime-only viewport state and is not restored after refresh.

## Undo

- Undo history exists only for the current page session.
- Loading a new file or reloading the page clears undo history.
- The undo button and `Command/Ctrl+Z` roll back one durable edit at a time.
- Undo covers object visibility changes, object name changes, separation actions, boundary-cut actions, and edge-loop generation mode, cone, offset, or normal-target changes.

## Export

- The top bar provides one export dropdown when a model is loaded. The dropdown menu offers `Export GLB` and `Export 3MF`.
- GLB export creates a clean GLB containing each separated object as its own named mesh.
- GLB export preserves object labels and object colors.
- Generated cap, extrusion, and cylinder geometry is included as real GLB mesh data in the parent object's mesh, not as separate object meshes.
- When an exported playground GLB is reopened for editing, generated mesh groups are stripped before editor overlays and generated geometry are rebuilt from metadata.
- GLB export embeds editor metadata for object identity, object names, hidden state, next object id, and edge-loop generation choices so the exported GLB can be reopened for editing.
- 3MF export creates a slicer-oriented 3MF package with generated loop geometry merged into each parent object.
- 3MF export places the exported mesh data on the build plate with the lowest Z coordinate at `0`.
- 3MF export should emit consistently wound, non-degenerate triangle shells so slicers can derive valid printable solids from triangle order.
- Exports exclude UI-only overlays such as hover highlights, selection outlines, loose-edge overlays, and adjustment handles.
- Exports include hidden objects and hidden generated geometry because hidden state is a runtime view concern.
- Exports should avoid producing degenerate faces.

## Texture Display

- A texture toggle appears to the right of the bottom-left camera toggle when the loaded GLB contains base color texture maps.
- Textures are hidden by default.
- Texture visibility is runtime-only view state and is not restored after refresh.
- Showing textures uses the original base color maps while preserving object visibility and object-panel controls.

## Viewport Rendering

- Default faces are light gray.
- Separated objects use distinct pronounced colors.
- The viewer renders front-facing triangles only.
- Camera orbit rotates around the current focus point.
- Panning moves the current focus point.
- A bottom-left viewport cube controls camera orientation.
- A bottom-left camera toggle switches the active viewport between perspective and orthographic projection.

## Feature Tools

- The viewer currently exposes separation mode and edge-loop generation as user-facing tools.
- Disabling a tool removes its controls and interaction behavior from the viewer.
