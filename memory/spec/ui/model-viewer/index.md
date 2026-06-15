# Model Viewer Specs

Status: Draft (2026-06-15)

This section defines the stable user-facing behavior of the GLB model viewer. The viewer is documented as a product surface with separate mode and tool specs, not as a source-code inventory.

Related documents:

- [UI specs index](../index.md): Parent catalog for UI behavior. Read this to navigate other interface specifications.
- [Specifications index](../../index.md): Parent catalog for all normative requirements. Read this when deciding whether a rule belongs in UI, domain, project, or testing docs.
- [Memory Bank principles](../../../mbb/principles.md): Governance for single-source-of-truth documentation. Read this before adding or splitting viewer specs.
- [Viewer shell](viewer-shell.md): Loading, restore, viewport, undo, export, texture display, and failure behavior. Read this before changing the viewer-level experience.
- [Object workflow](object-workflow.md): Object identity, selection, naming, visibility, multi-selection, and join behavior. Read this before changing object-list or object-selection behavior.
- [Separation mode](separation-mode.md): Linked-face selection, threshold graph behavior, applying separations, and boundary cuts. Read this before changing separation workflows.
- [Edge-loop tool](edge-loop-tool.md): Loose-edge contact spans, cap/extrusion/cylinder generation, paired-boundary edits, and viewport adjustment behavior. Read this before changing loop-generation tools.

## Feature Map

- The viewer shell owns the loaded-model lifecycle and global viewport controls.
- The object workflow owns how mesh regions become named, selectable, hideable objects.
- Separation mode owns flat-face selection and object extraction from an existing object.
- The edge-loop tool owns loose-edge boundary selection and generated cap, extrusion, or cylinder geometry.

## Documentation Boundaries

- Specs describe behavior, constraints, and durable contracts.
- ADRs describe why stable product or architecture decisions were made.
- Plans describe delivery sequencing and verification expectations.
- Code remains the source of truth for component names, module names, function names, library calls, and implementation algorithms.
