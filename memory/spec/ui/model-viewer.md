# Model Viewer

Status: Draft (2026-06-07)

This document is the canonical UI spec for the GLB model viewer. It captures the user-facing behavior, geometry rules, controls, and current function inventory so future changes preserve the intended workflows.

Related documents:

- [UI specs index](index.md): Parent catalog for viewer UI requirements. Read this to find other UI-facing specifications.
- [Specifications index](../index.md): Parent catalog for all normative requirements. Read this when deciding whether a rule belongs in UI, domain, project, or testing docs.
- [Memory Bank principles](../../mbb/principles.md): Governance for single-source-of-truth documentation. Read this before splitting or duplicating viewer behavior.
- [Viewer page code](../../../src/app/page.tsx): Current implementation of geometry, selection, separation, and viewport state. Use this as the source of truth for implementation details.
- [Viewer controls](../../../src/app/viewer-controls): Current TSX control components for the load/status bar, object list, and linked-face panel. Use this when changing UI presentation.

## Viewer Requirements

- The app displays a full-screen Three.js viewport for `.glb` files.
- Loading a GLB normalizes the model to fit the viewer and frames the camera around the model.
- The viewer renders front-facing triangles only.
- Default faces are light gray; separated objects use distinct pronounced colors.
- Wireframes are thin, dark gray, nearly transparent line segments.
- Hidden objects must not render faces or wireframe lines and must be excluded from pointer picking.
- Camera orbit uses `OrbitControls`; panning moves the current focus point and rotation stays around that focus.
- The viewer does not own a dev-server lifecycle in documentation or code workflows; the user launches the server when needed.

## Object Workflow

- Every triangle belongs to an object ID.
- Object `0` is the default object and is labeled `Default` unless renamed.
- Object names may be edited inline from the object list.
- Clicking an object row selects that object and highlights the row.
- Clicking a triangle selects a linked-face region and also selects the corresponding object row.
- The eye icon toggles object visibility.
- Pressing `h` hides the currently selected object.
- Pressing `Option+H` or `Command+H` unhides all objects when the browser receives the event.

## Linked-Face Selection

- Clicking a triangle creates a linked flat-face selection seeded by that triangle.
- The seed triangle is always included in the selection.
- Selection expands across adjacent triangles while the edge normal angle is within the active threshold.
- Selected faces and their boundary lines render in yellow.
- The linked-face panel displays a graph of selected polygon count by threshold in `0.1` degree intervals.
- The graph is clickable. Clicking maps the horizontal click position to the nearest `0.1` degree threshold and recalculates the linked-face selection.
- The old threshold slider is intentionally absent because the graph is the threshold control.
- Background clicks clear the linked-face selection and the selected object row.

## Separation

- `Separate` moves the current linked-face selection into a new object ID.
- After separation, both the source object and new object are scanned for loose connected components.
- Loose components with fewer than `10` triangles stay merged into their current parent object.
- Loose components with `10` or more triangles are assigned new object IDs.
- Separation clears the linked-face overlay and refreshes object colors, material groups, wireframes, and the object list.

## Edge Editing

- Holding `Shift` while hovering an edge highlights that edge in yellow at `2px`.
- Clicking a highlighted edge attempts to swap the diagonal between the two adjacent triangles.
- A diagonal swap is only valid when exactly two adjacent triangles share the edge and both triangles belong to the same object.
- After a successful swap, geometry bounds, vertex normals, object colors, and wireframes are refreshed.

## Function Inventory

This inventory describes responsibilities, not implementation details. Code remains the source of truth for exact algorithms.

### Viewer Page Utilities

- `isMesh`: narrows Three.js objects to mesh instances.
- `isDisposableDrawObject`: identifies scene objects that own disposable geometry and material resources.
- `disposeMaterial`: disposes one material or a material array.
- `disposeObject`: disposes all geometries and materials reachable from an object.
- `clearModel`: removes and disposes all loaded model children from the root group.
- `getVertexKey`: converts a vertex position into a stable precision-rounded topology key.
- `getSeparatedObjectColor`: returns the display color for an object ID.
- `getSeparatedObjectColorCss`: returns the CSS hex color for an object ID.
- `getDefaultSeparatedObjectLabel`: returns the default user-facing object label.
- `getSeparatedObjectLabel`: resolves a custom object name or the default label.
- `getTriangleObjectIds`: gets or initializes per-triangle object IDs on mesh geometry.
- `collectSeparatedObjects`: builds the object list summary from current mesh object IDs, hidden IDs, and custom names.
- `getTriangleEdges`: builds edge-to-face topology and per-triangle edge keys.
- `getSignedEdgeNormalAngle`: computes signed normal angle for an edge shared by one or more faces.
- `getEdgeNormalAngle`: returns the absolute normal angle for an edge.
- `createFaceMaterial`: creates the front-side vertex-color material used for object faces.
- `refreshMeshObjectMaterialGroups`: rebuilds geometry groups and material visibility by object ID.
- `refreshObjectMaterialGroups`: refreshes material groups for all selectable meshes in a model.
- `styleModel`: converts meshes to non-indexed geometry, initializes colors/object IDs, materials, wireframes, and hover overlays.
- `createObjectWireframeGeometry`: builds visible-object wireframe line segments from triangle positions.
- `refreshObjectWireframe`: rebuilds one mesh wireframe after visibility or geometry changes.
- `refreshObjectWireframes`: rebuilds wireframes for all selectable meshes in a model.
- `colorTriangle`: writes one color to the three vertices of a triangle.
- `getTriangleVertices`: returns keyed vertices for a triangle start index.
- `getTriangleNormal`: computes a triangle normal from three vertices.
- `orientTriangle`: flips triangle winding when needed to match a reference normal.
- `setTrianglePositions`: writes three vertices back into a geometry position buffer.
- `getTriangleEdgeKeys`: returns the three stable edge keys for a triangle.
- `getTriangleEdgeFace`: returns edge direction and triangle normal for one edge.
- `createHoverEdgeGeometry`: creates the line geometry for the hovered-edge overlay.
- `clearHoverEdgeOverlay`: hides the current hover-edge overlay.
- `setHoverEdgeOverlay`: updates and shows the hover-edge overlay.
- `updateHoverEdgeResolution`: updates fat-line material resolution for hover and linked-face overlays.
- `getHoveredEdgeFromHit`: resolves the closest triangle edge from a raycast hit.
- `swapHoveredEdgeDiagonal`: swaps the diagonal for a valid pair of adjacent same-object triangles.
- `buildMeshTopology`: builds triangle and edge adjacency for a mesh.
- `getTopologyEdgeNormalAngle`: computes an edge normal angle from mesh topology and optional object filtering.
- `getObjectConnectedComponents`: finds connected triangle components for one object ID.
- `separateLooseObjectParts`: splits loose connected components into new object IDs, except components under `10` triangles.
- `buildLinkedFaceSelection`: computes a threshold-based linked flat-face selection from a seed triangle.
- `findLinkedFaceGraphParent`: finds a union-find parent while building the threshold graph cache.
- `unionLinkedFaceCacheTriangles`: unions two connected triangle sets and records threshold entry values.
- `buildLinkedFaceSelectionCache`: precomputes selected-count data for graph-driven threshold changes.
- `createLinkedFaceSelectionFromCache`: rebuilds a linked-face selection from cached threshold values.
- `applyLinkedFaceSelectionColors`: colors selected triangles yellow.
- `createLinkedFaceSelectionOverlay`: creates the yellow line overlay for selected triangles.
- `applyObjectColors`: colors mesh triangles by object ID, respecting hidden objects.
- `getPointFromVertexKey`: reconstructs a point from a topology key.
- `normalizeModel`: scales and centers a loaded model into the target viewer size.
- `frameModel`: places the camera and orbit target around the loaded model.
- `isSelectableMesh`: excludes overlay meshes from picking and topology operations.

### Viewer Page State Handlers

- `Home`: owns the Three.js scene, model state, selection state, and control props.
- `clearLinkedFaceSelectionOverlay`: removes the linked-face line overlay.
- `applyLinkedFaceSelectionVisuals`: reapplies object colors and selected-face overlays.
- `clearLinkedFaceSelection`: clears linked-face selection and optionally clears selected object state.
- `refreshLinkedFaceSelection`: recalculates selection at a committed threshold.
- `commitLinkedFaceSelectionThreshold`: commits a graph-selected threshold if it changed.
- `selectLinkedFace`: seeds linked-face selection from a clicked triangle.
- `refreshSeparatedObjects`: rebuilds the object list from current geometry state.
- `applyObjectVisibility`: applies hidden object IDs to faces, wireframes, picking state, and object summaries.
- `toggleObjectVisibility`: toggles one object's hidden state.
- `hideSelectedObject`: hides the selected object from the list or active linked-face selection.
- `showAllObjects`: clears all hidden object IDs.
- `selectSeparatedObject`: selects an object row and clears linked-face selection while keeping object selection.
- `renameSeparatedObject`: saves or clears a custom object name.
- `handleSeparateSelection`: separates the active linked-face selection and refreshes model/object state.
- `clearHoveredEdge`: hides any active hover-edge overlay.
- `getMeshHitAtPointer`: raycasts visible selectable mesh faces.
- `getEdgeAtPointer`: resolves the hovered edge at a pointer position.
- `getTriangleAtPointer`: resolves the clicked triangle at a pointer position.
- `handlePointerDown`: starts click tracking and optional shift-edge hover selection.
- `handlePointerUp`: selects triangles, clears background selection, or swaps a shift-clicked edge.
- `handlePointerMove`: updates shift-hovered edge highlighting.
- `handlePointerLeave`: clears hover-edge state.
- `handleKeyUp`: clears hover-edge state when Shift is released.
- `handleKeyDown`: handles `h`, `Option+H`, and `Command+H` visibility shortcuts.
- `handleResize`: keeps renderer, camera, and fat-line resolutions in sync with viewport size.
- `render`: runs the animation frame loop.
- `handleFileChange`: validates and loads `.glb` files, resets viewer state, styles the model, and frames the camera.

### Control Components

- `TopBar`: renders the hidden GLB file input, load button, and load/status text.
- `ObjectsPanel`: renders object summaries, selection highlighting, visibility toggles, and inline name editing.
- `LinkedFaceSelectionPanel`: renders selection count, clickable threshold graph, and `Separate`/`Clear` actions.

### Control Component Helpers

- `formatAngle`: formats integer and decimal threshold values.
- `getGraphPoint`: maps graph count data to SVG coordinates.
- `getGraphPoints`: serializes graph points for the SVG polyline.
- `getGraphMarker`: maps the active threshold to the SVG marker position.
- `getClickedGraphThreshold`: maps a graph click to the nearest threshold interval.
- `startEdit`: starts inline object-name editing.
- `commitEdit`: saves the inline object-name edit.
- `cancelEdit`: exits inline name editing without saving.
- `handleEditKeyDown`: handles Enter and Escape in inline name editing.
