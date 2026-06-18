# Immutable Mesh Editor State

Status: Active (2026-06-17)

This ADR records the editor-state model used by the model viewer.

Related documents:

- [Model viewer specs](../spec/ui/model-viewer/index.md): Defines the viewer behavior that this architecture supports. Read this before changing user-facing mesh editing workflows.
- [Viewer shell](../spec/ui/model-viewer/viewer-shell.md): Defines load, restore, undo, and export behavior. Read this to understand persistence expectations.
- [Separation mode](../spec/ui/model-viewer/separation-mode.md): Defines linked-face selection and boundary-cut behavior. Read this before changing topology traversal.
- [Edge-loop tool](../spec/ui/model-viewer/edge-loop-tool.md): Defines loop generation behavior. Read this before changing loop metadata or generated geometry.

## Decision

The viewer treats loaded model geometry as immutable editor source data. Editing operations update compact metadata over the mesh instead of rewriting triangle positions:

- face-to-part membership is the source of truth for separated objects;
- edge-cut state is the source of truth for intentional topology splits;
- edge-loop ids and loop generation state are metadata derived from or attached to source edges;
- generated caps, extrusions, and cylinders remain derived geometry for display and export.

CPU-side topology remains authoritative for graph operations such as linked-face threshold selection, boundary-loop extraction, connected-component scans, loop discovery, cap generation, persistence, and export. Shaders and stable buffer attributes mirror editor state for rendering, selection masks, hidden/dimmed state, and boundary visualization.

## Rationale

The app rarely needs to modify model vertices. Most editor operations assign triangles to parts, hide parts, split traversal across selected edges, or create generated loop geometry. Keeping the source mesh stable avoids expensive geometry rebuilds and makes undo, refresh restore, and exported-editor metadata easier to reason about.

## Consequences

- Mesh loading builds a reusable numeric edit index for face and edge adjacency.
- Commands should mutate only the relevant metadata buffers and return inverse patches where practical.
- Export remains a bake step: GLB and 3MF output real mesh data for separated objects and generated loop geometry.
- Legacy persisted topology ids may still be restored, but new topology splits should prefer edge-cut metadata.
