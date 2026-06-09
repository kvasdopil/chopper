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
- Loose edges render only for the currently selected object. They are defined as edges connected to exactly one triangle within that visible object and render above other edge overlays. Unobstructed loose edges render as thick red `3px` lines; obstructed loose edges render as thinner red `1px` lines.
- Hovering within `5px` of an unobstructed loose edge on any visible submesh temporarily highlights that edge's connected loose-edge loop with a pronounced blue `4px` UI overlay rendered above model geometry. Loose-edge loops are precomputed when the loose-edge overlay is rebuilt, and hover uses the cached loop positions without rebuilding topology.
- Clicking a hovered loose-edge loop selects that loop, clears any selected mesh/object state, and displays it with the same pronounced UI overlay in yellow. Loose-edge loop hover and selection work on any visible submesh, even when the red loose-edge overlay is only visible for the currently selected object.
- When a loose-edge loop is selected, the loop panel appears. Cap/extrusion mode is stored per loose-edge loop. The default mode is `None`. `Filled` mode creates an ephemeral, non-selectable cap mesh from the loop's unique points plus a center point, with triangles from the center to each loop segment. `Ex. X`, `Ex. Y`, `Ex. Z`, and `Ex. N` create ephemeral, non-selectable extrusions from the loop along the signed local X, Y, Z, or loop-normal axis, using an extrusion length equal to the parent object's projected size along that axis, then add an end cap perpendicular to the extrusion axis. `Cyl. X`, `Cyl. Y`, `Cyl. Z`, and `Cyl. N` create the same simple cap plus a 16-sided cylinder centered on the loop center and oriented along the matching X, Y, Z, or loop-normal axis. Cylinder radius is `80%` of the minimum distance from the loop center to a loop vertex. Cap, extrusion, and cylinder triangles are wound so their front faces point outside the parent object, but generated materials render double-sided so incorrect normals do not hide the generated faces. Generated caps/extrusions/cylinders use the parent object's face color, do not appear in the object list, remain visible after loop selection is cleared, and follow the parent object's visibility.
- When any object or loose-edge loop is selected, visible generated cap/extrusion/cylinder meshes keep their normal opaque rendering for unobstructed fragments and add a shared-geometry occlusion overlay for obstructed fragments. The occlusion overlay renders at `30%` opacity, uses a greater-depth test, and skips pixels already marked by the generated mesh stencil so only model-obstructed fragments show through. This is a material/render-state change only; generated geometry is not rebuilt for overlay display.
- Each cap/extrusion/cylinder stores a per-loop offset along its active cap axis. `Filled` stays at offset `0` along the loop normal and does not display a viewport gizmo; extrusion and cylinder modes default to the object projected size along the selected axis, falling back to a small loop-sized offset when that projection is degenerate. While the loop is selected and its cap mode is `Ex. X`, `Ex. Y`, `Ex. Z`, `Cyl. X`, `Cyl. Y`, or `Cyl. Z`, a non-selectable `THREE.ArrowHelper` viewport gizmo appears on the cap axis. Dragging within `10px` of the visible arrow updates the stored offset and regenerates that loop's generated mesh; dragging elsewhere keeps camera orbit/pan behavior. For `Ex. N` and `Cyl. N`, a standard three-axis `TransformControls` translate gizmo appears at the normal-axis target instead; the axis points from the loop centroid toward that target, defaults to the loop normal, and updates as the target is moved along any world axis.
- The loop panel is positioned at the top-left below the load/status controls. It presents loop generation as two controls: `Mode` (`None`, `Cap`, `Extrude`, `Cylinder`) and `Axis` (`X`, `Y`, `Z`, `Normal`). Axis is enabled only for `Extrude` and `Cylinder`; `Cap` maps to the simple filled-cap mode.
- Rebuilding loose-edge groups after mesh topology changes updates cap/extrusion state by stable loop segment keys. Cap/extrusion meshes are computed lazily only when the user selects a non-`None` loop mode; grouping loose edges must not eagerly create cap/extrusion meshes.
- Hidden objects must not render faces, wireframe lines, or loose-edge lines and must be excluded from pointer picking.
- Camera orbit uses `OrbitControls`; panning moves the current focus point and rotation stays around that focus.
- The viewer does not own a dev-server lifecycle in documentation or code workflows; the user launches the server when needed.

## Object Workflow

- Every triangle belongs to an object ID.
- Object `0` is the default object and is labeled `Default` unless renamed.
- Object names may be edited inline from the object list.
- Clicking an object row selects that object and highlights the row.
- Clicking a mesh face selects that face's object row. It does not start separation unless separate mode is already active for that object.
- Clicking a mesh face remembers that triangle as the selected object's latest separation origin. If the user later toggles separate mode for the same object and the triangle still belongs to it, linked-face selection starts from that remembered triangle.
- Clicking the already selected object outside separate mode must not recalculate linked-face selection or rebuild loose-edge topology.
- Selecting a different mesh/object must use cached geometry data where possible. Plain object selection must not recolor all faces or rebuild loose-edge topology; face colors are refreshed only when clearing an active linked-face mask, and loose-edge rendering uses per-object cached line data.
- The currently selected object renders a thin yellow `2px` screen-space silhouette outline around the outside contour, including closed meshes that have no open boundary edges. The viewer renders the normal scene first, then uses shared-geometry shader passes: a visible-surface stencil mask for the focused object, followed by a clip-space expanded outline pass that depth-tests behind the focused model surface and is masked out over the focused object's visible face area.
- Mesh/object selection and loop selection are mutually exclusive: selecting a mesh/object clears loop selection, and selecting a loop clears mesh/object selection.
- Clicking a triangle, clicking background, or selecting an object row clears loose-edge loop selection.
- The eye icon toggles object visibility.
- Pressing `h` hides the currently selected object.
- Pressing `Option+H` or `Command+H` unhides all objects when the browser receives the event.

## Separate Mode

- The separate button is shown only when an object is selected.
- Toggling the separate button enters separate mode. With no polygon selected, the panel shows `select a starting point`.
- While separate mode is active, the 3D viewport uses a crosshair cursor.
- In separate mode, clicking a face on the selected object creates a linked flat-face selection seeded by that face.
- Clicking a face on any other object selects that object instead of starting separation.
- The seed triangle is always included in the selection.
- Selection expands across adjacent triangles while the edge normal angle is within the active threshold.
- Selected faces and their boundary lines render in yellow.
- While a separate-mode mask is visible, separable boundary edge loops render in red and are hoverable. A separable boundary edge must have exactly two connected triangles, with one triangle inside the mask and one outside it. Hovering a boundary loop highlights the whole loop in blue.
- Clicking a hovered mask boundary loop cuts topology through that boundary loop without moving visible vertices or assigning the whole selected mask to a new object. After the cut, the affected object is scanned for loose connected components and any separable loose components are isolated into object IDs.
- The linked-face panel displays a graph of selected polygon count by threshold in `0.1` degree intervals.
- The graph is clickable. Clicking maps the horizontal click position to the nearest `0.1` degree threshold and recalculates the linked-face selection.
- The old threshold slider is intentionally absent because the graph is the threshold control.
- Background clicks clear the linked-face selection and the selected object row.
- Separate mode exits when object selection is cleared.

## Separation

- `Apply` in separate mode moves the current linked-face selection into a new object ID.
- After separation, both the source object and new object are scanned for loose connected components.
- Loose components with fewer than `10` triangles stay merged into their current parent object.
- Loose components with `10` or more triangles are assigned new object IDs.
- Separation clears the linked-face overlay and refreshes object colors, material groups, wireframes, and the object list.
- Separation reports progress while assigning selected faces, scanning loose parts, separating loose components, and refreshing model overlays. Repeating progress updates are throttled to at most two UI updates per second.

## Edge Editing

- Holding `Shift` while hovering an edge highlights that edge in yellow at `2px`.
- Clicking a highlighted edge attempts to swap the diagonal between the two adjacent triangles.
- A diagonal swap is only valid when exactly two adjacent triangles share the edge and both triangles belong to the same object.
- After a successful swap, geometry bounds, vertex normals, object colors, wireframes, and loose-edge overlays are refreshed.

## Function Inventory

This inventory describes responsibilities, not implementation details. Code remains the source of truth for exact algorithms.

### Viewer Page Utilities

- `isMesh`: narrows Three.js objects to mesh instances.
- `isCylinderLoopMode`: identifies loop modes that generate a cylinder mesh.
- `isNormalTargetLoopMode`: identifies loop modes that use the adjustable normal-axis transform target.
- `isDisposableDrawObject`: identifies scene objects that own disposable geometry and material resources.
- `disposeMaterial`: disposes one material or a material array.
- `setLooseEdgeLoopFillBaseMaterial`: keeps generated loop meshes in normal opaque rendering and optionally marks their visible pixels into stencil for occlusion overlay masking.
- `createLooseEdgeLoopFillOcclusionOverlay`: creates a shared-geometry transparent overlay pass for generated loop fragments hidden behind model depth.
- `disposeLooseEdgeLoopFillOcclusionOverlay`: removes the occlusion overlay material without disposing the shared generated geometry.
- `disposeObject`: disposes all geometries and materials reachable from an object.
- `clearModel`: removes and disposes all loaded model children from the root group.
- `getVertexKey`: converts a vertex position into a stable precision-rounded topology key.
- `ensureVertexTopologyIds`: initializes the invisible per-vertex topology IDs used to cut connectivity without moving geometry.
- `getNextVertexTopologyId`: returns the next unused topology ID for a mesh position buffer.
- `getLooseEdgeKey`: creates the object-scoped key used to cache selected-object loose edges.
- `getSeparatedObjectColor`: returns the display color for an object ID.
- `getSeparatedObjectColorCss`: returns the CSS hex color for an object ID.
- `getDefaultSeparatedObjectLabel`: returns the default user-facing object label.
- `getSeparatedObjectLabel`: resolves a custom object name or the default label.
- `getTriangleObjectIds`: gets or initializes per-triangle object IDs on mesh geometry.
- `getTriangleObjectId`: returns one triangle's object ID with the default object fallback.
- `getTriangleObjectIdSet`: returns a cached set of object IDs present in one mesh for cheap selection-outline visibility checks.
- `refreshTriangleObjectIdAttribute`: mirrors triangle object IDs into a per-vertex GPU attribute used by selected-object outline shaders.
- `waitForBrowserPaint`: yields separation work to the browser so progress text can render.
- `createThrottledProgressReporter`: limits repeating separation progress updates to the configured UI cadence.
- `collectSeparatedObjects`: builds the object list summary from current mesh object IDs, hidden IDs, and custom names.
- `getTriangleEdges`: builds edge-to-face topology and per-triangle edge keys.
- `getSignedEdgeNormalAngle`: computes signed normal angle for an edge shared by one or more faces.
- `getEdgeNormalAngle`: returns the absolute normal angle for an edge.
- `createFaceMaterial`: creates the front-side vertex-color material used for object faces.
- `createSelectedObjectStencilMaterial`: creates the shader material that writes the focused object's visible face area into the stencil buffer.
- `createSelectedObjectOutlineMaterial`: creates the shader material that draws the focused object's screen-space silhouette outline.
- `refreshMeshObjectMaterialGroups`: rebuilds geometry groups and material visibility by object ID.
- `refreshObjectMaterialGroups`: refreshes material groups for all selectable meshes in a model.
- `styleModel`: converts meshes to non-indexed geometry, initializes colors/object IDs, materials, wireframes, and hover overlays.
- `createObjectWireframeGeometry`: builds visible-object wireframe line segments from triangle positions.
- `refreshObjectWireframe`: rebuilds one mesh wireframe after visibility or geometry changes.
- `refreshObjectWireframes`: rebuilds wireframes for all selectable meshes in a model.
- `refreshSelectedObjectOutlineOverlay`: updates one mesh's selected-object stencil and outline shader visibility/uniforms.
- `refreshSelectedObjectOutlines`: refreshes selected-object outlines for all selectable meshes in a model.
- `createLooseEdgeGeometry`: builds selected-object red line segments for edges connected to exactly one triangle and precomputes loose-edge loop caches, segment keys, object IDs, and adjacent normals.
- `createLooseEdgeRenderGeometryFromCache`: rebuilds selected-object loose-edge render geometry from per-object cached line data without rescanning mesh triangles or all cached loose-edge segments.
- `refreshLooseEdgeOverlay`: rebuilds one mesh loose-edge overlay after visibility or geometry changes.
- `refreshLooseEdgeOverlays`: rebuilds loose-edge overlays for all selectable meshes in a model.
- `colorTriangle`: writes one color to the three vertices of a triangle.
- `getTriangleVertices`: returns keyed vertices for a triangle start index.
- `getTriangleNormal`: computes a triangle normal from three vertices.
- `orientTriangle`: flips triangle winding when needed to match a reference normal.
- `setTrianglePositions`: writes three vertices back into a geometry position buffer.
- `getTriangleEdgeKeys`: returns the three stable edge keys for a triangle.
- `getTriangleEdgeFace`: returns edge direction and triangle normal for one edge.
- `getLooseEdgeLoop`: returns a precomputed loose-edge loop by mesh and loop ID.
- `isSameLooseEdgeLoop`: compares two loose-edge loop references by mesh, object ID, and loop ID.
- `setLooseEdgeLoopColor`: recolors precomputed loose-edge loop segments without rebuilding geometry.
- `getScreenPoint`: projects a world-space point into viewport pixel coordinates.
- `getPointToSegmentDistance`: returns a screen-space point-to-segment distance in pixels.
- `createHoverEdgeGeometry`: creates the line geometry for the hovered-edge overlay.
- `clearHoverEdgeOverlay`: hides the current hover-edge overlay.
- `setHoverEdgeOverlay`: updates and shows the hover-edge overlay.
- `createLooseEdgeLoopOverlay`: creates the persistent selected-loop UI overlay from cached loop positions.
- `getLoopFillPointKey`: creates the precision-rounded key used to de-duplicate loop fill vertices.
- `getLooseEdgeLoopCacheKey`: creates the stable mesh/segment key for one grouped loose-edge loop.
- `getLooseEdgeLoopFillKey`: resolves the stable cap key for a selected loose-edge loop.
- `getMeshObjectLocalCenter`: computes an object-local center used to orient generated cap faces outward.
- `getMeshObjectProjectionSize`: computes an object's size along a normalized local extrusion axis.
- `pushLoopFillTriangle`: appends a non-degenerate triangle with optional normal-based winding correction.
- `createLoopFillGeometry`: creates a loop cap/extrusion buffer geometry from generated triangle vertices.
- `getLoopTriangleOutwardNormal`: computes an object-center-relative normal target for side-wall winding.
- `getLooseEdgeLoopFillData`: collects de-duplicated loop points, segment references, center, object center, and outward loop normal for cap/extrusion generation.
- `getLooseEdgeLoopCapAxisData`: resolves the active cap axis, fill data, and default offset for one loop mode, including the custom target-driven normal axis for `Ex. N`/`Cyl. N` and a loop-sized fallback offset for degenerate projections.
- `getLooseEdgeLoopCapOffsetBounds`: computes the allowed drag offset range for one cap axis.
- `clampLooseEdgeLoopCapOffset`: clamps a requested cap offset before regenerating cap geometry.
- `createLooseEdgeLoopFlatFillGeometry`: creates the flat fan cap geometry for `Filled` mode.
- `getLooseEdgeLoopExtrusionAxis`: resolves the signed local X/Y/Z/normal extrusion axis for a loop mode.
- `createLooseEdgeLoopExtrusionGeometry`: creates side-wall and perpendicular end-cap geometry for extrusion loop modes.
- `getLooseEdgeLoopCylinderRadius`: computes cylinder radius from the minimum loop-center-to-vertex distance.
- `getPerpendicularBasis`: computes the local basis used to build cylinder rings around an axis.
- `createLooseEdgeLoopCylinderGeometry`: creates the flat cap, 16 cylinder side faces, and cylinder top cap for cylinder loop modes.
- `createLooseEdgeLoopFill`: creates an ephemeral non-selectable cap, extrusion, or cylinder mesh for a loose-edge loop, with outward-facing triangle winding.
- `updateHoverEdgeResolution`: updates fat-line material resolution for hover and linked-face overlays.
- `getHoveredEdgeFromHit`: resolves the closest triangle edge from a raycast hit.
- `swapHoveredEdgeDiagonal`: swaps the diagonal for a valid pair of adjacent same-object triangles.
- `buildMeshTopology`: builds triangle and edge adjacency for a mesh.
- `getTopologyEdgeNormalAngle`: computes an edge normal angle from mesh topology and optional object filtering.
- `getObjectConnectedComponentsAsync`: finds connected triangle components for one object ID while yielding progress.
- `separateLooseObjectPartsAsync`: splits loose connected components into new object IDs while yielding progress, except components under `10` triangles.
- `buildLinkedFaceSelection`: computes a threshold-based linked flat-face selection from a seed triangle.
- `findLinkedFaceGraphParent`: finds a union-find parent while building the threshold graph cache.
- `unionLinkedFaceCacheTriangles`: unions two connected triangle sets and records threshold entry values.
- `buildLinkedFaceSelectionCache`: precomputes selected-count data for graph-driven threshold changes.
- `createLinkedFaceSelectionFromCache`: rebuilds a linked-face selection from cached threshold values.
- `applyLinkedFaceSelectionColors`: colors selected triangles yellow.
- `createLinkedFaceSelectionOverlay`: creates the yellow line overlay for selected triangles.
- `buildSelectionBoundaryLoops`: groups active separate-mode mask boundary edges into connected hoverable loops.
- `createSelectionBoundaryLoopOverlay`: creates the red boundary-loop overlay for the active separate-mode mask.
- `getBoundaryLoopRegionTriangleIndexes`: resolves the connected selected mask region attached to a clicked boundary loop.
- `cutSelectionBoundaryLoopTopology`: splits topology keys along a clicked separate-mode boundary loop while keeping vertex positions unchanged.
- `applyObjectColors`: colors mesh triangles by object ID, respecting hidden objects.
- `getPointFromVertexKey`: reconstructs a point from a topology key.
- `normalizeModel`: scales and centers a loaded model into the target viewer size.
- `frameModel`: places the camera and orbit target around the loaded model.
- `isSelectableMesh`: excludes overlay meshes from picking and topology operations.

### Viewer Page State Handlers

- `Home`: owns the Three.js scene, model state, selection state, and control props.
- `clearLinkedFaceSelectionOverlay`: removes the linked-face line overlay.
- `removeLooseEdgeLoopCapFill`: removes one cap state's mesh while preserving or clearing state as directed by the caller.
- `removeCapOffsetGizmo`: removes the selected-loop cap offset gizmo, hides the `Ex. N` transform gizmo, and ends any active cap-offset drag.
- `clearLooseEdgeLoopCapStates`: removes all cap state and cap meshes, used when loading a new model.
- `refreshLooseEdgeLoopCapVisibility`: updates generated cap/extrusion/cylinder mesh visibility from hidden object IDs and applies object/loop selection occlusion overlay render state.
- `refreshCapOffsetGizmo`: creates, updates, or hides the selected-loop cap offset gizmo from the current cap state, using an arrow helper for fixed-axis extrusions and a three-axis translate gizmo for `Ex. N`; `Filled` mode has no gizmo.
- `rebuildLooseEdgeLoopCapFill`: regenerates a cap/extrusion mesh after the mode or offset changes.
- `syncLooseEdgeLoopCapStates`: reconciles per-loop cap state against the latest grouped loose-edge loops after topology changes.
- `getLooseEdgeLoopCapMode`: reads the selected loop's stored cap mode.
- `setLooseEdgeLoopCapMode`: updates one loop's cap/extrusion mode and lazily creates, replaces, or removes the generated mesh for loop mode changes.
- `setLooseEdgeLoopCapOffset`: updates one loop's stored cap offset and regenerates its cap/extrusion mesh.
- `setLooseEdgeLoopCapTarget`: updates one `Ex. N` loop's stored normal-axis target and regenerates its cap/extrusion mesh.
- `clearSelectedLooseEdgeLoop`: clears the secondary loose-edge loop selection and selected-loop overlay while leaving cap meshes intact.
- `selectLooseEdgeLoop`: selects a hovered loose-edge loop, shows it in yellow, and refreshes the active loop mode.
- `handleLooseEdgeLoopModeChange`: updates the selected loop's per-loop cap mode from the loop panel.
- `rememberTriangleSelection`: stores the latest mesh-clicked triangle as the candidate origin for later separate-mode selection.
- `getRememberedSelectedTriangle`: validates and returns the remembered origin only when it still belongs to the currently selected visible object.
- `applyLinkedFaceSelectionVisuals`: reapplies object colors and selected-face overlays.
- `clearLinkedFaceSelection`: clears linked-face selection and optionally clears selected object state.
- `toggleSeparateMode`: toggles dedicated separate mode for the selected object.
- `refreshLinkedFaceSelection`: recalculates selection at a committed threshold.
- `commitLinkedFaceSelectionThreshold`: commits a graph-selected threshold if it changed.
- `selectLinkedFace`: seeds linked-face selection from a clicked triangle in separate mode and reports calculation progress.
- `refreshSeparatedObjects`: rebuilds the object list from current geometry state.
- `applyObjectVisibility`: applies hidden object IDs to faces, wireframes, cap meshes, picking state, and object summaries.
- `toggleObjectVisibility`: toggles one object's hidden state.
- `hideSelectedObject`: hides the selected object from the list or active linked-face selection.
- `showAllObjects`: clears all hidden object IDs.
- `selectSeparatedObject`: selects an object row and clears linked-face selection while keeping object selection.
- `renameSeparatedObject`: saves or clears a custom object name.
- `setSeparateModeActiveState`: mirrors separate mode state into React state and the event-handler ref.
- `setSeparationBusyState`: mirrors separation busy state into React state and the event-handler ref.
- `handleSeparateSelection`: asynchronously separates the active linked-face selection, reports progress, and refreshes model/object state.
- `handleCutBoundaryLoop`: asynchronously cuts through one clicked boundary loop, isolates resulting loose components, and refreshes model/object state.
- `separateByBoundaryLoop`: dispatches a clicked boundary loop to the topology cut workflow.
- `clearHoveredEdge`: hides any active hover-edge overlay.
- `getMeshHitAtPointer`: raycasts visible selectable mesh faces.
- `getEdgeAtPointer`: resolves the hovered edge at a pointer position.
- `getSelectionBoundaryEdgeAtPointer`: resolves the hovered separate-mode mask boundary loop at a pointer position.
- `getTriangleAtPointer`: resolves the clicked triangle at a pointer position.
- `handlePointerDown`: starts click tracking and optional shift-edge hover selection.
- `handlePointerUp`: selects objects, selects a separate-mode starting face, clears background selection, or swaps a shift-clicked edge.
- `handlePointerMove`: updates shift-hovered edge highlighting.
- `handlePointerLeave`: clears hover-edge state.
- `handleKeyUp`: clears hover-edge state when Shift is released.
- `handleKeyDown`: handles `h`, `Option+H`, and `Command+H` visibility shortcuts.
- `handleResize`: keeps renderer, camera, and fat-line overlay resolutions in sync with viewport size.
- `render`: runs the animation frame loop.
- `handleFileChange`: validates and loads `.glb` files, resets viewer state, styles the model, and frames the camera.

### Control Components

- `TopBar`: renders the hidden GLB file input, load button, and load/status text.
- `ObjectsPanel`: renders object summaries, selection highlighting, visibility toggles, and inline name editing.
- `LinkedFaceSelectionPanel`: renders the separate-mode toggle, starting-point prompt, progress text, selection count, clickable threshold graph, and `Apply`/`Clear` actions.
- `LoopPanel`: renders selected loose-edge loop controls as `Mode` (`None`, `Cap`, `Extrude`, `Cylinder`) and `Axis` (`X`, `Y`, `Z`, `Normal`) segments, with axis disabled for `None` and `Cap`.

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
