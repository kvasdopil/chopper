# Model Viewer

Status: Draft (2026-06-07)

This document is the canonical UI spec for the GLB model viewer. It captures the user-facing behavior, geometry rules, controls, and current function inventory so future changes preserve the intended workflows.

Related documents:

- [UI specs index](index.md): Parent catalog for viewer UI requirements. Read this to find other UI-facing specifications.
- [Specifications index](../index.md): Parent catalog for all normative requirements. Read this when deciding whether a rule belongs in UI, domain, project, or testing docs.
- [Memory Bank principles](../../mbb/principles.md): Governance for single-source-of-truth documentation. Read this before splitting or duplicating viewer behavior.
- [Viewer entry](../../../src/app/page.tsx): Thin app route that composes the model viewer with the default tool list. Use this when adding or removing whole viewer tools.
- [Viewer component](../../../src/app/model-viewer/model-viewer.tsx): Top-level React composition for viewer refs/state, model load/restore/export flow, and control composition. Use this when changing the app-level viewer shell.
- [Viewer scene hook](../../../src/app/model-viewer/model-viewer-scene.ts): Three.js scene lifecycle, camera/renderer setup, pointer handling, hotkeys, resize, render loop, and teardown. Use this when changing low-level viewport interaction wiring.
- [Viewer loop cap hook](../../../src/app/model-viewer/model-viewer-loop-caps.ts): Stateful loop cap/extrusion/cylinder selection, generated fill meshes, paired loop edits, and viewport cap gizmos. Use this when changing loop generation interaction state.
- [Viewer selection hook](../../../src/app/model-viewer/model-viewer-selection.ts): Object selection, linked-face selection, separate mode, visibility, join, undo restore, and separation actions. Use this when changing object/separation workflows.
- [Viewer core barrel](../../../src/app/model-viewer/model-viewer-core.ts): Re-export surface for stateless viewer modules. Use this only as the compatibility import boundary.
- [Viewer stateless modules](../../../src/app/model-viewer): Focused helper modules for shared types/constants, materials, overlays, loose edges, loop cap geometry, mesh topology, linked-face selection, persistence snapshots, and export. Use the narrow module that owns the algorithm being changed.
- [Viewer persistence](../../../src/app/model-viewer/persistence.ts): IndexedDB storage helper for the current viewer snapshot. Use this when changing refresh survival or saved viewer state.
- [Viewer tools](../../../src/app/model-viewer/tools): Tool registry and tool-owned panel adapters. Use this when adding, removing, or disabling feature tools.
- [Viewer controls](../../../src/app/viewer-controls): Current TSX control components for the load/status bar, object list, and linked-face panel. Use this when changing UI presentation.

## Viewer Requirements

- The app displays a full-screen Three.js viewport for `.glb` files.
- Loading a GLB normalizes the model to fit the viewer and frames the camera around the model.
- The app persists one current viewer snapshot in IndexedDB so a browser refresh restores the active GLB and durable user edits. The persisted snapshot contains the source GLB bytes plus only state needed to rebuild user edits: separated object IDs, object names, hidden object IDs, next object ID, topology-cut IDs, mesh position buffers only for meshes whose positions were edited, and per-loop cap/extrusion/cylinder mode/offset/normal-target/cone data. Runtime-only state such as camera position, orbit target, hover state, selection state, separation progress, and generated overlay mesh instances is not persisted.
- Opening a new valid `.glb` resets the saved snapshot before parsing the new file. If the new load fails, the previous saved file must not be restored on the next refresh.
- Loading, restore, and persistence failures keep the viewer from silently failing. User-facing failures update the status text where applicable and show a toast.
- The viewer keeps an in-memory undo history for durable edit actions until a new file is loaded or the page is reloaded. Undo history is not persisted. `Undo` and `Command/Ctrl+Z` roll back one action at a time, including object visibility/name changes, separation and boundary-cut topology changes, and loop cap/extrusion/cylinder mode, cone, or offset changes.
- The top bar provides an `Export GLB` action when a model is loaded. Export builds a temporary Blender-oriented GLB scene instead of exporting the live viewport scene. Each separated object ID becomes a standalone mesh with its object label and color. Generated cap/extrusion/cylinder geometry is merged into the matching object mesh and stored as separate GLB material groups/primitives where the format supports it. Export welds matching vertex positions with a `0.00001` world-unit merge distance and skips triangles that become degenerate after welding. UI-only overlays such as wireframes, hover lines, selected-object outlines, loose-edge overlays, and transform gizmos are excluded. Export includes hidden objects and hidden generated caps because hidden state is a runtime view concern, not export geometry.
- The viewer renders front-facing triangles only.
- Default faces are light gray; separated objects use distinct pronounced colors.
- A standalone texture toggle sits immediately to the left of the object panel. It is enabled only when the loaded GLB contains base color texture maps. Textures are hidden by default and are runtime-only view state, not persisted. Showing textures reuses the original GLB base color maps without vertex-color object tinting while preserving object visibility. Object/mesh rows, counts, join, visibility toggles, and inline names remain visible in the object panel.
- Wireframes are visible only while separate mode is active. They are thin, dark gray, nearly transparent line segments.
- Loose edges render only for the currently selected object. They are defined as edges connected to exactly one triangle within that visible object and render above other edge overlays. Unobstructed loose edges render as thick `3px` lines; obstructed loose edges render as thinner `1px` lines. Loose-edge contact spans with no cap/extrusion/cylinder state render red, and contact spans with a cap/extrusion/cylinder state render green.
- Hovering within `5px` of an unobstructed loose edge on any visible submesh temporarily highlights that edge's connected loose-edge contact span with a pronounced yellow `6px` UI overlay rendered above model geometry. Loose-edge contact spans are precomputed when the loose-edge overlay is rebuilt: loose-edge components are kept object-scoped, connected by topology-free vertex positions so topology cuts do not fragment one visual boundary, pruned to closed cycle cores by stripping dangling/open edge branches, then split into connected runs with the same topology-free contact ownership. Hover uses the cached span positions without rebuilding topology. Loose-edge segments that are not part of a closed cycle core remain outside span hover, selection, and cap generation.
- Clicking a hovered loose-edge contact span selects that span, clears any selected mesh/object state, and displays it with a yellow `4px` UI overlay. Loose-edge contact-span hover and selection work on any visible submesh, even when the red/green loose-edge overlay is only visible for the currently selected object.
- When a loose-edge contact span is selected, the loop panel appears. Cap/extrusion mode is stored per contact span. The default mode is `None`. Open contact spans are force-closed for generated cap/extrusion/cylinder geometry by adding virtual closing segments between open endpoints; this does not change source mesh topology. `Filled` mode creates an ephemeral, non-selectable cap mesh from the loop's unique points plus a center point, with triangles from the center to each real or virtual loop segment. `Ex. X`, `Ex. Y`, `Ex. Z`, and `Ex. N` create ephemeral, non-selectable extrusions from the loop along the signed local X, Y, Z, or loop-normal axis, using an extrusion length equal to the parent object's projected size along that axis, then add an end cap perpendicular to the extrusion axis. `Cyl. X`, `Cyl. Y`, `Cyl. Z`, and `Cyl. N` create loop-shaped cylinders by scaling the original loop points to `50%` around the loop centroid, projecting the scaled base ring onto a plane perpendicular to the active axis, extruding that flat scaled loop along the matching X, Y, Z, or loop-normal axis, and adding a flat end cap. With cone enabled, the first half of the cylinder offset slopes from the original loop to the flat scaled loop before continuing straight. Cap, extrusion, and cylinder triangles are wound so their front faces point outside the parent object, but generated materials render double-sided so incorrect normals do not hide the generated faces. Generated caps/extrusions/cylinders use the parent object's face color, do not appear in the object list, remain visible after loop selection is cleared, and follow the parent object's visibility.
- If a loose-edge contact span has exactly one matching span on another object with the same topology-free boundary segments, the two spans are treated as one paired boundary for cap/extrusion/cylinder edits. Changing mode, cone, offset, or `Normal` target on either side updates generated geometry for both objects. Each object still owns its own generated mesh for visibility/export/material grouping, and paired members store a shared world-space cap axis as local target points so generated halves stay aligned from the shared boundary.
- When any object or loose-edge contact span is selected, visible generated cap/extrusion/cylinder meshes keep their normal opaque rendering for unobstructed fragments and add a shared-geometry occlusion overlay for obstructed fragments. The occlusion overlay renders at `30%` opacity, uses a greater-depth test, and skips pixels already marked by the generated mesh stencil so only model-obstructed fragments show through. This is a material/render-state change only; generated geometry is not rebuilt for overlay display.
- Each cap/extrusion/cylinder stores a per-loop signed offset along its active cap axis, so extrusion and cylinder generation can extend from the loop in either direction. Cylinder modes also store a per-loop cone flag. `Filled` stays at offset `0` along the loop normal and does not display a viewport gizmo; extrusion and cylinder modes default to the object projected size along the selected axis, falling back to a small loop-sized offset when that projection is degenerate. While the loop is selected and its cap mode is `Ex. X`, `Ex. Y`, `Ex. Z`, `Cyl. X`, `Cyl. Y`, or `Cyl. Z`, a non-selectable `THREE.ArrowHelper` viewport gizmo appears on the signed cap offset side. Dragging near the visible arrow updates the stored offset and regenerates that loop's generated mesh; force-closed contact spans use a wider arrow hit target so the drag is captured before camera orbit starts. Dragging elsewhere keeps camera orbit/pan behavior. For `Ex. N` and `Cyl. N`, a standard three-axis `TransformControls` translate gizmo appears at the normal-axis target instead; the axis points from the loop centroid toward that target, defaults to the loop normal, and updates as the target is moved along any world axis.
- The loop panel is positioned at the top-left below the load/status controls. It presents loop generation as three controls: `Mode` (`N`, `Cap`, `Ex`, `Cyl`), `Axis` (`X`, `Y`, `Z`, `N`), and a `Cone` checkbox enabled only for cylinder modes. Axis is enabled only for `Ex` and `Cyl`; `Cap` maps to the simple filled-cap mode.
- Rebuilding loose-edge groups after mesh topology changes updates cap/extrusion state by stable contact-span segment keys. Cap/extrusion meshes are computed lazily only when the user selects a non-`None` loop mode; grouping loose edges must not eagerly create cap/extrusion meshes.
- Hidden objects must not render faces, wireframe lines, or loose-edge lines and must be excluded from pointer picking.
- Camera orbit uses `OrbitControls`; panning moves the current focus point and rotation stays around that focus.
- The route composes the viewer as `<ModelViewer tools={defaultViewerTools} />`. `ModelViewer` owns the app-level shell, durable refs/state, load/restore/export flow, top bar, object list, status, toasts, and tool panel composition. Three.js scene lifecycle lives in `model-viewer-scene.ts`, loop-cap interaction state lives in `model-viewer-loop-caps.ts`, and object/separation interaction state lives in `model-viewer-selection.ts`. Stateless viewer infrastructure is split across focused modules behind the `model-viewer-core.ts` barrel: shared constants/types, geometry/material helpers, overlay builders, separation algorithms, persistence snapshot helpers, and export helpers.
- The default tool registry contains `separation` and `edge-loop-cap`. Removing a tool from `defaultViewerTools` hides its panel and makes its pointer/state handlers inert. Current tool modules own their panels through small adapters; feature interaction hooks own stateful behavior; stateless algorithms stay in the focused helper module that matches their domain until richer tool contracts justify moving them behind tool-owned APIs.
- The viewer does not own a dev-server lifecycle in documentation or code workflows; the user launches the server when needed.

## Object Workflow

- Every triangle belongs to an object ID.
- Object `0` is the default object and is labeled `Default` unless renamed.
- Object names may be edited inline from the object list.
- Clicking an object row selects that object and highlights the row.
- Clicking a mesh face selects that face's object row. It does not start separation unless separate mode is already active for that object.
- Shift-clicking additional mesh faces or object rows adds their objects to a multi-selection. The most recently clicked object remains the primary object for tools such as separation and loose-edge rendering.
- When two or more objects are selected, the object list shows `Join`. Join finds selected object groups connected by at least one shared positional edge, merges each connected group into one target object ID, and clears topology split IDs on the shared edge vertices so the joined seam becomes connected again. The primary selected object is the merge target for its connected group; other connected groups use their first selected object as target. Selected objects without a shared edge are left unchanged. Join is undoable.
- Clicking a mesh face remembers that triangle as the selected object's latest separation origin. If the user later toggles separate mode for the same object and the triangle still belongs to it, linked-face selection starts from that remembered triangle.
- Clicking the already selected object outside separate mode must not recalculate linked-face selection or rebuild loose-edge topology.
- Selecting a different mesh/object must use cached geometry data where possible. Plain object selection must not recolor all faces or rebuild loose-edge topology; face colors are refreshed only when clearing an active linked-face mask, and loose-edge rendering uses per-object cached line data.
- Visible non-focused objects render a light gray `2px` outline. The outside contour uses the shared-geometry screen-space silhouette shader pass, and per-object mesh boundaries are drawn in the existing face material shader from boundary attributes, without adding boundary-line geometry. Selected objects render a yellow `2px` screen-space silhouette outline instead. The parent object of a selected loose-edge contact span is treated as focused, so it does not also receive the gray outline.
- Mesh/object selection and loop selection are mutually exclusive: selecting a mesh/object clears loop selection, and selecting a loop clears mesh/object selection. Shift-click does not select loops. While a loop is selected, the object list highlights the loop's parent object row as contextual focus without making it the active selected object.
- Clicking a triangle, clicking background, or selecting an object row clears loose-edge contact-span selection.
- The eye icon toggles object visibility.
- Pressing `h` hides all selected objects.
- Pressing `Option+H` or `Command+H` unhides all objects when the browser receives the event.
- Viewer hotkeys are ignored when the keyboard event target, composed path, or active focused element is an input, textarea, select, or content-editable field.
- `Command/Ctrl+Z` rolls back the latest undo-history entry when available.

## Separate Mode

- The separate button is shown only when an object is selected.
- Toggling the separate button enters separate mode. With no polygon selected, the panel shows `select a starting point`.
- While separate mode is active, the 3D viewport uses a crosshair cursor.
- In separate mode, clicking a face on the selected object creates a linked flat-face selection seeded by that face.
- Clicking a face on any other object selects that object instead of starting separation.
- The seed triangle is always included in the selection.
- Selection expands across adjacent triangles while the edge normal angle is within the active threshold.
- Selected faces and their boundary lines render in yellow.
- While a separate-mode mask is visible, newly separable boundary edge loops render in red and are hoverable. Existing loose-edge contact spans are not hoverable in separate mode. A separable boundary edge must have exactly two connected triangles, with one triangle inside the mask and one outside it. Hovering a boundary loop highlights the whole loop in blue.
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

## Function Inventory

This inventory describes responsibilities, not implementation details. Code remains the source of truth for exact algorithms. Stateless helper functions live in focused `src/app/model-viewer/*` modules re-exported by `model-viewer-core.ts`; `model-viewer.tsx` and its hooks own React state/event orchestration.

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
- `getVertexPositionKey`: converts a vertex position into a topology-free precision-rounded key used to detect split shared edges.
- `cloneArrayBuffer`: copies source GLB bytes before storing or parsing them.
- `cloneFloat32Array`: copies persisted mesh position buffers.
- `cloneUint32Array`: copies persisted object ID and topology ID buffers.
- `hasNonDefaultObjectIds`: detects whether a mesh needs object IDs persisted.
- `hasNonZeroTopologyIds`: detects whether a mesh needs topology-cut IDs persisted.
- `getPersistedLoopSegmentKey`: creates the stable loop segment key used to restore cap/extrusion/cylinder state after Three.js UUIDs change.
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
- `getMaterialTextureMap`: reads a base color texture map from a Three.js material when present.
- `getMaterialTextureMaps`: collects source material texture maps from one mesh material or material array.
- `getSourceTriangleMaterialIndexes`: records the source material index for each triangle before styling clears geometry groups.
- `getMeshSourceTextureMap`: resolves the preserved source texture map for one styled mesh material index.
- `meshHasSourceTextureMaps`: detects whether one styled mesh retained any source texture maps.
- `modelHasSourceTextureMaps`: detects whether the loaded model can enable the texture toggle.
- `refreshObjectBoundaryAttributes`: marks open triangle edges and edges shared by different object IDs so the face shader can draw non-focused mesh boundaries without extra line geometry.
- `createFaceMaterial`: creates the front-side material used for object faces, using vertex colors for color view, disabling vertex colors for preserved source texture maps, and mixing in shader-only non-focused boundary outlines.
- `createSelectedObjectStencilMaterial`: creates the shader material that writes an outlined object's visible face area into the stencil buffer.
- `createSelectedObjectOutlineMaterial`: creates the shader material that draws a screen-space silhouette outline for selected or non-focused objects.
- `refreshMeshObjectMaterialGroups`: rebuilds geometry groups and material visibility by object ID and source texture material index.
- `refreshObjectMaterialGroups`: refreshes material groups for all selectable meshes in a model.
- `styleModel`: converts meshes to non-indexed geometry, preserves source texture maps/material indexes, initializes colors/object IDs, materials, wireframes, and hover overlays.
- `createObjectWireframeGeometry`: builds visible-object wireframe line segments from triangle positions.
- `refreshObjectWireframe`: rebuilds one mesh wireframe after visibility or geometry changes and applies separate-mode visibility.
- `refreshObjectWireframes`: rebuilds wireframes for all selectable meshes in a model and applies separate-mode visibility.
- `applyObjectIdOutlineUniforms`: updates one outline overlay pair's object-ID uniforms and visibility.
- `refreshObjectBoundaryMaterialUniforms`: toggles face-material boundary outline uniforms off for focused object IDs.
- `refreshObjectOutlineOverlay`: updates one mesh's gray non-focused and yellow selected-object outline shader visibility/uniforms.
- `refreshObjectOutlines`: refreshes object outlines for all selectable meshes in a model.
- `getClosedLooseEdgeLoopKeys`: strips dangling/open loose-edge branches from one connected loose-edge component, using topology-free vertex-position continuity, so only closed cycle-core segments can become contact spans.
- `getLooseEdgePositionEdgeKey`: creates the topology-free edge key used to detect contact across topology cuts.
- `getLooseEdgeContactKey`: creates a stable contact ownership key from adjacent object IDs.
- `getLooseEdgeContactSpanGroups`: splits one closed loose-edge cycle core into connected same-contact span segment groups, using topology-free vertex-position continuity.
- `isLooseEdgeContactSpanClosed`: detects whether a contact span is itself a naturally closed loop by topology-free vertex-position degree.
- `createLooseEdgeGeometry`: builds selected-object red line segments for edges connected to exactly one triangle and precomputes loose-edge contact-span caches, segment keys, topology-free pair keys, object IDs, contact ownership, and adjacent normals.
- `createLooseEdgeRenderGeometryFromCache`: rebuilds selected-object loose-edge render geometry from per-object cached line data without rescanning mesh triangles or all cached loose-edge segments.
- `refreshLooseEdgeOverlay`: rebuilds one mesh loose-edge overlay after visibility or geometry changes.
- `refreshLooseEdgeOverlays`: rebuilds loose-edge overlays for all selectable meshes in a model.
- `colorTriangle`: writes one color to the three vertices of a triangle.
- `getTriangleVertices`: returns keyed vertices for a triangle start index.
- `getTriangleNormal`: computes a triangle normal from three vertices.
- `getTriangleEdgeKeys`: returns the three stable edge keys for a triangle.
- `getTriangleEdgeFace`: returns edge direction and triangle normal for one edge.
- `getLooseEdgeLoop`: returns a precomputed loose-edge contact span by mesh and loop ID.
- `isSameLooseEdgeLoop`: compares two loose-edge contact-span references by mesh, object ID, and loop ID.
- `setLooseEdgeLoopColor`: recolors precomputed loose-edge contact-span segments in visible overlays and cached render colors without rebuilding geometry.
- `getScreenPoint`: projects a world-space point into viewport pixel coordinates.
- `getPointToSegmentDistance`: returns a screen-space point-to-segment distance in pixels.
- `createHoverEdgeGeometry`: creates the line geometry for the hovered-edge overlay.
- `clearHoverEdgeOverlay`: hides the current hover-edge overlay.
- `setHoverEdgeOverlay`: updates and shows the hover-edge overlay.
- `createLooseEdgeLoopOverlay`: creates the persistent selected-loop UI overlay from cached loop positions.
- `getLoopFillPointKey`: creates the precision-rounded key used to de-duplicate loop fill vertices.
- `getLooseEdgeLoopCacheKey`: creates the stable mesh/segment key for one grouped loose-edge contact span.
- `getLooseEdgeLoopMember`: creates the editable member wrapper for one cached loose-edge contact span.
- `getLinkedLooseEdgeLoopMembers`: resolves a contact span to its exact two-object paired boundary members, falling back to the selected span when the boundary is not exactly paired.
- `getLooseEdgeLoopFillKey`: resolves the stable cap key for a selected loose-edge contact span.
- `getLooseEdgeLoopDisplayColor`: resolves red/green loop display color from whether a stable loop cap state exists.
- `getMeshObjectLocalCenter`: computes an object-local center used to orient generated cap faces outward.
- `getMeshObjectProjectionSize`: computes an object's size along a normalized local extrusion axis.
- `pushLoopFillTriangle`: appends a non-degenerate triangle with optional normal-based winding correction.
- `createLoopFillGeometry`: creates a loop cap/extrusion buffer geometry from generated triangle vertices.
- `getLoopTriangleOutwardNormal`: computes an object-center-relative normal target for side-wall winding.
- `appendForceClosingSegments`: pairs open contact-span endpoints and adds virtual fill segments so cap/extrusion/cylinder generation can operate on open spans without changing source topology.
- `getLooseEdgeLoopFillData`: collects de-duplicated loop points, segment references, center, object center, and outward loop normal for contact-span cap/extrusion generation, adding virtual closing segments for open spans.
- `getLooseEdgeLoopCapAxisData`: resolves the active cap axis, fill data, and default offset for one loop mode, including target-driven axis overrides for paired loops, the custom normal axis for `Ex. N`/`Cyl. N`, and a loop-sized fallback offset for degenerate projections.
- `getLooseEdgeLoopCapOffsetBounds`: computes the allowed drag offset range for one cap axis.
- `clampLooseEdgeLoopCapOffset`: clamps a requested cap offset before regenerating cap geometry.
- `createLooseEdgeLoopFlatFillGeometry`: creates the flat fan cap geometry for `Filled` mode.
- `getLooseEdgeLoopExtrusionAxis`: resolves the signed local X/Y/Z/normal extrusion axis for a loop mode.
- `createLooseEdgeLoopExtrusionGeometry`: creates side-wall and perpendicular end-cap geometry for extrusion loop modes.
- `getLoopPointsProjectedToAxisPlane`: projects loop points to a flat plane perpendicular to the active cap axis.
- `createLooseEdgeLoopCylinderGeometry`: creates loop-shaped cylinder geometry from the original loop scaled to `50%` around its centroid, with optional cone walls from the original loop to the scaled loop.
- `createLooseEdgeLoopFill`: creates an ephemeral non-selectable cap, extrusion, or cylinder mesh for a loose-edge contact span, with outward-facing triangle winding.
- `updateHoverEdgeResolution`: updates fat-line material resolution for hover and linked-face overlays.
- `buildMeshTopology`: builds triangle and edge adjacency for a mesh.
- `getTopologyEdgeNormalAngle`: computes an edge normal angle from mesh topology and optional object filtering.
- `getObjectConnectedComponentsAsync`: finds connected triangle components for one object ID while yielding progress.
- `separateLooseObjectPartsAsync`: splits loose connected components into new object IDs while yielding progress, except components under `10` triangles.
- `addObjectJoinAdjacency`: records a shared-edge adjacency between two selected object IDs.
- `getPositionEdgeKey`: creates a topology-free positional edge key.
- `createSelectedObjectJoinPlan`: finds connected selected object groups with shared positional edges and chooses target object IDs for join.
- `applySelectedObjectJoinPlan`: rewrites joined triangles to target object IDs and clears topology split IDs on shared seam vertices.
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
- `isEditableHotkeyTarget`: detects editable keyboard event targets or ancestors that should bypass viewer hotkeys.
- `isEditableHotkeyEvent`: detects keyboard events that should bypass viewer hotkeys by checking the event target, active element, and composed path.
- `collectSelectableMeshes`: returns selectable meshes in stable traversal order for persistence and restore.
- `getMaxObjectId`: finds the highest object ID currently assigned in a restored model.
- `getPersistedMeshState`: serializes only needed per-mesh edit data.
- `getPersistedLoopCapState`: serializes one generated loop state by stable mesh order and loop segment keys.
- `createPersistedViewerState`: builds the IndexedDB snapshot from current source bytes and durable edit state.
- `getViewerHistoryMeshState`: creates an exact in-memory undo snapshot for one mesh's positions, object IDs, and topology IDs.
- `createViewerHistorySnapshot`: creates an in-memory undo snapshot for mesh edit state, object names, hidden objects, next object ID, and loop cap states.
- `applyViewerHistoryMeshStates`: restores mesh position, object ID, and topology ID state from one undo snapshot.
- `applyPersistedMeshStates`: reapplies saved mesh edits after GLB parsing and styling.
- `getRestoredObjectNames`: converts persisted string-keyed object names back to numeric object IDs.
- `getLooseEdgeLoopFromPersistedState`: resolves a saved loop state against rebuilt loose-edge contact spans.
- `createLooseEdgeFromLoop`: creates a minimal loop reference used to regenerate persisted caps/extrusions/cylinders.
- `getSafeExportName`: sanitizes object and file names for GLB export.
- `getBlenderExportFileName`: derives the downloaded Blender GLB file name from the loaded source name.
- `createExportMaterial`: creates a double-sided material for exported object and generated meshes.
- `getExportObjectGeometry`: returns the mutable export geometry bucket for one object ID.
- `appendExportGeometryPositions`: appends transformed triangle positions from a buffer geometry.
- `addBaseObjectGeometryToExportObjects`: converts triangle object IDs into base geometry buckets.
- `addGeneratedLoopGeometryToExportObjects`: appends generated cap/extrusion/cylinder geometry to the matching object buckets as separate groups.
- `getExportMergeVertexKey`: creates the precision-rounded vertex key used to weld duplicate positions in exported meshes.
- `createMergedExportMesh`: creates one indexed exported mesh per object with welded vertices, skipped degenerate triangles, and base/generated material groups.
- `addMergedObjectMeshesToExportScene`: adds one merged export mesh per object to the temporary export scene.
- `createBlenderExportScene`: builds the temporary GLB scene that excludes viewport-only overlays.
- `downloadArrayBuffer`: downloads the binary GLB result in the browser.

### Viewer Component State Handlers

- `ModelViewer`: owns the Three.js scene, model state, selection state, enabled tool IDs, and control props.
- `showToast`: displays transient load/restore/persistence failure feedback.
- `persistViewerStateNow`: writes the current viewer snapshot to IndexedDB.
- `schedulePersistViewerState`: debounces IndexedDB writes for frequent edit updates.
- `clearScheduledPersistenceSave`: cancels a pending debounced persistence write.
- `createCurrentViewerHistorySnapshot`: captures the current loaded model state for the in-memory undo stack.
- `pushViewerHistorySnapshot`: pushes a pre-action snapshot and enables the undo control.
- `clearViewerHistory`: clears all in-memory undo state on model load/reset.
- `setObjectSelectionState`: updates the primary object selection and multi-selected object set together.
- `clearObjectSelectionState`: clears primary and multi-selected object state together.
- `clearLinkedFaceSelectionOverlay`: removes the linked-face line overlay.
- `removeLooseEdgeLoopCapFill`: removes one cap state's mesh while preserving or clearing state as directed by the caller.
- `removeCapOffsetGizmo`: removes the selected-loop cap offset gizmo, hides the `Ex. N` transform gizmo, and ends any active cap-offset drag.
- `clearLooseEdgeLoopCapStates`: removes all cap state and cap meshes, used when loading a new model.
- `restoreLooseEdgeLoopCapStates`: restores persisted cap/extrusion/cylinder modes by resolving stable loop segment keys after loose-edge groups are rebuilt.
- `refreshLooseEdgeLoopDisplayColors`: reapplies selected-object loose-edge contact-span red/green display colors from cap state and keeps the active selected span yellow.
- `refreshLooseEdgeLoopCapVisibility`: updates generated cap/extrusion/cylinder mesh visibility from hidden object IDs and applies object/loop selection occlusion overlay render state.
- `getLooseEdgeLoopMembers`: resolves the selected loose-edge contact span to its editable paired members.
- `getLooseEdgeLoopCapState`: reads the selected loop's cap state, falling back to a paired loop state when needed.
- `getLoopWorldAxis`: converts a loop-local cap axis to world space.
- `getMirroredLoopNormalTarget`: converts the selected loop's world-space cap axis into each paired loop's local target point.
- `refreshCapOffsetGizmo`: creates, updates, or hides the selected-loop cap offset gizmo from the current cap state, using an arrow helper for fixed-axis extrusions and a three-axis translate gizmo for `Ex. N`; `Filled` mode has no gizmo.
- `rebuildLooseEdgeLoopCapFill`: regenerates a cap/extrusion mesh after the mode, cone flag, or offset changes.
- `syncLooseEdgeLoopCapStates`: reconciles per-loop cap state against the latest grouped loose-edge contact spans after topology changes.
- `getLooseEdgeLoopCapMode`: reads the selected loop's stored cap mode.
- `setLooseEdgeLoopCapMode`: updates one loop or exact paired loop's cap/extrusion mode and lazily creates, replaces, or removes generated meshes for loop mode changes.
- `setLooseEdgeLoopCapCone`: updates one cylinder loop or exact paired loop's cone flag and regenerates generated meshes.
- `setLooseEdgeLoopCapOffset`: updates one loop or exact paired loop's stored cap offset and regenerates generated meshes.
- `setLooseEdgeLoopCapTarget`: updates one `Ex. N`/`Cyl. N` loop's stored normal-axis target, mirrors it to an exact paired loop when present, and regenerates generated meshes.
- `getFocusedObjectIds`: combines selected object IDs with the selected loose-edge contact-span parent object for outline focus rules.
- `refreshViewportObjectOutlines`: refreshes gray non-focused and yellow selected-object outlines for the active viewport model.
- `clearSelectedLooseEdgeLoop`: clears the secondary loose-edge contact-span selection and selected-span overlay while leaving cap meshes intact.
- `resetViewerStateForModelLoad`: clears runtime selection/progress/cap state before loading or restoring a model.
- `selectLooseEdgeLoop`: selects a hovered loose-edge contact span, shows it in yellow, and refreshes the active loop mode.
- `handleLooseEdgeLoopModeChange`: updates the selected loop's per-loop cap mode from the loop panel.
- `handleLooseEdgeLoopConeChange`: updates the selected cylinder loop's per-loop cone flag from the loop panel.
- `rememberTriangleSelection`: stores the latest mesh-clicked triangle as the candidate origin for later separate-mode selection.
- `getRememberedSelectedTriangle`: validates and returns the remembered origin only when it still belongs to the currently selected visible object.
- `applyLinkedFaceSelectionVisuals`: reapplies object colors and selected-face overlays.
- `clearLinkedFaceSelection`: clears linked-face selection and optionally clears selected object state.
- `restoreViewerHistorySnapshot`: restores one in-memory undo snapshot, clears transient selections, refreshes overlays/object summaries, and schedules persistence of the restored current state.
- `undoLastViewerAction`: pops and restores the latest undo snapshot unless separation work is busy.
- `toggleSeparateMode`: toggles dedicated separate mode for the selected object.
- `refreshLinkedFaceSelection`: recalculates selection at a committed threshold.
- `commitLinkedFaceSelectionThreshold`: commits a graph-selected threshold if it changed.
- `selectLinkedFace`: seeds linked-face selection from a clicked triangle in separate mode and reports calculation progress.
- `refreshSeparatedObjects`: rebuilds the object list from current geometry state.
- `setModelTextureVisibility`: stores runtime texture visibility on selectable meshes and rebuilds face material groups.
- `toggleTextureVisibility`: toggles the runtime texture view when the loaded model has texture maps.
- `applyObjectVisibility`: applies hidden object IDs to faces, wireframes, cap meshes, picking state, and object summaries.
- `toggleObjectVisibility`: toggles one object's hidden state.
- `hideSelectedObject`: hides all selected objects, or the active linked-face selection object when no multi-selection exists.
- `showAllObjects`: clears all hidden object IDs.
- `joinSelectedObjects`: joins connected selected object groups, refreshes model topology/render state, records undo history, and persists the edit.
- `selectSeparatedObject`: selects an object row or adds it to multi-selection, then clears linked-face selection while keeping object selection.
- `renameSeparatedObject`: saves or clears a custom object name.
- `setSeparateModeActiveState`: mirrors separate mode state into React state and the event-handler ref.
- `setSeparationBusyState`: mirrors separation busy state into React state and the event-handler ref.
- `handleSeparateSelection`: asynchronously separates the active linked-face selection, reports progress, and refreshes model/object state.
- `handleCutBoundaryLoop`: asynchronously cuts through one clicked boundary loop, isolates resulting loose components, and refreshes model/object state.
- `separateByBoundaryLoop`: dispatches a clicked boundary loop to the topology cut workflow.
- `clearHoveredEdge`: hides any active hover-edge overlay.
- `getMeshHitAtPointer`: raycasts visible selectable mesh faces.
- `getSelectionBoundaryEdgeAtPointer`: resolves the hovered separate-mode mask boundary loop at a pointer position.
- `getTriangleAtPointer`: resolves the clicked triangle at a pointer position.
- `handlePointerDown`: starts click tracking and captures hoverable loop/boundary targets for non-Shift clicks.
- `handlePointerUp`: selects objects, adds Shift-clicked objects to multi-selection, selects a separate-mode starting face, clears background selection, or selects a loop on non-Shift click.
- `handlePointerMove`: updates loose-edge and separate-boundary hover highlighting; separate mode suppresses existing loose-edge hover, and Shift suppresses loop hover.
- `handlePointerLeave`: clears hover-edge state.
- `handleKeyUp`: clears hover-edge state when Shift is released unless the event target is editable.
- `handleKeyDown`: handles `Command/Ctrl+Z` undo, `h`, `Option+H`, and `Command+H` visibility shortcuts unless the event target is editable.
- `handleResize`: keeps renderer, camera, and fat-line overlay resolutions in sync with viewport size.
- `render`: runs the animation frame loop.
- `loadModelIntoViewer`: parses source GLB bytes, rebuilds Three.js-derived model state, reapplies optional persisted edits, and frames the camera.
- `restorePersistedViewerState`: reads the IndexedDB snapshot on startup and restores it after the Three.js scene is ready.
- `openGlbFile`: validates a selected `.glb`, clears the saved snapshot for the new file, loads it from bytes, and persists the fresh source.
- `exportBlenderGlb`: exports separated object meshes with merged generated cap/extrusion/cylinder material groups as a binary GLB download.
- `handleFileChange`: extracts the selected file from the hidden input and dispatches GLB loading.

### Persistence Module

- `readPersistedViewerState`: opens IndexedDB and reads the current viewer snapshot.
- `savePersistedViewerState`: writes the current viewer snapshot to IndexedDB.
- `clearPersistedViewerState`: deletes the current viewer snapshot when a new GLB is opened or a saved restore is invalid.

### Tool Modules

- `ViewerTool`: describes a removable viewer feature by stable ID.
- `defaultViewerTools`: composes the default viewer feature set from `separationTool` and `edgeLoopCapTool`.
- `separationTool`: registers the linked-face separation feature under the `separation` ID.
- `SeparationToolPanel`: owns rendering of the linked-face separation panel.
- `edgeLoopCapTool`: registers loose-edge loop cap/extrude/cylinder tooling under the `edge-loop-cap` ID.
- `EdgeLoopCapToolPanel`: owns rendering of the loop cap/extrude/cylinder panel.

### Control Components

- `TopBar`: renders the hidden GLB file input, load button, undo button, export GLB button, and load/status text.
- `ObjectsPanel`: renders object summaries, multi-selection highlighting, the selected-object join action, object visibility toggles, inline name editing, and the adjacent texture visibility toggle.
- `LinkedFaceSelectionPanel`: renders the separate-mode toggle, starting-point prompt, progress text, selection count, clickable threshold graph, and `Apply`/`Clear` actions.
- `LoopPanel`: renders selected loose-edge contact-span controls as abbreviated `Mode` (`N`, `Cap`, `Ex`, `Cyl`) and `Axis` (`X`, `Y`, `Z`, `N`) segments, plus a cylinder-only `Cone` checkbox.

### Control Component Helpers

- `formatAngle`: formats integer and decimal threshold values.
- `getGraphPoint`: maps graph count data to SVG coordinates.
- `getGraphPoints`: serializes graph points for the SVG polyline.
- `getGraphMarker`: maps the active threshold to the SVG marker position.
- `getClickedGraphThreshold`: maps a graph click to the nearest threshold interval.
- `startEdit`: starts inline object-name editing.
- `commitEdit`: saves the inline object-name edit.
- `cancelEdit`: exits inline name editing without saving.
- `handleEditKeyDown`: stops inline-name editing key events from reaching viewer hotkeys and handles Enter/Escape.
