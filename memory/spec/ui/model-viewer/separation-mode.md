# Separation Mode

Status: Draft (2026-06-15)

This spec defines linked-face selection and object separation behavior.

Related documents:

- [Model viewer specs](index.md): Overview of the viewer surface and its feature split. Read this to understand how separation fits with other tools.
- [Object workflow](object-workflow.md): Object selection and visibility rules used by separation mode.
- [Edge-loop tool](edge-loop-tool.md): Loose-edge generation behavior that is suppressed while separation mode is active.

## Entering The Mode

- The separate control is shown only when an object is selected.
- Entering separation mode without a selected polygon shows a `select a starting point` prompt.
- While separation mode is active, the viewport uses a crosshair cursor.
- Entering separation mode saves the current camera state, then flies the camera to center and frame the selected object.
- Exiting separation mode restores the saved camera state.
- While separation mode is active, objects other than the selected object render at `30%` opacity.
- Separation mode exits when object selection is cleared.

## Linked-Face Selection

- In separation mode, clicking a face on the selected object creates a linked flat-face selection seeded by that face.
- Clicking a face on another object selects that other object instead of starting separation.
- The seed triangle is always included in the selection.
- Selection expands across adjacent triangles while their shared-edge normal angle is within the active threshold.
- The seed-region fill renders as a deep-blue-to-green-to-red threshold gradient without a yellow line overlay.
- Fill colors map directly to the graph position: `0%` is deep blue, `50%` is green, and `100%` is red.
- Changing the graph threshold does not change the fill colors; it recalculates the current selection and the red boundary-loop lines.
- Moving the graph marker reuses the cached threshold graph and does not recompute topology or repaint the stable fill.
- Background clicks clear the linked-face selection and selected object row.

## Threshold Graph

- The linked-face panel displays selected polygon count by threshold in `0.1` degree intervals.
- The graph is the threshold control.
- Clicking the graph maps the horizontal click position to the nearest `0.1` degree threshold and recalculates the linked-face selection.
- A separate slider for threshold control is intentionally absent.

## Boundary Cuts

- While a separate-mode mask is visible, newly separable boundary edge loops render in red and are hoverable.
- Existing loose-edge contact spans are not hoverable while separation mode is active.
- Hovering a separable boundary loop highlights the whole loop in blue.
- Clicking a hovered boundary loop cuts through that boundary without moving visible vertices or assigning the whole selected mask to a new object.
- Boundary-loop cuts are represented as edge-cut metadata over the source mesh; they affect topology traversal and loose-edge discovery without changing triangle positions.
- After a boundary-loop cut, object colors and the object list refresh immediately. The linked-face selection is rebuilt from the same seed triangle when possible so additional boundary loops can be clicked without reselecting the face region.
- When the linked-face selection is rebuilt after a boundary-loop cut, the stable threshold-gradient fill is restored from the rebuilt cache.
- After a boundary cut, separable loose components created by the cut become independent objects according to the loose-component rules.
- A selected cut-created contact span can be removed from the edge-loop panel after confirmation. Removal clears the cut metadata and joins the adjacent cut-created object back into the selected object when object ids on both sides keep the loop visible.

## Applying Separation

- `Apply` moves the current linked-face selection into a new object.
- After separation, both the source object and the new object are checked for loose connected components.
- Loose components with fewer than `10` triangles stay merged into their current parent object.
- Loose components with `10` or more triangles become independent objects.
- Separation clears the linked-face overlay and refreshes object colors and the object list.
- Long-running separation work shows progress feedback.
