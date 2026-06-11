import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import {
  defaultObjectId,
  hoverEdgeColor,
  hoverEdgeLineWidth,
  hoverEdgeRenderOrder,
  looseEdgeLineWidth,
  maxSelectedObjectOutlineIds,
  nonFocusedObjectOutlineColor,
  nonFocusedObjectOutlinePixels,
  nonFocusedObjectOutlineRenderOrder,
  nonFocusedObjectOutlineStencilRef,
  nonFocusedObjectStencilRenderOrder,
  obstructedLooseEdgeLineWidth,
  obstructedLooseEdgeOpacity,
  selectedObjectOutlineRenderOrder,
  selectedObjectStencilRenderOrder,
  wireframeColor,
  wireframeOpacity,
  disposeMaterial,
  getMaterialTextureMaps,
  getSourceTriangleMaterialIndexes,
  getTriangleObjectIdSet,
  getTriangleObjectIds,
  isDisposableDrawObject,
  isMesh,
  isSelectableMesh,
} from "./model-viewer-shared";
import {
  createFaceMaterial,
  createSelectedObjectOutlineMaterial,
  createSelectedObjectStencilMaterial,
  refreshMeshObjectMaterialGroups,
} from "./materials";
import { refreshLooseEdgeOverlay } from "./loose-edge-geometry";

export function styleModel(model: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  const overlays: Array<{ overlay: THREE.Object3D; parent: THREE.Object3D }> = [];

  model.traverse((child) => {
    if (isMesh(child)) {
      meshes.push(child);
    }
  });

  meshes.forEach((mesh) => {
    const sourceGeometry = mesh.geometry;
    const sourcePosition = sourceGeometry.getAttribute("position");
    const sourceTriangleCount =
      sourceGeometry.index != null
        ? Math.floor(sourceGeometry.index.count / 3)
        : sourcePosition instanceof THREE.BufferAttribute
          ? Math.floor(sourcePosition.count / 3)
          : 0;
    const sourceMaterialIndexes = getSourceTriangleMaterialIndexes(
      sourceGeometry,
      sourceTriangleCount,
    );
    const sourceTextureMaps = getMaterialTextureMaps(mesh.material);
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const position = geometry.getAttribute("position");

    if (!(position instanceof THREE.BufferAttribute)) {
      return;
    }

    if (!(geometry.getAttribute("normal") instanceof THREE.BufferAttribute)) {
      geometry.computeVertexNormals();
    }

    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(position.count * 3), 3),
    );
    geometry.userData.triangleObjectIds = new Uint32Array(Math.floor(position.count / 3));
    geometry.userData.sourceMaterialIndexes = sourceMaterialIndexes;
    mesh.userData.sourceTextureMaps = sourceTextureMaps;
    mesh.userData.textureVisible = false;
    mesh.geometry = geometry;

    disposeMaterial(mesh.material);

    mesh.material = createFaceMaterial();
    refreshMeshObjectMaterialGroups(mesh, new Set<number>());

    const wireframe = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: wireframeColor,
        depthWrite: false,
        opacity: wireframeOpacity,
        transparent: true,
      }),
    );
    wireframe.position.copy(mesh.position);
    wireframe.quaternion.copy(mesh.quaternion);
    wireframe.scale.copy(mesh.scale);
    wireframe.matrix.copy(mesh.matrix);
    wireframe.matrixAutoUpdate = mesh.matrixAutoUpdate;
    wireframe.geometry = createObjectWireframeGeometry(mesh, new Set<number>());
    wireframe.name = "wireframe-overlay";
    wireframe.renderOrder = 1;
    wireframe.userData.isWireframeOverlay = true;
    wireframe.visible = false;
    mesh.userData.wireframeOverlay = wireframe;

    const obstructedLooseEdges = new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        linewidth: obstructedLooseEdgeLineWidth,
        opacity: obstructedLooseEdgeOpacity,
        transparent: true,
        vertexColors: true,
      }),
    );
    obstructedLooseEdges.name = "obstructed-loose-edge-overlay";
    obstructedLooseEdges.position.copy(mesh.position);
    obstructedLooseEdges.quaternion.copy(mesh.quaternion);
    obstructedLooseEdges.scale.copy(mesh.scale);
    obstructedLooseEdges.matrix.copy(mesh.matrix);
    obstructedLooseEdges.matrixAutoUpdate = mesh.matrixAutoUpdate;
    obstructedLooseEdges.renderOrder = 6;
    obstructedLooseEdges.userData.isLooseEdgeOverlay = true;
    obstructedLooseEdges.visible = false;
    mesh.userData.obstructedLooseEdgeOverlay = obstructedLooseEdges;

    const looseEdges = new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({
        color: 0xffffff,
        depthTest: true,
        depthWrite: false,
        linewidth: looseEdgeLineWidth,
        vertexColors: true,
      }),
    );
    looseEdges.name = "loose-edge-overlay";
    looseEdges.position.copy(mesh.position);
    looseEdges.quaternion.copy(mesh.quaternion);
    looseEdges.scale.copy(mesh.scale);
    looseEdges.matrix.copy(mesh.matrix);
    looseEdges.matrixAutoUpdate = mesh.matrixAutoUpdate;
    looseEdges.renderOrder = 7;
    looseEdges.userData.isLooseEdgeOverlay = true;
    looseEdges.visible = false;
    mesh.userData.looseEdgeOverlay = looseEdges;
    refreshLooseEdgeOverlay(mesh, new Set<number>(), null);

    const nonFocusedObjectStencil = new THREE.Mesh(
      geometry,
      createSelectedObjectStencilMaterial(nonFocusedObjectOutlineStencilRef),
    );
    nonFocusedObjectStencil.name = "non-focused-object-stencil-overlay";
    nonFocusedObjectStencil.position.copy(mesh.position);
    nonFocusedObjectStencil.quaternion.copy(mesh.quaternion);
    nonFocusedObjectStencil.scale.copy(mesh.scale);
    nonFocusedObjectStencil.matrix.copy(mesh.matrix);
    nonFocusedObjectStencil.matrixAutoUpdate = mesh.matrixAutoUpdate;
    nonFocusedObjectStencil.renderOrder = nonFocusedObjectStencilRenderOrder;
    nonFocusedObjectStencil.userData.isNonFocusedObjectStencilOverlay = true;
    nonFocusedObjectStencil.visible = false;
    mesh.userData.nonFocusedObjectStencilOverlay = nonFocusedObjectStencil;

    const nonFocusedObjectOutline = new THREE.Mesh(
      geometry,
      createSelectedObjectOutlineMaterial(
        nonFocusedObjectOutlineColor,
        nonFocusedObjectOutlinePixels,
        nonFocusedObjectOutlineStencilRef,
      ),
    );
    nonFocusedObjectOutline.name = "non-focused-object-outline-overlay";
    nonFocusedObjectOutline.position.copy(mesh.position);
    nonFocusedObjectOutline.quaternion.copy(mesh.quaternion);
    nonFocusedObjectOutline.scale.copy(mesh.scale);
    nonFocusedObjectOutline.matrix.copy(mesh.matrix);
    nonFocusedObjectOutline.matrixAutoUpdate = mesh.matrixAutoUpdate;
    nonFocusedObjectOutline.renderOrder = nonFocusedObjectOutlineRenderOrder;
    nonFocusedObjectOutline.userData.isNonFocusedObjectOutlineOverlay = true;
    nonFocusedObjectOutline.visible = false;
    mesh.userData.nonFocusedObjectOutlineOverlay = nonFocusedObjectOutline;

    const selectedObjectStencil = new THREE.Mesh(geometry, createSelectedObjectStencilMaterial());
    selectedObjectStencil.name = "selected-object-stencil-overlay";
    selectedObjectStencil.position.copy(mesh.position);
    selectedObjectStencil.quaternion.copy(mesh.quaternion);
    selectedObjectStencil.scale.copy(mesh.scale);
    selectedObjectStencil.matrix.copy(mesh.matrix);
    selectedObjectStencil.matrixAutoUpdate = mesh.matrixAutoUpdate;
    selectedObjectStencil.renderOrder = selectedObjectStencilRenderOrder;
    selectedObjectStencil.userData.isSelectedObjectStencilOverlay = true;
    selectedObjectStencil.visible = false;
    mesh.userData.selectedObjectStencilOverlay = selectedObjectStencil;

    const selectedObjectOutline = new THREE.Mesh(geometry, createSelectedObjectOutlineMaterial());
    selectedObjectOutline.name = "selected-object-outline-overlay";
    selectedObjectOutline.position.copy(mesh.position);
    selectedObjectOutline.quaternion.copy(mesh.quaternion);
    selectedObjectOutline.scale.copy(mesh.scale);
    selectedObjectOutline.matrix.copy(mesh.matrix);
    selectedObjectOutline.matrixAutoUpdate = mesh.matrixAutoUpdate;
    selectedObjectOutline.renderOrder = selectedObjectOutlineRenderOrder;
    selectedObjectOutline.userData.isSelectedObjectOutlineOverlay = true;
    selectedObjectOutline.visible = false;
    mesh.userData.selectedObjectOutlineOverlay = selectedObjectOutline;
    refreshObjectOutlineOverlay(mesh, new Set<number>(), new Set<number>(), new Set<number>());

    const hoverEdge = new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({
        color: hoverEdgeColor,
        depthTest: false,
        depthWrite: false,
        linewidth: hoverEdgeLineWidth,
      }),
    );
    hoverEdge.name = "hover-edge-overlay";
    hoverEdge.position.copy(mesh.position);
    hoverEdge.quaternion.copy(mesh.quaternion);
    hoverEdge.scale.copy(mesh.scale);
    hoverEdge.matrix.copy(mesh.matrix);
    hoverEdge.matrixAutoUpdate = mesh.matrixAutoUpdate;
    hoverEdge.renderOrder = hoverEdgeRenderOrder;
    hoverEdge.userData.isHoverEdgeOverlay = true;
    hoverEdge.visible = false;
    mesh.userData.hoverEdgeOverlay = hoverEdge;

    overlays.push({
      overlay: wireframe,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: obstructedLooseEdges,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: looseEdges,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: nonFocusedObjectStencil,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: nonFocusedObjectOutline,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: selectedObjectStencil,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: selectedObjectOutline,
      parent: mesh.parent ?? model,
    });
    overlays.push({
      overlay: hoverEdge,
      parent: mesh.parent ?? model,
    });
  });

  overlays.forEach(({ parent, overlay }) => {
    parent.add(overlay);
  });
}

export function createObjectWireframeGeometry(mesh: THREE.Mesh, hiddenObjectIds: Set<number>) {
  const geometry = new THREE.BufferGeometry();
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const segmentPositions: number[] = [];

  if (!(position instanceof THREE.BufferAttribute)) {
    return geometry;
  }

  for (let index = 0; index < position.count; index += 3) {
    const triangleIndex = index / 3;
    const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;

    if (hiddenObjectIds.has(objectId)) {
      continue;
    }

    const ax = position.getX(index);
    const ay = position.getY(index);
    const az = position.getZ(index);
    const bx = position.getX(index + 1);
    const by = position.getY(index + 1);
    const bz = position.getZ(index + 1);
    const cx = position.getX(index + 2);
    const cy = position.getY(index + 2);
    const cz = position.getZ(index + 2);

    segmentPositions.push(ax, ay, az, bx, by, bz, bx, by, bz, cx, cy, cz, cx, cy, cz, ax, ay, az);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(segmentPositions, 3));

  return geometry;
}

export function refreshObjectWireframe(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  showWireframes: boolean,
) {
  const wireframe = mesh.userData.wireframeOverlay as THREE.LineSegments | undefined;

  if (!wireframe) {
    return;
  }

  wireframe.geometry.dispose();
  wireframe.geometry = createObjectWireframeGeometry(mesh, hiddenObjectIds);

  const position = wireframe.geometry.getAttribute("position");

  wireframe.visible =
    showWireframes && position instanceof THREE.BufferAttribute && position.count > 0;
}

export function refreshObjectWireframes(
  model: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  showWireframes: boolean,
) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshObjectWireframe(child, hiddenObjectIds, showWireframes);
    }
  });
}

export function applyObjectIdOutlineUniforms(
  overlays: Array<THREE.Mesh | undefined>,
  visibleObjectIds: number[],
) {
  const isVisible = visibleObjectIds.length > 0;

  overlays.forEach((overlay) => {
    if (!overlay) {
      return;
    }

    overlay.visible = isVisible;

    if (overlay.material instanceof THREE.ShaderMaterial) {
      const uniformIds = overlay.material.uniforms.selectedObjectIds.value as number[];

      for (let index = 0; index < maxSelectedObjectOutlineIds; index += 1) {
        uniformIds[index] = visibleObjectIds[index] ?? -1;
      }

      overlay.material.uniforms.selectedObjectIdCount.value = visibleObjectIds.length;
    }
  });
}

export function refreshObjectBoundaryMaterialUniforms(
  mesh: THREE.Mesh,
  focusedObjectIds: Set<number>,
) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  materials.forEach((material) => {
    const objectId = material.userData.objectId;
    const outlineUniforms = material.userData.objectBoundaryOutlineUniforms as
      | {
          objectBoundaryOutlineEnabled?: { value: number };
        }
      | undefined;

    if (typeof objectId !== "number" || !outlineUniforms?.objectBoundaryOutlineEnabled) {
      return;
    }

    outlineUniforms.objectBoundaryOutlineEnabled.value = focusedObjectIds.has(objectId) ? 0 : 1;
  });
}

export function refreshObjectOutlineOverlay(
  mesh: THREE.Mesh,
  hiddenObjectIds: Set<number>,
  selectedObjectIds: Set<number>,
  focusedObjectIds: Set<number>,
) {
  refreshObjectBoundaryMaterialUniforms(mesh, focusedObjectIds);

  const nonFocusedStencil = mesh.userData.nonFocusedObjectStencilOverlay as THREE.Mesh | undefined;
  const nonFocusedOutline = mesh.userData.nonFocusedObjectOutlineOverlay as THREE.Mesh | undefined;
  const selectedStencil = mesh.userData.selectedObjectStencilOverlay as THREE.Mesh | undefined;
  const selectedOutline = mesh.userData.selectedObjectOutlineOverlay as THREE.Mesh | undefined;
  const objectIdSet = getTriangleObjectIdSet(mesh);
  const visibleNonFocusedObjectIds = Array.from(objectIdSet)
    .filter((objectId) => !hiddenObjectIds.has(objectId) && !focusedObjectIds.has(objectId))
    .slice(0, maxSelectedObjectOutlineIds);
  const visibleSelectedObjectIds = Array.from(selectedObjectIds)
    .filter((objectId) => !hiddenObjectIds.has(objectId) && objectIdSet.has(objectId))
    .slice(0, maxSelectedObjectOutlineIds);

  applyObjectIdOutlineUniforms([nonFocusedStencil, nonFocusedOutline], visibleNonFocusedObjectIds);
  applyObjectIdOutlineUniforms([selectedStencil, selectedOutline], visibleSelectedObjectIds);
}

export function refreshObjectOutlines(
  model: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  selectedObjectIds: Set<number>,
  focusedObjectIds: Set<number>,
) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshObjectOutlineOverlay(child, hiddenObjectIds, selectedObjectIds, focusedObjectIds);
    }
  });
}

export function updateHoverEdgeResolution(model: THREE.Object3D, width: number, height: number) {
  model.traverse((child) => {
    if (
      (child.userData.isHoverEdgeOverlay !== true &&
        child.userData.isLooseEdgeOverlay !== true &&
        child.userData.isLooseEdgeSelectionOverlay !== true &&
        child.userData.isNonFocusedObjectOutlineOverlay !== true &&
        child.userData.isSelectedObjectOutlineOverlay !== true &&
        child.userData.isLinkedFaceSelectionOverlay !== true &&
        child.userData.isSelectionBoundaryLoopOverlay !== true) ||
      !isDisposableDrawObject(child)
    ) {
      return;
    }

    if (child.material instanceof LineMaterial) {
      child.material.resolution.set(width, height);
    }

    if (
      (child.userData.isSelectedObjectOutlineOverlay === true ||
        child.userData.isNonFocusedObjectOutlineOverlay === true) &&
      child.material instanceof THREE.ShaderMaterial
    ) {
      const resolution = child.material.uniforms.resolution?.value;

      if (resolution instanceof THREE.Vector2) {
        resolution.set(width, height);
      }
    }
  });
}
