import * as THREE from "three";

import {
  capOffsetGizmoColor,
  capOffsetGizmoHeadScale,
  capOffsetGizmoMinLength,
  looseEdgeHoverRenderOrder,
  selectedLooseEdgeLoopColor,
  applyObjectColors,
  applySelectedObjectJoinPlan,
  clampLooseEdgeLoopCapOffset,
  clearHoverEdgeOverlay,
  collectSelectableMeshes,
  collectSeparatedObjects,
  createSelectedObjectJoinPlan,
  createLooseEdgeFromLoop,
  createLooseEdgeLoopFillFromData,
  createLooseEdgeLoopFillOcclusionOverlay,
  createLooseEdgeLoopOverlay,
  disposeLooseEdgeLoopFillOcclusionOverlay,
  disposeObject,
  ensureMeshEditState,
  getLinkedLooseEdgeLoopMembers,
  getLooseEdgeLoop,
  getLooseEdgeLoopCacheKey,
  getLooseEdgeLoopCapAxisData,
  getLooseEdgeLoopCapAxisDataForEdges,
  getLooseEdgeLoopFillData,
  getLooseEdgeLoopsFillData,
  getLooseEdgeLoopFillKey,
  getLooseEdgeLoopFromPersistedState,
  getTriangleObjectIds,
  isDisposableDrawObject,
  isNormalTargetLoopMode,
  isSameLooseEdgeLoop,
  isSelectableMesh,
  refreshLooseEdgeOverlay,
  refreshObjectMaterialGroups,
  setLooseEdgeLoopColor,
  setEdgesCut,
  setLooseEdgeLoopFillBaseMaterial,
  supportsConeLoopMode,
  type HoveredEdge,
  type LooseEdgeLoop,
  type LooseEdgeLoopCapState,
  type LooseEdgeSegment,
} from "./model-viewer-core";
import type { PersistedLoopCapState } from "./persistence";
import type { LooseEdgeLoopMode } from "../viewer-controls/types";
import type { ModelViewerLoopCapsParams } from "./model-viewer-loop-caps-types";

function getLoopCapAxisTarget(state: LooseEdgeLoopCapState) {
  return isNormalTargetLoopMode(state.mode)
    ? (state.normalAxisTarget ?? state.normalTarget)
    : state.normalTarget;
}

function getSelectedLoopKey(edge: HoveredEdge) {
  return `${edge.mesh.uuid}:${edge.loopId ?? -1}`;
}

function getLoopGroupKey(edges: HoveredEdge[]) {
  return edges
    .map((edge) => getLooseEdgeLoopFillKey(edge))
    .sort()
    .join("||");
}

export function useModelViewerLoopCaps(params: ModelViewerLoopCapsParams) {
  const {
    rootRef,
    controlsRef,
    capOffsetDragRef,
    capOffsetGizmoHandleRef,
    capOffsetGizmoRef,
    capNormalTargetRef,
    capNormalTransformControlsRef,
    capNormalTransformHelperRef,
    looseEdgeLoopCapStatesRef,
    selectedLooseEdgeLoopRef,
    selectedLooseEdgeLoopsRef,
    selectedLooseEdgeLoopOverlayRef,
    hiddenObjectIdsRef,
    objectNamesRef,
    selectedObjectIdRef,
    isEdgeLoopCapToolEnabled,
    isEdgeLoopCapToolEnabledRef,
    clearLinkedFaceSelectionHandlerRef,
    createCurrentViewerHistorySnapshot,
    pushViewerHistorySnapshot,
    refreshLooseEdgeLoopDisplayColors,
    refreshViewportObjectOutlines,
    schedulePersistViewerState,
    setLooseEdgeLoopCone,
    setLooseEdgeLoopMode,
    setSelectedLooseEdgeLoopActive,
    setSelectedLooseEdgeLoopRemovable,
    setSeparatedObjects,
  } = params;

  const removeLooseEdgeLoopCapFill = (state: LooseEdgeLoopCapState) => {
    disposeLooseEdgeLoopFillOcclusionOverlay(state);

    if (!state.fill) {
      return;
    }

    state.fill.parent?.remove(state.fill);
    disposeObject(state.fill);
    state.fill = null;
  };

  const removeCapOffsetGizmo = () => {
    capOffsetDragRef.current = null;
    const controls = controlsRef.current;
    const transformControls = capNormalTransformControlsRef.current;
    const transformHelper = capNormalTransformHelperRef.current;
    const transformTarget = capNormalTargetRef.current;

    if (controls) {
      controls.enabled = true;
    }

    transformControls?.detach();

    if (transformHelper) {
      transformHelper.visible = false;
    }

    if (transformTarget) {
      transformTarget.visible = false;
    }

    const gizmo = capOffsetGizmoRef.current;

    if (!gizmo) {
      return;
    }

    gizmo.parent?.remove(gizmo);
    disposeObject(gizmo);
    capOffsetGizmoRef.current = null;
    capOffsetGizmoHandleRef.current = null;
  };

  const clearLooseEdgeLoopCapStates = () => {
    removeCapOffsetGizmo();
    looseEdgeLoopCapStatesRef.current.forEach((state) => {
      removeLooseEdgeLoopCapFill(state);
    });
    looseEdgeLoopCapStatesRef.current.clear();
  };

  const refreshLooseEdgeLoopCapVisibility = (hiddenObjectIds = hiddenObjectIdsRef.current) => {
    const overlayActive =
      selectedObjectIdRef.current != null || selectedLooseEdgeLoopRef.current != null;

    looseEdgeLoopCapStatesRef.current.forEach((state) => {
      if (!state.fill) {
        return;
      }

      if (!state.fill.parent) {
        disposeLooseEdgeLoopFillOcclusionOverlay(state);
        state.fill = null;
        return;
      }

      state.fill.visible = !hiddenObjectIds.has(state.objectId);
      setLooseEdgeLoopFillBaseMaterial(state.fill, overlayActive);

      if (!overlayActive || !state.fill.visible) {
        if (state.occlusionOverlay) {
          state.occlusionOverlay.visible = false;
        }
        return;
      }

      if (!state.occlusionOverlay) {
        state.occlusionOverlay = createLooseEdgeLoopFillOcclusionOverlay(state.fill);
      }

      if (state.occlusionOverlay.parent !== state.fill.parent) {
        state.occlusionOverlay.parent?.remove(state.occlusionOverlay);
        state.fill.parent.add(state.occlusionOverlay);
      }

      state.occlusionOverlay.position.copy(state.fill.position);
      state.occlusionOverlay.quaternion.copy(state.fill.quaternion);
      state.occlusionOverlay.scale.copy(state.fill.scale);
      state.occlusionOverlay.matrix.copy(state.fill.matrix);
      state.occlusionOverlay.matrixAutoUpdate = state.fill.matrixAutoUpdate;
      state.occlusionOverlay.visible = true;
    });
  };

  const getLooseEdgeLoopMembers = (edge: HoveredEdge) =>
    getLinkedLooseEdgeLoopMembers(rootRef.current, edge);

  const getLoopEdgeByCacheKey = (mesh: THREE.Mesh, key: string) => {
    const loopsById = mesh.userData.looseEdgeLoopById as Map<number, LooseEdgeLoop> | undefined;

    if (!(loopsById instanceof Map)) {
      return null;
    }

    for (const loop of loopsById.values()) {
      if (getLooseEdgeLoopCacheKey(mesh, loop) !== key) {
        continue;
      }

      return createLooseEdgeFromLoop(mesh, loop);
    }

    return null;
  };

  const getStateSourceMesh = (state: LooseEdgeLoopCapState) => {
    const modelRoot = rootRef.current;

    return modelRoot
      ? (collectSelectableMeshes(modelRoot).find((mesh) => mesh.uuid === state.sourceMeshUuid) ??
          null)
      : null;
  };

  const getLooseEdgeLoopCapStateEdges = (edge: HoveredEdge, state: LooseEdgeLoopCapState) => {
    if (!state.groupLoopKeys || state.groupLoopKeys.length <= 1) {
      return [edge];
    }

    const sourceMesh = getStateSourceMesh(state) ?? edge.mesh;
    const edges = state.groupLoopKeys
      .map((key) => getLoopEdgeByCacheKey(sourceMesh, key))
      .filter((item): item is HoveredEdge => Boolean(item));

    return edges.length > 0 ? edges : [edge];
  };

  const getLooseEdgeLoopCapStateAxisData = (
    edge: HoveredEdge,
    state: LooseEdgeLoopCapState,
    normalTarget = getLoopCapAxisTarget(state),
  ) => {
    const edges = getLooseEdgeLoopCapStateEdges(edge, state);

    return edges.length > 1
      ? getLooseEdgeLoopCapAxisDataForEdges(edge, edges, state.mode, normalTarget)
      : getLooseEdgeLoopCapAxisData(edge, state.mode, normalTarget);
  };

  const getLooseEdgeLoopCapState = (edge: HoveredEdge) => {
    const directState = looseEdgeLoopCapStatesRef.current.get(getLooseEdgeLoopFillKey(edge));

    if (directState) {
      return directState;
    }

    return (
      getLooseEdgeLoopMembers(edge)
        .map((member) => looseEdgeLoopCapStatesRef.current.get(member.key))
        .find((state): state is LooseEdgeLoopCapState => Boolean(state)) ?? null
    );
  };

  const isSelectedLooseEdgeLoop = (edge: HoveredEdge) =>
    selectedLooseEdgeLoopsRef.current.some((selectedLoop) =>
      isSameLooseEdgeLoop(selectedLoop, edge),
    );

  const getEditableLooseEdgeLoops = (edge: HoveredEdge) => {
    const sameMeshSelectedLoops = selectedLooseEdgeLoopsRef.current.filter(
      (selectedLoop) => selectedLoop.mesh === edge.mesh,
    );

    return sameMeshSelectedLoops.some((selectedLoop) => isSameLooseEdgeLoop(selectedLoop, edge))
      ? sameMeshSelectedLoops
      : [edge];
  };

  const getLooseEdgeLoopCutEdgeIds = (edge: HoveredEdge) => {
    const loop = getLooseEdgeLoop(edge.mesh, edge.loopId);
    const segmentsByKey = edge.mesh.userData.looseEdgeSegmentsByKey as
      | Map<string, LooseEdgeSegment>
      | undefined;
    const editState = ensureMeshEditState(edge.mesh);
    const edgeIds = new Set<number>();

    if (!loop || !(segmentsByKey instanceof Map) || !editState) {
      return edgeIds;
    }

    loop.segmentKeys.forEach((segmentKey) => {
      const segment = segmentsByKey.get(segmentKey);
      const edgeId = segment?.edgeId;

      if (edgeId != null && editState.edgeCut[edgeId] === 1) {
        edgeIds.add(edgeId);
      }
    });

    return edgeIds;
  };

  const getCutEdgeIdsByMeshForLoops = (edges: HoveredEdge[]) => {
    const edgeIdsByMesh = new Map<THREE.Mesh, Set<number>>();

    edges.forEach((edge) => {
      getLooseEdgeLoopMembers(edge).forEach((member) => {
        const edgeIds = getLooseEdgeLoopCutEdgeIds(member.edge);

        if (edgeIds.size === 0) {
          return;
        }

        let meshEdgeIds = edgeIdsByMesh.get(member.edge.mesh);

        if (!meshEdgeIds) {
          meshEdgeIds = new Set<number>();
          edgeIdsByMesh.set(member.edge.mesh, meshEdgeIds);
        }

        edgeIds.forEach((edgeId) => {
          meshEdgeIds.add(edgeId);
        });
      });
    });

    return edgeIdsByMesh;
  };

  const hasRemovableLooseEdgeLoops = (edges: HoveredEdge[]) =>
    Array.from(getCutEdgeIdsByMeshForLoops(edges).values()).some((edgeIds) => edgeIds.size > 0);

  const getLoopJoinObjectIds = (edges: HoveredEdge[]) => {
    const objectIds = new Set<number>();

    edges.forEach((edge) => {
      getLooseEdgeLoopMembers(edge).forEach((member) => {
        const loop = getLooseEdgeLoop(member.edge.mesh, member.edge.loopId);

        if (!loop || getLooseEdgeLoopCutEdgeIds(member.edge).size === 0) {
          return;
        }

        objectIds.add(member.edge.objectId);
        loop.contactObjectIds.forEach((objectId) => {
          objectIds.add(objectId);
        });
      });
    });

    return objectIds;
  };

  const getMeshesForObjectIds = (modelRoot: THREE.Object3D, objectIds: Set<number>) => {
    if (objectIds.size === 0) {
      return new Set<THREE.Mesh>();
    }

    const meshes = new Set<THREE.Mesh>();

    collectSelectableMeshes(modelRoot).forEach((mesh) => {
      const triangleObjectIds = getTriangleObjectIds(mesh);

      if (!triangleObjectIds) {
        return;
      }

      for (let index = 0; index < triangleObjectIds.length; index += 1) {
        if (objectIds.has(triangleObjectIds[index] ?? 0)) {
          meshes.add(mesh);
          return;
        }
      }
    });

    return meshes;
  };

  const refreshSeparatedObjectList = (modelRoot: THREE.Object3D | null = rootRef.current) => {
    setSeparatedObjects(
      modelRoot
        ? collectSeparatedObjects(modelRoot, hiddenObjectIdsRef.current, objectNamesRef.current)
        : [],
    );
  };

  const getLoopCapEditGroups = (edge: HoveredEdge) => {
    const selectedEdges = getEditableLooseEdgeLoops(edge);
    const groups = new Map<
      string,
      {
        edges: HoveredEdge[];
        keys: string[];
        primaryEdge: HoveredEdge;
      }
    >();

    selectedEdges.forEach((selectedEdge) => {
      getLooseEdgeLoopMembers(selectedEdge).forEach((member) => {
        const groupKey = `${member.edge.mesh.uuid}:${member.edge.objectId}`;
        const existingGroup = groups.get(groupKey);
        const loopKey = member.key;

        if (existingGroup) {
          if (!existingGroup.keys.includes(loopKey)) {
            existingGroup.edges.push(member.edge);
            existingGroup.keys.push(loopKey);
          }
          return;
        }

        groups.set(groupKey, {
          edges: [member.edge],
          keys: [loopKey],
          primaryEdge: member.edge,
        });
      });
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      keys: [...group.keys].sort(),
    }));
  };

  const refreshSelectedLooseEdgeLoopState = (preferredPrimary: HoveredEdge | null = null) => {
    const selectedLoops = selectedLooseEdgeLoopsRef.current;
    const primary =
      preferredPrimary && isSelectedLooseEdgeLoop(preferredPrimary)
        ? preferredPrimary
        : (selectedLoops[selectedLoops.length - 1] ?? null);

    selectedLooseEdgeLoopRef.current = primary;
    setSelectedLooseEdgeLoopActive(selectedLoops.length > 0);
    setSelectedLooseEdgeLoopRemovable(hasRemovableLooseEdgeLoops(selectedLoops));

    if (primary) {
      setLooseEdgeLoopMode(getLooseEdgeLoopCapMode(primary));
      setLooseEdgeLoopCone(getLooseEdgeLoopCapCone(primary));
      refreshCapOffsetGizmo(primary);
    } else {
      setLooseEdgeLoopMode("none");
      setLooseEdgeLoopCone(false);
      removeCapOffsetGizmo();
    }

    refreshLooseEdgeLoopCapVisibility();
    refreshViewportObjectOutlines(primary?.mesh.parent ?? rootRef.current);
    refreshLooseEdgeLoopDisplayColors(primary?.mesh.parent ?? rootRef.current);
  };

  const removeSelectedLooseEdgeLoopOverlay = (edge: HoveredEdge) => {
    const key = getSelectedLoopKey(edge);
    const overlay = selectedLooseEdgeLoopOverlayRef.current.get(key);

    if (!overlay) {
      return;
    }

    overlay.parent?.remove(overlay);
    disposeObject(overlay);
    selectedLooseEdgeLoopOverlayRef.current.delete(key);
  };

  const addSelectedLooseEdgeLoopOverlay = (edge: HoveredEdge) => {
    removeSelectedLooseEdgeLoopOverlay(edge);
    setLooseEdgeLoopColor(edge.mesh, edge.loopId, selectedLooseEdgeLoopColor);

    const overlay = createLooseEdgeLoopOverlay(edge, selectedLooseEdgeLoopColor);

    if (!overlay) {
      return;
    }

    (edge.mesh.parent ?? rootRef.current)?.add(overlay);
    selectedLooseEdgeLoopOverlayRef.current.set(getSelectedLoopKey(edge), overlay);
  };

  const getMirroredLoopNormalTarget = (
    sourceEdge: HoveredEdge,
    memberEdge: HoveredEdge,
    sourceAxis: THREE.Vector3,
    offset: number,
  ) => {
    const sourceData = getLooseEdgeLoopFillData(sourceEdge);
    const memberData = getLooseEdgeLoopFillData(memberEdge);

    if (!sourceData || !memberData || sourceAxis.lengthSq() === 0) {
      return null;
    }

    sourceEdge.mesh.updateMatrixWorld(true);
    memberEdge.mesh.updateMatrixWorld(true);

    const targetDistance = Math.max(Math.abs(offset), 0.001);
    const sourceCenterWorld = sourceEdge.mesh.localToWorld(sourceData.center.clone());
    const sourceTargetWorld = sourceEdge.mesh.localToWorld(
      sourceData.center.clone().addScaledVector(sourceAxis, targetDistance),
    );
    const sourceOffsetWorld = sourceTargetWorld.sub(sourceCenterWorld);
    const memberCenterWorld = memberEdge.mesh.localToWorld(memberData.center.clone());
    const targetWorld = memberCenterWorld.add(sourceOffsetWorld);

    return memberEdge.mesh.worldToLocal(targetWorld);
  };

  const getMirroredGroupNormalTarget = (
    sourceGroup: { edges: HoveredEdge[]; primaryEdge: HoveredEdge },
    memberGroup: { edges: HoveredEdge[]; primaryEdge: HoveredEdge },
    sourceAxis: THREE.Vector3,
    offset: number,
  ) => {
    const sourceData = getLooseEdgeLoopsFillData(sourceGroup.edges);
    const memberData = getLooseEdgeLoopsFillData(memberGroup.edges);

    if (!sourceData || !memberData || sourceAxis.lengthSq() === 0) {
      return null;
    }

    sourceGroup.primaryEdge.mesh.updateMatrixWorld(true);
    memberGroup.primaryEdge.mesh.updateMatrixWorld(true);

    const targetDistance = Math.max(Math.abs(offset), 0.001);
    const sourceCenterWorld = sourceGroup.primaryEdge.mesh.localToWorld(sourceData.center.clone());
    const sourceTargetWorld = sourceGroup.primaryEdge.mesh.localToWorld(
      sourceData.center.clone().addScaledVector(sourceAxis, targetDistance),
    );
    const sourceOffsetWorld = sourceTargetWorld.sub(sourceCenterWorld);
    const memberCenterWorld = memberGroup.primaryEdge.mesh.localToWorld(memberData.center.clone());
    const targetWorld = memberCenterWorld.add(sourceOffsetWorld);

    return memberGroup.primaryEdge.mesh.worldToLocal(targetWorld);
  };

  const refreshCapOffsetGizmo = (edge = selectedLooseEdgeLoopRef.current) => {
    const modelRoot = rootRef.current;

    if (!edge || !modelRoot || !isSameLooseEdgeLoop(edge, selectedLooseEdgeLoopRef.current)) {
      removeCapOffsetGizmo();
      return;
    }

    const key = getLooseEdgeLoopFillKey(edge);
    const state = getLooseEdgeLoopCapState(edge);
    const axisData = state ? getLooseEdgeLoopCapStateAxisData(edge, state) : null;
    const parent = edge.mesh.parent ?? modelRoot;

    if (
      !state ||
      !state.fill ||
      !axisData ||
      hiddenObjectIdsRef.current.has(edge.objectId) ||
      state.mode === "none" ||
      state.mode === "fill"
    ) {
      removeCapOffsetGizmo();
      return;
    }

    if (isNormalTargetLoopMode(state.mode)) {
      const transformControls = capNormalTransformControlsRef.current;
      const transformHelper = capNormalTransformHelperRef.current;
      const transformTarget = capNormalTargetRef.current;

      if (transformControls && transformHelper && transformTarget) {
        edge.mesh.updateMatrixWorld(true);
        transformTarget.position.copy(
          edge.mesh.localToWorld(
            axisData.data.center.clone().addScaledVector(axisData.axis, state.offset),
          ),
        );
        transformTarget.visible = true;
        transformControls.setMode("translate");
        transformControls.setSpace("world");
        transformControls.setSize(0.7);
        transformControls.showX = true;
        transformControls.showY = true;
        transformControls.showZ = true;
        transformControls.showXY = false;
        transformControls.showYZ = false;
        transformControls.showXZ = false;
        transformControls.attach(transformTarget);
        transformControls.enabled = true;
        transformHelper.visible = true;
      }
    } else {
      capNormalTransformControlsRef.current?.detach();

      if (capNormalTransformHelperRef.current) {
        capNormalTransformHelperRef.current.visible = false;
      }

      if (capNormalTargetRef.current) {
        capNormalTargetRef.current.visible = false;
      }
    }

    let gizmo = capOffsetGizmoRef.current;
    let handle = capOffsetGizmoHandleRef.current;
    let arrow = gizmo?.userData.arrowHelper as THREE.ArrowHelper | undefined;

    if (!gizmo || !handle || !arrow) {
      gizmo = new THREE.Group();
      gizmo.name = "cap-offset-gizmo-overlay";
      gizmo.renderOrder = looseEdgeHoverRenderOrder + 1;
      gizmo.userData.isCapOffsetGizmoOverlay = true;
      gizmo.userData.fillKey = key;

      arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(),
        1,
        capOffsetGizmoColor,
      );
      arrow.name = "cap-offset-arrow-overlay";
      arrow.userData.isCapOffsetGizmoOverlay = true;
      arrow.userData.fillKey = key;
      arrow.traverse((child) => {
        child.renderOrder = looseEdgeHoverRenderOrder + 1;
        child.userData.isCapOffsetGizmoOverlay = true;
        child.userData.fillKey = key;

        if (!isDisposableDrawObject(child)) {
          return;
        }

        const materials = Array.isArray(child.material) ? child.material : [child.material];

        materials.forEach((material) => {
          material.depthTest = false;
          material.depthWrite = false;
          material.opacity = 0.96;
          material.transparent = true;
        });
      });

      gizmo.userData.arrowHelper = arrow;
      gizmo.add(arrow);
      handle = arrow;

      capOffsetGizmoRef.current = gizmo;
      capOffsetGizmoHandleRef.current = handle;
    }

    if (gizmo.parent !== parent) {
      gizmo.parent?.remove(gizmo);
      parent.add(gizmo);
    }

    gizmo.position.copy(edge.mesh.position);
    gizmo.quaternion.copy(edge.mesh.quaternion);
    gizmo.scale.copy(edge.mesh.scale);
    gizmo.matrix.copy(edge.mesh.matrix);
    gizmo.matrixAutoUpdate = edge.mesh.matrixAutoUpdate;
    gizmo.visible = true;
    gizmo.userData.fillKey = key;
    handle.userData.fillKey = key;
    gizmo.traverse((child) => {
      child.userData.isCapOffsetGizmoOverlay = true;
      child.userData.fillKey = key;
    });

    const targetOffset = axisData.axis.clone().multiplyScalar(state.offset);
    const arrowDirection =
      targetOffset.lengthSq() > 0 ? targetOffset.clone().normalize() : axisData.axis.clone();
    const loopSize = new THREE.Box3()
      .setFromPoints(axisData.data.points)
      .getSize(new THREE.Vector3());
    const loopSpan = Math.max(loopSize.x, loopSize.y, loopSize.z);
    const visualLength = Math.max(targetOffset.length(), loopSpan * 0.12, capOffsetGizmoMinLength);
    const headLength = Math.min(
      visualLength * 0.35,
      Math.max(loopSpan * capOffsetGizmoHeadScale, 0.025),
    );
    const headWidth = headLength * 0.6;

    arrow.position.copy(axisData.data.center);
    arrow.setDirection(arrowDirection);
    arrow.setLength(visualLength, headLength, headWidth);
    arrow.setColor(capOffsetGizmoColor);
    gizmo.userData.hitStartLocal = axisData.data.center.clone();
    gizmo.userData.hitEndLocal = axisData.data.center
      .clone()
      .addScaledVector(arrowDirection, visualLength);
    gizmo.userData.hitVisualLength = visualLength;
  };

  const rebuildLooseEdgeLoopCapFill = (
    edge: HoveredEdge,
    key: string,
    state: LooseEdgeLoopCapState,
  ) => {
    const axisData = getLooseEdgeLoopCapStateAxisData(edge, state);

    if (!axisData) {
      return;
    }

    if (state.fill) {
      removeLooseEdgeLoopCapFill(state);
    }

    if (isNormalTargetLoopMode(state.mode)) {
      state.offset = clampLooseEdgeLoopCapOffset(
        edge,
        state.mode,
        state.offset,
        getLoopCapAxisTarget(state),
      );

      if (!state.normalAxisTarget) {
        state.normalAxisTarget = state.normalTarget
          ? state.normalTarget.clone()
          : axisData.data.center
              .clone()
              .addScaledVector(axisData.axis, Math.max(Math.abs(state.offset), 0.001));
      }

      state.normalTarget = axisData.data.center
        .clone()
        .addScaledVector(axisData.axis, state.offset);
    } else {
      state.offset = clampLooseEdgeLoopCapOffset(
        edge,
        state.mode,
        state.offset,
        getLoopCapAxisTarget(state),
      );
    }

    const stateEdges = getLooseEdgeLoopCapStateEdges(edge, state);
    const fillData =
      stateEdges.length > 1
        ? getLooseEdgeLoopsFillData(stateEdges)
        : getLooseEdgeLoopFillData(edge);
    const stateKeys =
      state.groupLoopKeys && state.groupLoopKeys.length > 0 ? state.groupLoopKeys : [key];
    const fillKey =
      state.groupLoopKeys && state.groupLoopKeys.length > 1 ? getLoopGroupKey(stateEdges) : key;
    const fill = fillData
      ? createLooseEdgeLoopFillFromData(
          edge,
          fillData,
          state.mode,
          state.offset,
          getLoopCapAxisTarget(state),
          state.cone,
          fillKey,
        )
      : null;
    const parent = edge.mesh.parent ?? rootRef.current;

    if (!fill || !parent) {
      if (fill) {
        disposeObject(fill);
      }
      stateKeys.forEach((stateKey) => looseEdgeLoopCapStatesRef.current.set(stateKey, state));
      return;
    }

    parent.add(fill);
    fill.visible = !hiddenObjectIdsRef.current.has(edge.objectId);
    state.fill = fill;
    stateKeys.forEach((stateKey) => looseEdgeLoopCapStatesRef.current.set(stateKey, state));
    refreshLooseEdgeLoopCapVisibility();
  };

  const restoreLooseEdgeLoopCapStates = (
    modelRoot: THREE.Object3D,
    capStates: PersistedLoopCapState[],
  ) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return false;
    }

    const meshes = collectSelectableMeshes(modelRoot);
    let hadInvalidState = false;

    capStates.forEach((capState) => {
      const mesh = meshes[capState.meshIndex];

      if (!mesh) {
        hadInvalidState = true;
        return;
      }

      const loop = getLooseEdgeLoopFromPersistedState(mesh, capState);
      const edge = loop ? createLooseEdgeFromLoop(mesh, loop) : null;

      if (!edge || capState.mode === "none") {
        hadInvalidState = true;
        return;
      }

      const key = getLooseEdgeLoopFillKey(edge);
      const groupedEdges =
        capState.groupSegmentKeys && capState.groupSegmentKeys.length > 1
          ? capState.groupSegmentKeys
              .map((segmentKeys) =>
                getLooseEdgeLoopFromPersistedState(mesh, { ...capState, segmentKeys }),
              )
              .map((groupLoop) => (groupLoop ? createLooseEdgeFromLoop(mesh, groupLoop) : null))
              .filter((item): item is HoveredEdge => Boolean(item))
          : [edge];
      const groupLoopKeys =
        groupedEdges.length > 1
          ? groupedEdges.map((groupEdge) => getLooseEdgeLoopFillKey(groupEdge)).sort()
          : undefined;
      const normalTarget =
        capState.normalTarget && capState.mode !== "fill"
          ? new THREE.Vector3(
              capState.normalTarget[0],
              capState.normalTarget[1],
              capState.normalTarget[2],
            )
          : null;
      const normalAxisTarget = capState.normalAxisTarget
        ? new THREE.Vector3(
            capState.normalAxisTarget[0],
            capState.normalAxisTarget[1],
            capState.normalAxisTarget[2],
          )
        : isNormalTargetLoopMode(capState.mode) && normalTarget
          ? normalTarget.clone()
          : null;
      const axisTarget = isNormalTargetLoopMode(capState.mode)
        ? (normalAxisTarget ?? normalTarget)
        : normalTarget;
      const axisData =
        groupedEdges.length > 1
          ? getLooseEdgeLoopCapAxisDataForEdges(edge, groupedEdges, capState.mode, axisTarget)
          : getLooseEdgeLoopCapAxisData(edge, capState.mode, axisTarget);

      if (!axisData) {
        hadInvalidState = true;
        return;
      }

      const state: LooseEdgeLoopCapState = {
        cone: capState.cone === true,
        fill: null,
        groupLoopKeys,
        mode: capState.mode,
        normalAxisTarget,
        normalTarget,
        objectId: edge.objectId,
        occlusionOverlay: null,
        offset: capState.mode === "fill" ? 0 : capState.offset,
        sourceMeshUuid: mesh.uuid,
      };

      state.offset = clampLooseEdgeLoopCapOffset(edge, state.mode, state.offset, axisTarget);

      if (isNormalTargetLoopMode(state.mode) && !state.normalTarget) {
        state.normalTarget = axisData.data.center
          .clone()
          .addScaledVector(axisData.axis, state.offset);
      }

      if (isNormalTargetLoopMode(state.mode) && !state.normalAxisTarget) {
        state.normalAxisTarget = state.normalTarget
          ? state.normalTarget.clone()
          : axisData.data.center
              .clone()
              .addScaledVector(axisData.axis, Math.max(Math.abs(state.offset), 0.001));
      }

      rebuildLooseEdgeLoopCapFill(edge, key, state);
    });

    refreshLooseEdgeLoopCapVisibility();
    refreshLooseEdgeLoopDisplayColors(modelRoot);

    return hadInvalidState;
  };

  const setLooseEdgeLoopCapTargetSingle = (edge: HoveredEdge, target: THREE.Vector3) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const state = getLooseEdgeLoopCapState(edge);

    if (!state || !isNormalTargetLoopMode(state.mode)) {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const axisData = getLooseEdgeLoopCapAxisData(edge, state.mode, target);

    if (!axisData) {
      return;
    }

    const requestedOffset = target.distanceTo(axisData.data.center);
    const nextOffset = requestedOffset;
    const nextTarget = target.clone();
    const nextAxisTarget =
      requestedOffset > 0.001
        ? nextTarget.clone()
        : axisData.data.center.clone().addScaledVector(axisData.axis, 0.001);
    const missingMemberState = members.some(
      (member) => !looseEdgeLoopCapStatesRef.current.has(member.key),
    );

    if (
      !missingMemberState &&
      Math.abs(nextOffset - state.offset) < 0.0001 &&
      state.normalTarget &&
      state.normalAxisTarget &&
      nextTarget.distanceToSquared(state.normalTarget) < 0.000001 &&
      nextAxisTarget.distanceToSquared(state.normalAxisTarget) < 0.000001
    ) {
      return;
    }

    members.forEach((member) => {
      const memberState = looseEdgeLoopCapStatesRef.current.get(member.key) ?? {
        cone: state.cone,
        fill: null,
        mode: state.mode,
        normalAxisTarget: null,
        normalTarget: null,
        objectId: member.edge.objectId,
        occlusionOverlay: null,
        offset: nextOffset,
        sourceMeshUuid: member.edge.mesh.uuid,
      };

      memberState.cone = state.cone;
      memberState.mode = state.mode;
      memberState.objectId = member.edge.objectId;
      memberState.sourceMeshUuid = member.edge.mesh.uuid;
      memberState.offset = nextOffset;
      memberState.normalTarget = isSameLooseEdgeLoop(member.edge, edge)
        ? nextTarget.clone()
        : getMirroredLoopNormalTarget(edge, member.edge, axisData.axis, nextOffset);
      memberState.normalAxisTarget = isSameLooseEdgeLoop(member.edge, edge)
        ? nextAxisTarget.clone()
        : memberState.normalTarget
          ? memberState.normalTarget.clone()
          : null;
      rebuildLooseEdgeLoopCapFill(member.edge, member.key, memberState);
    });
    refreshCapOffsetGizmo(edge);
    schedulePersistViewerState();
  };

  const syncLooseEdgeLoopCapStates = (modelRoot: THREE.Object3D | null = rootRef.current) => {
    if (!modelRoot) {
      return;
    }

    const currentKeys = new Set<string>();

    modelRoot.traverse((child) => {
      if (!isSelectableMesh(child)) {
        return;
      }

      const loopsById = child.userData.looseEdgeLoopById;

      if (!(loopsById instanceof Map)) {
        return;
      }

      loopsById.forEach((loop) => {
        const typedLoop = loop as LooseEdgeLoop;

        currentKeys.add(getLooseEdgeLoopCacheKey(child, typedLoop));
      });
    });

    looseEdgeLoopCapStatesRef.current.forEach((state, key) => {
      if (currentKeys.has(key)) {
        return;
      }

      removeLooseEdgeLoopCapFill(state);
      looseEdgeLoopCapStatesRef.current.delete(key);
    });

    refreshLooseEdgeLoopCapVisibility();
    refreshCapOffsetGizmo();
    refreshLooseEdgeLoopDisplayColors(modelRoot);
  };

  const getLooseEdgeLoopCapMode = (edge: HoveredEdge) => {
    return getLooseEdgeLoopCapState(edge)?.mode ?? "none";
  };

  const getLooseEdgeLoopCapCone = (edge: HoveredEdge) => {
    const state = getLooseEdgeLoopCapState(edge);

    return state && supportsConeLoopMode(state.mode) ? state.cone : false;
  };

  const setLooseEdgeLoopCapModeSingle = (
    edge: HoveredEdge,
    mode: LooseEdgeLoopMode,
    recordHistory = true,
  ) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const existingState = getLooseEdgeLoopCapState(edge);
    const existingMode = existingState?.mode;
    const rememberedNormalAxisTarget =
      existingState?.normalAxisTarget ??
      (existingState && isNormalTargetLoopMode(existingState.mode)
        ? existingState.normalTarget
        : null);
    const existingAxisTarget = isNormalTargetLoopMode(mode)
      ? rememberedNormalAxisTarget
      : existingMode === mode
        ? (existingState?.normalTarget ?? null)
        : null;
    const axisData =
      mode === "none" ? null : getLooseEdgeLoopCapAxisData(edge, mode, existingAxisTarget);

    if (mode === "none") {
      const hadExistingState = members.some((member) =>
        looseEdgeLoopCapStatesRef.current.has(member.key),
      );

      if (hadExistingState) {
        if (recordHistory) {
          pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
        }
        members.forEach((member) => {
          const memberState = looseEdgeLoopCapStatesRef.current.get(member.key);

          if (!memberState) {
            return;
          }

          removeLooseEdgeLoopCapFill(memberState);
          looseEdgeLoopCapStatesRef.current.delete(member.key);
        });
      }
      refreshCapOffsetGizmo(edge);
      refreshLooseEdgeLoopDisplayColors(edge.mesh.parent ?? rootRef.current);
      schedulePersistViewerState();
      return hadExistingState;
    }

    if (!axisData) {
      refreshCapOffsetGizmo(edge);
      return false;
    }

    const missingMemberState = members.some(
      (member) => !looseEdgeLoopCapStatesRef.current.has(member.key),
    );
    const changed = !existingState || existingMode !== mode || missingMemberState;

    if (changed && recordHistory) {
      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
    }

    const rememberedNormalOffset =
      isNormalTargetLoopMode(mode) && existingAxisTarget
        ? existingAxisTarget.distanceTo(axisData.data.center)
        : null;
    const nextOffset =
      mode === "fill"
        ? 0
        : existingMode === mode && existingState && Number.isFinite(existingState.offset)
          ? existingState.offset
          : (rememberedNormalOffset ?? axisData.defaultOffset);
    const nextCone = supportsConeLoopMode(mode) ? (existingState?.cone ?? false) : false;
    const shouldStoreAxisTarget =
      mode !== "fill" && (members.length > 1 || isNormalTargetLoopMode(mode));

    members.forEach((member) => {
      const memberState = looseEdgeLoopCapStatesRef.current.get(member.key) ?? {
        cone: nextCone,
        fill: null,
        mode,
        normalAxisTarget:
          isSameLooseEdgeLoop(member.edge, edge) && rememberedNormalAxisTarget
            ? rememberedNormalAxisTarget.clone()
            : null,
        normalTarget: null,
        objectId: member.edge.objectId,
        occlusionOverlay: null,
        offset: nextOffset,
        sourceMeshUuid: member.edge.mesh.uuid,
      };

      memberState.cone = nextCone;
      memberState.mode = mode;
      memberState.objectId = member.edge.objectId;
      memberState.sourceMeshUuid = member.edge.mesh.uuid;
      memberState.offset = nextOffset;
      memberState.normalTarget = shouldStoreAxisTarget
        ? isNormalTargetLoopMode(mode) &&
          isSameLooseEdgeLoop(member.edge, edge) &&
          rememberedNormalAxisTarget
          ? rememberedNormalAxisTarget.clone()
          : getMirroredLoopNormalTarget(edge, member.edge, axisData.axis, nextOffset)
        : null;
      if (isNormalTargetLoopMode(mode)) {
        memberState.normalAxisTarget = memberState.normalTarget
          ? memberState.normalTarget.clone()
          : null;
      }

      rebuildLooseEdgeLoopCapFill(member.edge, member.key, memberState);
    });
    refreshCapOffsetGizmo(edge);
    refreshLooseEdgeLoopDisplayColors(edge.mesh.parent ?? rootRef.current);
    schedulePersistViewerState();
    return changed;
  };

  const setLooseEdgeLoopCapConeSingle = (
    edge: HoveredEdge,
    cone: boolean,
    recordHistory = true,
  ) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const state = getLooseEdgeLoopCapState(edge);

    if (!state || !supportsConeLoopMode(state.mode)) {
      return false;
    }

    const missingMemberState = members.some(
      (member) => !looseEdgeLoopCapStatesRef.current.has(member.key),
    );

    if (!missingMemberState && state.cone === cone) {
      return false;
    }

    if (recordHistory) {
      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
    }

    members.forEach((member) => {
      const existingMemberState = looseEdgeLoopCapStatesRef.current.get(member.key);
      const memberState = existingMemberState ?? {
        cone,
        fill: null,
        mode: state.mode,
        normalAxisTarget:
          isSameLooseEdgeLoop(member.edge, edge) && state.normalAxisTarget
            ? state.normalAxisTarget.clone()
            : null,
        normalTarget:
          isSameLooseEdgeLoop(member.edge, edge) && state.normalTarget
            ? state.normalTarget.clone()
            : null,
        objectId: member.edge.objectId,
        occlusionOverlay: null,
        offset: state.offset,
        sourceMeshUuid: member.edge.mesh.uuid,
      };

      memberState.cone = cone;
      memberState.mode = state.mode;
      memberState.objectId = member.edge.objectId;
      memberState.sourceMeshUuid = member.edge.mesh.uuid;
      memberState.offset = state.offset;

      rebuildLooseEdgeLoopCapFill(member.edge, member.key, memberState);
    });
    schedulePersistViewerState();
    return true;
  };

  const setLooseEdgeLoopCapOffsetSingle = (edge: HoveredEdge, offset: number) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const state = getLooseEdgeLoopCapState(edge);

    if (!state || state.mode === "none") {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const axisTarget = getLoopCapAxisTarget(state);
    const nextOffset = clampLooseEdgeLoopCapOffset(edge, state.mode, offset, axisTarget);
    const missingMemberState = members.some(
      (member) => !looseEdgeLoopCapStatesRef.current.has(member.key),
    );

    if (!missingMemberState && Math.abs(nextOffset - state.offset) < 0.0001) {
      return;
    }

    const shouldStoreAxisTarget =
      state.mode !== "fill" &&
      (members.length > 1 || isNormalTargetLoopMode(state.mode) || Boolean(state.normalTarget));
    const selectedAxisData = shouldStoreAxisTarget
      ? getLooseEdgeLoopCapAxisData(edge, state.mode, axisTarget)
      : null;
    const selectedTarget = selectedAxisData
      ? selectedAxisData.data.center.clone().addScaledVector(selectedAxisData.axis, nextOffset)
      : null;
    const selectedAxisTarget = selectedAxisData
      ? isNormalTargetLoopMode(state.mode) && axisTarget
        ? axisTarget.clone()
        : selectedAxisData.data.center
            .clone()
            .addScaledVector(selectedAxisData.axis, Math.max(Math.abs(nextOffset), 0.001))
      : null;

    members.forEach((member) => {
      const memberState = looseEdgeLoopCapStatesRef.current.get(member.key) ?? {
        cone: state.cone,
        fill: null,
        mode: state.mode,
        normalAxisTarget: null,
        normalTarget: null,
        objectId: member.edge.objectId,
        occlusionOverlay: null,
        offset: nextOffset,
        sourceMeshUuid: member.edge.mesh.uuid,
      };

      memberState.cone = state.cone;
      memberState.mode = state.mode;
      memberState.objectId = member.edge.objectId;
      memberState.sourceMeshUuid = member.edge.mesh.uuid;
      memberState.offset = nextOffset;
      memberState.normalTarget =
        selectedAxisData && shouldStoreAxisTarget
          ? isNormalTargetLoopMode(state.mode) &&
            isSameLooseEdgeLoop(member.edge, edge) &&
            selectedTarget
            ? selectedTarget.clone()
            : isSameLooseEdgeLoop(member.edge, edge) && selectedAxisTarget
              ? selectedAxisTarget.clone()
              : getMirroredLoopNormalTarget(edge, member.edge, selectedAxisData.axis, nextOffset)
          : null;
      if (isNormalTargetLoopMode(state.mode)) {
        if (isSameLooseEdgeLoop(member.edge, edge)) {
          memberState.normalAxisTarget = selectedAxisTarget
            ? selectedAxisTarget.clone()
            : (memberState.normalAxisTarget ?? memberState.normalTarget?.clone() ?? null);
        } else if (!memberState.normalAxisTarget && memberState.normalTarget) {
          memberState.normalAxisTarget = memberState.normalTarget.clone();
        }
      }

      rebuildLooseEdgeLoopCapFill(member.edge, member.key, memberState);
    });
    refreshCapOffsetGizmo(edge);
    schedulePersistViewerState();
  };

  const removeLoopCapGroupStates = (
    groups: Array<{ keys: string[]; primaryEdge: HoveredEdge }>,
  ) => {
    groups.forEach((group) => {
      const removedStates = new Set<LooseEdgeLoopCapState>();

      group.keys.forEach((key) => {
        const state = looseEdgeLoopCapStatesRef.current.get(key);

        if (state && !removedStates.has(state)) {
          removeLooseEdgeLoopCapFill(state);
          removedStates.add(state);
        }

        looseEdgeLoopCapStatesRef.current.delete(key);
      });
    });
  };

  const rebuildLoopCapGroupState = (
    group: { edges: HoveredEdge[]; keys: string[]; primaryEdge: HoveredEdge },
    state: LooseEdgeLoopCapState,
  ) => {
    state.groupLoopKeys = group.keys;
    state.objectId = group.primaryEdge.objectId;
    state.sourceMeshUuid = group.primaryEdge.mesh.uuid;
    rebuildLooseEdgeLoopCapFill(
      group.primaryEdge,
      group.keys[0] ?? getLooseEdgeLoopFillKey(group.primaryEdge),
      state,
    );
  };

  const setGroupedLooseEdgeLoopCapMode = (edge: HoveredEdge, mode: LooseEdgeLoopMode) => {
    const groups = getLoopCapEditGroups(edge);
    const sourceGroup = groups.find((group) =>
      group.edges.some((groupEdge) => isSameLooseEdgeLoop(groupEdge, edge)),
    );

    if (!sourceGroup) {
      setLooseEdgeLoopCapModeSingle(edge, mode);
      return false;
    }

    if (mode === "none") {
      const hadExistingState = groups.some((group) =>
        group.keys.some((key) => looseEdgeLoopCapStatesRef.current.has(key)),
      );

      if (!hadExistingState) {
        return false;
      }

      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
      removeLoopCapGroupStates(groups);
      refreshCapOffsetGizmo(edge);
      refreshLooseEdgeLoopDisplayColors(edge.mesh.parent ?? rootRef.current);
      schedulePersistViewerState();
      return true;
    }

    const existingState = getLooseEdgeLoopCapState(edge);
    const existingMode = existingState?.mode;
    const rememberedNormalAxisTarget =
      existingState?.normalAxisTarget ??
      (existingState && isNormalTargetLoopMode(existingState.mode)
        ? existingState.normalTarget
        : null);
    const axisTarget = isNormalTargetLoopMode(mode)
      ? rememberedNormalAxisTarget
      : existingMode === mode
        ? (existingState?.normalTarget ?? null)
        : null;
    const sourceAxisData = getLooseEdgeLoopCapAxisDataForEdges(
      sourceGroup.primaryEdge,
      sourceGroup.edges,
      mode,
      axisTarget,
    );

    if (!sourceAxisData) {
      refreshCapOffsetGizmo(edge);
      return false;
    }

    const missingState = groups.some((group) =>
      group.keys.some((key) => !looseEdgeLoopCapStatesRef.current.has(key)),
    );
    const changed = !existingState || existingMode !== mode || missingState;

    if (changed) {
      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
    }

    const rememberedNormalOffset =
      isNormalTargetLoopMode(mode) && axisTarget
        ? axisTarget.distanceTo(sourceAxisData.data.center)
        : null;
    const nextOffset =
      mode === "fill"
        ? 0
        : existingMode === mode && existingState && Number.isFinite(existingState.offset)
          ? existingState.offset
          : (rememberedNormalOffset ?? sourceAxisData.defaultOffset);
    const nextCone = supportsConeLoopMode(mode) ? (existingState?.cone ?? false) : false;

    groups.forEach((group) => {
      const existingGroupState =
        group.keys.map((key) => looseEdgeLoopCapStatesRef.current.get(key)).find(Boolean) ?? null;
      const groupAxisTarget =
        group === sourceGroup
          ? axisTarget
          : isNormalTargetLoopMode(mode)
            ? getMirroredGroupNormalTarget(sourceGroup, group, sourceAxisData.axis, nextOffset)
            : null;
      const groupAxisData = getLooseEdgeLoopCapAxisDataForEdges(
        group.primaryEdge,
        group.edges,
        mode,
        groupAxisTarget,
      );

      if (!groupAxisData) {
        return;
      }

      const groupState = existingGroupState ?? {
        cone: nextCone,
        fill: null,
        mode,
        normalAxisTarget: null,
        normalTarget: null,
        objectId: group.primaryEdge.objectId,
        occlusionOverlay: null,
        offset: nextOffset,
        sourceMeshUuid: group.primaryEdge.mesh.uuid,
      };

      groupState.cone = nextCone;
      groupState.mode = mode;
      groupState.offset = nextOffset;
      groupState.normalTarget =
        mode !== "fill" && isNormalTargetLoopMode(mode)
          ? groupAxisData.data.center.clone().addScaledVector(groupAxisData.axis, nextOffset)
          : null;
      groupState.normalAxisTarget =
        isNormalTargetLoopMode(mode) && groupAxisTarget
          ? groupAxisTarget.clone()
          : (groupState.normalTarget?.clone() ?? null);
      rebuildLoopCapGroupState(group, groupState);
    });
    refreshCapOffsetGizmo(edge);
    refreshLooseEdgeLoopDisplayColors(edge.mesh.parent ?? rootRef.current);
    schedulePersistViewerState();
    return changed;
  };

  const setGroupedLooseEdgeLoopCapCone = (edge: HoveredEdge, cone: boolean) => {
    const groups = getLoopCapEditGroups(edge);
    const state = getLooseEdgeLoopCapState(edge);

    if (!state || !supportsConeLoopMode(state.mode)) {
      return false;
    }

    const changed =
      state.cone !== cone ||
      groups.some((group) => group.keys.some((key) => !looseEdgeLoopCapStatesRef.current.has(key)));

    if (!changed) {
      return false;
    }

    pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());

    groups.forEach((group) => {
      const groupState =
        group.keys.map((key) => looseEdgeLoopCapStatesRef.current.get(key)).find(Boolean) ?? null;

      if (!groupState) {
        return;
      }

      groupState.cone = cone;
      rebuildLoopCapGroupState(group, groupState);
    });
    schedulePersistViewerState();
    return true;
  };

  const setGroupedLooseEdgeLoopCapOffset = (edge: HoveredEdge, offset: number) => {
    const groups = getLoopCapEditGroups(edge);
    const sourceGroup = groups.find((group) =>
      group.edges.some((groupEdge) => isSameLooseEdgeLoop(groupEdge, edge)),
    );
    const sourceState = getLooseEdgeLoopCapState(edge);

    if (!sourceGroup || !sourceState || sourceState.mode === "none") {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const nextOffset = offset;
    const sourceAxisData = getLooseEdgeLoopCapStateAxisData(edge, sourceState);

    groups.forEach((group) => {
      const groupState =
        group.keys.map((key) => looseEdgeLoopCapStatesRef.current.get(key)).find(Boolean) ?? null;

      if (!groupState) {
        return;
      }

      const groupAxisTarget =
        group === sourceGroup
          ? getLoopCapAxisTarget(groupState)
          : sourceAxisData && isNormalTargetLoopMode(groupState.mode)
            ? getMirroredGroupNormalTarget(sourceGroup, group, sourceAxisData.axis, nextOffset)
            : getLoopCapAxisTarget(groupState);

      groupState.offset = nextOffset;
      if (isNormalTargetLoopMode(groupState.mode)) {
        const groupAxisData = getLooseEdgeLoopCapAxisDataForEdges(
          group.primaryEdge,
          group.edges,
          groupState.mode,
          groupAxisTarget,
        );

        if (groupAxisData) {
          groupState.normalTarget = groupAxisData.data.center
            .clone()
            .addScaledVector(groupAxisData.axis, nextOffset);
          groupState.normalAxisTarget = groupAxisTarget
            ? groupAxisTarget.clone()
            : (groupState.normalAxisTarget ?? groupState.normalTarget.clone());
        }
      }

      rebuildLoopCapGroupState(group, groupState);
    });
    refreshSelectedLooseEdgeLoopState(edge);
    schedulePersistViewerState();
  };

  const setGroupedLooseEdgeLoopCapTarget = (edge: HoveredEdge, target: THREE.Vector3) => {
    const groups = getLoopCapEditGroups(edge);
    const sourceGroup = groups.find((group) =>
      group.edges.some((groupEdge) => isSameLooseEdgeLoop(groupEdge, edge)),
    );
    const sourceState = getLooseEdgeLoopCapState(edge);
    const sourceAxisData =
      sourceState && sourceGroup
        ? getLooseEdgeLoopCapAxisDataForEdges(
            sourceGroup.primaryEdge,
            sourceGroup.edges,
            sourceState.mode,
            target,
          )
        : null;

    if (
      !sourceGroup ||
      !sourceState ||
      !sourceAxisData ||
      !isNormalTargetLoopMode(sourceState.mode)
    ) {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const nextOffset = target.distanceTo(sourceAxisData.data.center);

    groups.forEach((group) => {
      const groupState =
        group.keys.map((key) => looseEdgeLoopCapStatesRef.current.get(key)).find(Boolean) ?? null;

      if (!groupState) {
        return;
      }

      const groupTarget =
        group === sourceGroup
          ? target
          : getMirroredGroupNormalTarget(sourceGroup, group, sourceAxisData.axis, nextOffset);
      const groupAxisData = getLooseEdgeLoopCapAxisDataForEdges(
        group.primaryEdge,
        group.edges,
        groupState.mode,
        groupTarget,
      );

      if (!groupAxisData || !groupTarget) {
        return;
      }

      groupState.offset = nextOffset;
      groupState.normalTarget = groupAxisData.data.center
        .clone()
        .addScaledVector(groupAxisData.axis, nextOffset);
      groupState.normalAxisTarget = groupTarget.clone();
      rebuildLoopCapGroupState(group, groupState);
    });
    refreshSelectedLooseEdgeLoopState(edge);
    schedulePersistViewerState();
  };

  const editSelectedLooseEdgeLoops = (
    edge: HoveredEdge,
    editLoop: (selectedEdge: HoveredEdge, recordHistory: boolean) => boolean | void,
  ) => {
    const edges = getEditableLooseEdgeLoops(edge);

    if (edges.length <= 1) {
      return editLoop(edge, true) === true;
    }

    const historySnapshot = createCurrentViewerHistorySnapshot();
    let changed = false;

    edges.forEach((selectedEdge) => {
      changed = editLoop(selectedEdge, false) === true || changed;
    });

    if (changed) {
      pushViewerHistorySnapshot(historySnapshot);
    }

    return changed;
  };

  const setLooseEdgeLoopCapMode = (edge: HoveredEdge, mode: LooseEdgeLoopMode) => {
    if (getEditableLooseEdgeLoops(edge).length > 1) {
      const changed = setGroupedLooseEdgeLoopCapMode(edge, mode);

      if (changed) {
        refreshSelectedLooseEdgeLoopState(edge);
      }
      return;
    }

    const changed = editSelectedLooseEdgeLoops(edge, (selectedEdge, recordHistory) =>
      setLooseEdgeLoopCapModeSingle(selectedEdge, mode, recordHistory),
    );

    if (changed) {
      refreshSelectedLooseEdgeLoopState(edge);
    }
  };

  const setLooseEdgeLoopCapCone = (edge: HoveredEdge, cone: boolean) => {
    if (getEditableLooseEdgeLoops(edge).length > 1) {
      const changed = setGroupedLooseEdgeLoopCapCone(edge, cone);

      if (changed) {
        refreshSelectedLooseEdgeLoopState(edge);
      }
      return;
    }

    const changed = editSelectedLooseEdgeLoops(edge, (selectedEdge, recordHistory) =>
      setLooseEdgeLoopCapConeSingle(selectedEdge, cone, recordHistory),
    );

    if (changed) {
      refreshSelectedLooseEdgeLoopState(edge);
    }
  };

  const setLooseEdgeLoopCapOffset = (edge: HoveredEdge, offset: number) => {
    if (getEditableLooseEdgeLoops(edge).length > 1) {
      setGroupedLooseEdgeLoopCapOffset(edge, offset);
      return;
    }

    const sourceState = getLooseEdgeLoopCapState(edge);
    const offsetDelta = sourceState ? offset - sourceState.offset : 0;

    getEditableLooseEdgeLoops(edge).forEach((selectedEdge) => {
      if (isSameLooseEdgeLoop(selectedEdge, edge)) {
        setLooseEdgeLoopCapOffsetSingle(selectedEdge, offset);
        return;
      }

      const selectedState = getLooseEdgeLoopCapState(selectedEdge);
      const selectedOffset = selectedState ? selectedState.offset + offsetDelta : offset;

      setLooseEdgeLoopCapOffsetSingle(selectedEdge, selectedOffset);
    });
    refreshSelectedLooseEdgeLoopState(edge);
  };

  const setLooseEdgeLoopCapTarget = (edge: HoveredEdge, target: THREE.Vector3) => {
    if (getEditableLooseEdgeLoops(edge).length > 1) {
      setGroupedLooseEdgeLoopCapTarget(edge, target);
      return;
    }

    const sourceState = getLooseEdgeLoopCapState(edge);
    const sourceTarget = sourceState?.normalTarget ?? null;
    const targetDelta = sourceTarget ? target.clone().sub(sourceTarget) : new THREE.Vector3();

    getEditableLooseEdgeLoops(edge).forEach((selectedEdge) => {
      if (isSameLooseEdgeLoop(selectedEdge, edge)) {
        setLooseEdgeLoopCapTargetSingle(selectedEdge, target);
        return;
      }

      const selectedState = getLooseEdgeLoopCapState(selectedEdge);

      if (!selectedState?.normalTarget) {
        setLooseEdgeLoopCapTargetSingle(selectedEdge, target);
        return;
      }

      setLooseEdgeLoopCapTargetSingle(
        selectedEdge,
        selectedState.normalTarget.clone().add(targetDelta),
      );
    });
    refreshSelectedLooseEdgeLoopState(edge);
  };

  const handleRemoveSelectedLooseEdgeLoop = () => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const edge = selectedLooseEdgeLoopRef.current;
    const modelRoot = rootRef.current;

    if (!edge || !modelRoot) {
      return;
    }

    const selectedEdges = getEditableLooseEdgeLoops(edge);
    const cutEdgeIdsByMesh = getCutEdgeIdsByMeshForLoops(selectedEdges);

    if (!Array.from(cutEdgeIdsByMesh.values()).some((edgeIds) => edgeIds.size > 0)) {
      setSelectedLooseEdgeLoopRemovable(false);
      return;
    }

    const historySnapshot = createCurrentViewerHistorySnapshot();
    const joinObjectIds = getLoopJoinObjectIds(selectedEdges);
    const affectedMeshes = getMeshesForObjectIds(modelRoot, joinObjectIds);
    const joinPlan =
      joinObjectIds.size > 1
        ? createSelectedObjectJoinPlan(modelRoot, joinObjectIds, edge.objectId)
        : null;
    let changed = false;

    cutEdgeIdsByMesh.forEach((edgeIds, mesh) => {
      affectedMeshes.add(mesh);
      changed = Boolean(setEdgesCut(mesh, edgeIds, false)) || changed;
    });

    if (joinPlan) {
      changed = applySelectedObjectJoinPlan(modelRoot, joinPlan) || changed;
      joinPlan.objectIdToTargetId.forEach((_targetObjectId, sourceObjectId) => {
        hiddenObjectIdsRef.current.delete(sourceObjectId);
        delete objectNamesRef.current[sourceObjectId];
      });
    }

    if (!changed) {
      setSelectedLooseEdgeLoopRemovable(false);
      return;
    }

    pushViewerHistorySnapshot(historySnapshot);
    removeLoopCapGroupStates(getLoopCapEditGroups(edge));
    clearSelectedLooseEdgeLoop();
    applyObjectColors(modelRoot, hiddenObjectIdsRef.current);
    refreshObjectMaterialGroups(modelRoot, hiddenObjectIdsRef.current);
    refreshViewportObjectOutlines(modelRoot, hiddenObjectIdsRef.current);
    affectedMeshes.forEach((mesh) => {
      refreshLooseEdgeOverlay(mesh, hiddenObjectIdsRef.current, selectedObjectIdRef.current, true);
    });
    syncLooseEdgeLoopCapStates(modelRoot);
    refreshLooseEdgeLoopDisplayColors(modelRoot);
    refreshSeparatedObjectList(modelRoot);
    schedulePersistViewerState();
  };

  const clearSelectedLooseEdgeLoop = () => {
    const currentLoop = selectedLooseEdgeLoopRef.current;

    selectedLooseEdgeLoopOverlayRef.current.forEach((overlay) => {
      overlay.parent?.remove(overlay);
      disposeObject(overlay);
    });
    selectedLooseEdgeLoopOverlayRef.current.clear();

    removeCapOffsetGizmo();
    selectedLooseEdgeLoopsRef.current = [];
    selectedLooseEdgeLoopRef.current = null;
    setSelectedLooseEdgeLoopActive(false);
    setSelectedLooseEdgeLoopRemovable(false);
    setLooseEdgeLoopMode("none");
    setLooseEdgeLoopCone(false);
    refreshLooseEdgeLoopCapVisibility();
    refreshViewportObjectOutlines(currentLoop?.mesh.parent ?? rootRef.current);
    refreshLooseEdgeLoopDisplayColors(currentLoop?.mesh.parent ?? rootRef.current);
  };

  const selectLooseEdgeLoop = (edge: HoveredEdge, additive = false) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const currentSelection = selectedLooseEdgeLoopsRef.current;
    const existingIndex = currentSelection.findIndex((selectedLoop) =>
      isSameLooseEdgeLoop(selectedLoop, edge),
    );
    const hasSelectionInDifferentMesh = currentSelection.some(
      (selectedLoop) => selectedLoop.mesh !== edge.mesh,
    );

    if (!additive || hasSelectionInDifferentMesh) {
      clearSelectedLooseEdgeLoop();
      clearLinkedFaceSelectionHandlerRef.current?.(true, true);
      selectedLooseEdgeLoopsRef.current = [edge];
      clearHoverEdgeOverlay(edge);
      addSelectedLooseEdgeLoopOverlay(edge);
      refreshSelectedLooseEdgeLoopState(edge);
      return;
    }

    clearLinkedFaceSelectionHandlerRef.current?.(true, true);
    clearHoverEdgeOverlay(edge);

    if (existingIndex >= 0) {
      removeSelectedLooseEdgeLoopOverlay(edge);
      selectedLooseEdgeLoopsRef.current = currentSelection.filter(
        (selectedLoop) => !isSameLooseEdgeLoop(selectedLoop, edge),
      );

      if (selectedLooseEdgeLoopsRef.current.length === 0) {
        clearSelectedLooseEdgeLoop();
        return;
      }

      refreshSelectedLooseEdgeLoopState();
      return;
    }

    selectedLooseEdgeLoopsRef.current = [...currentSelection, edge];
    addSelectedLooseEdgeLoopOverlay(edge);
    refreshSelectedLooseEdgeLoopState(edge);
  };

  const handleLooseEdgeLoopModeChange = (mode: LooseEdgeLoopMode) => {
    if (!isEdgeLoopCapToolEnabled) {
      return;
    }

    const edge = selectedLooseEdgeLoopRef.current;

    setLooseEdgeLoopMode(mode);
    setLooseEdgeLoopCone(
      edge && supportsConeLoopMode(mode) ? getLooseEdgeLoopCapCone(edge) : false,
    );

    if (edge) {
      setLooseEdgeLoopCapMode(edge, mode);
    }
  };

  const handleLooseEdgeLoopConeChange = (cone: boolean) => {
    if (!isEdgeLoopCapToolEnabled) {
      return;
    }

    const edge = selectedLooseEdgeLoopRef.current;

    setLooseEdgeLoopCone(cone);

    if (edge) {
      setLooseEdgeLoopCapCone(edge, cone);
    }
  };

  return {
    clearLooseEdgeLoopCapStates,
    clearSelectedLooseEdgeLoop,
    getLooseEdgeLoopCapState,
    handleLooseEdgeLoopConeChange,
    handleLooseEdgeLoopModeChange,
    handleRemoveSelectedLooseEdgeLoop,
    refreshCapOffsetGizmo,
    refreshLooseEdgeLoopCapVisibility,
    removeCapOffsetGizmo,
    restoreLooseEdgeLoopCapStates,
    selectLooseEdgeLoop,
    setLooseEdgeLoopCapOffset,
    setLooseEdgeLoopCapTarget,
    syncLooseEdgeLoopCapStates,
  };
}
