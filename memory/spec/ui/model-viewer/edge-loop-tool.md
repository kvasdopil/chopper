# Edge-Loop Tool

Status: Draft (2026-06-15)

This spec defines loose-edge contact-span selection and generated cap, extrusion, and cylinder behavior.

Related documents:

- [Model viewer specs](index.md): Overview of the viewer surface and its feature split. Read this to understand how the edge-loop tool relates to the viewer shell.
- [Viewer shell](viewer-shell.md): Restore, undo, export, and viewport behavior that includes generated edge-loop geometry.
- [Object workflow](object-workflow.md): Object visibility and focus behavior used by edge-loop selection.
- [Separation mode](separation-mode.md): Mode that suppresses loose-edge contact-span hover while linked-face selection is active.

## Loose Edges

- Loose edges render only for the currently selected object.
- A loose edge is an edge connected to exactly one triangle within the visible object.
- Loose edges render above other edge overlays.
- Unobstructed loose edges render as thick lines.
- Obstructed loose edges render as thinner lines.
- Loose-edge contact spans with no generated geometry state render red.
- Contact spans with generated cap, extrusion, or cylinder state render green.
- Matching boundary spans that share generated-geometry state also render green so paired or visually matching boundaries communicate the same state.

## Contact-Span Selection

- Hovering near an unobstructed loose edge on any visible submesh highlights that edge's connected contact span in yellow.
- Loose-edge segments that are not part of a valid contact span remain outside hover, selection, and generation.
- Clicking a hovered contact span selects it and clears active mesh/object selection.
- A selected contact span remains highlighted in yellow.
- Contact-span hover works on any visible submesh, even when loose-edge lines are visible only for the currently selected object.
- Shift-click does not select contact spans.
- Contact-span hover is suppressed while separation mode is active.

## Generation Controls

- When a contact span is selected, the loop panel appears below the load/status controls.
- The default loop mode is `None`.
- The panel exposes three controls:
  - `Mode`: `N`, `Cap`, `Ex`, or `Cyl`.
  - `Axis`: `X`, `Y`, `Z`, or `N`.
  - `Cone`: enabled for extrusion and cylinder modes.
- Axis is enabled only for extrusion and cylinder modes.
- `Cap` maps to filled-cap generation.

## Filled Caps

- Filled-cap mode creates temporary cap geometry from the selected contact span.
- If a selected span is open, generation uses a virtual closing segment without changing source mesh topology.
- Filled caps use the parent object's face color.
- Filled caps do not appear as objects in the object list.
- Filled caps remain visible after loop selection is cleared and follow the parent object's visibility.

## Extrusions

- Extrusion modes extend the selected span along the signed X, Y, Z, or loop-normal axis.
- The default extrusion length follows the parent object's size along the active axis, with a small loop-sized fallback when that size is degenerate.
- Extrusion creates side walls and an end cap perpendicular to the active axis.
- Cone-enabled extrusion slopes from the original loop to a smaller end ring before the end cap.
- Extrusions use the parent object's face color, do not appear in the object list, remain after loop selection is cleared, and follow parent visibility.

## Cylinders

- Cylinder modes create loop-shaped cylinder geometry along the signed X, Y, Z, or loop-normal axis.
- The base ring is scaled inward around the loop center before being extended along the active axis.
- Cylinder generation adds a flat end cap.
- Cone-enabled cylinders slope from the original loop toward the scaled ring before continuing straight.
- Cylinders use the parent object's face color, do not appear in the object list, remain after loop selection is cleared, and follow parent visibility.

## Paired Boundaries

- If a selected contact span has exactly one matching span on another object with the same visual boundary, the two spans are edited as one paired boundary.
- Changing mode, cone, offset, or normal target on either side updates generated geometry for both objects.
- Each object still owns its own generated geometry for visibility and export.
- Paired fixed-axis edits use the same signed X, Y, or Z axis on both objects rather than reorienting per object.
- Paired normal-axis edits copy the selected loop target's world-space displacement so both visible caps use the same length.

## Viewport Adjustment

- Extrusion and cylinder modes store a signed offset along the active axis.
- Filled-cap mode has no offset handle.
- Fixed-axis extrusion and cylinder modes show a draggable viewport arrow on the signed offset side.
- Normal-axis extrusion and cylinder modes show a three-axis translate handle at the normal-axis target.
- Dragging an adjustment handle updates the stored offset or normal target and regenerates the selected loop geometry.
- The normal-axis target is initialized once when a loop first enters a normal-axis extrusion or cylinder mode.
- After initialization, the normal-axis offset is the direct distance from the loop center to the stored target point and is not clamped by object geometry.
- After the normal-axis target is moved, switching away from a normal axis and back restores the remembered target instead of recalculating it.
- Dragging outside adjustment handles preserves normal camera orbit and pan behavior.

## Generated-Geometry Display

- Generated cap, extrusion, and cylinder geometry is visible from both sides.
- When an object or contact span is selected, visible generated geometry remains opaque where unobstructed and shows model-obstructed fragments as a translucent overlay.
- Existing loop-generation choices survive topology refresh when the same boundary can still be identified.
- Rebuilding loose-edge groups alone must not create generated geometry for loops whose mode is still `None`.
