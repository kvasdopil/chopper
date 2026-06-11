import * as THREE from "three";

import {
  capOffsetGizmoColor,
  capOffsetGizmoHeadScale,
  capOffsetGizmoMinLength,
  looseEdgeHoverRenderOrder,
  selectedLooseEdgeLoopColor,
  clampLooseEdgeLoopCapOffset,
  clearHoverEdgeOverlay,
  collectSelectableMeshes,
  createLooseEdgeFromLoop,
  createLooseEdgeLoopFill,
  createLooseEdgeLoopFillOcclusionOverlay,
  createLooseEdgeLoopOverlay,
  disposeLooseEdgeLoopFillOcclusionOverlay,
  disposeObject,
  getLinkedLooseEdgeLoopMembers,
  getLooseEdgeLoopCacheKey,
  getLooseEdgeLoopCapAxisData,
  getLooseEdgeLoopFillData,
  getLooseEdgeLoopFillKey,
  getLooseEdgeLoopFromPersistedState,
  isCylinderLoopMode,
  isDisposableDrawObject,
  isNormalTargetLoopMode,
  isSameLooseEdgeLoop,
  isSelectableMesh,
  setLooseEdgeLoopColor,
  setLooseEdgeLoopFillBaseMaterial,
  type HoveredEdge,
  type LooseEdgeLoop,
  type LooseEdgeLoopCapState,
} from "./model-viewer-core";
import type { PersistedLoopCapState } from "./persistence";
import type { LooseEdgeLoopMode } from "../viewer-controls/types";
import type { ModelViewerLoopCapsParams } from "./model-viewer-loop-caps-types";

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
    selectedLooseEdgeLoopOverlayRef,
    hiddenObjectIdsRef,
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

  const getLoopWorldAxis = (edge: HoveredEdge, localAxis: THREE.Vector3) => {
    edge.mesh.updateMatrixWorld(true);

    return localAxis.clone().transformDirection(edge.mesh.matrixWorld).normalize();
  };

  const getMirroredLoopNormalTarget = (
    sourceEdge: HoveredEdge,
    memberEdge: HoveredEdge,
    sourceAxisWorld: THREE.Vector3,
    offset: number,
  ) => {
    const sourceData = getLooseEdgeLoopFillData(sourceEdge);
    const memberData = getLooseEdgeLoopFillData(memberEdge);

    if (!sourceData || !memberData || sourceAxisWorld.lengthSq() === 0) {
      return null;
    }

    sourceEdge.mesh.updateMatrixWorld(true);
    memberEdge.mesh.updateMatrixWorld(true);

    const targetDistance = Math.max(Math.abs(offset), 0.001);
    const memberCenterWorld = memberEdge.mesh.localToWorld(memberData.center.clone());
    const targetWorld = memberCenterWorld.addScaledVector(sourceAxisWorld, targetDistance);

    return memberEdge.mesh.worldToLocal(targetWorld);
  };

  const refreshCapOffsetGizmo = (edge = selectedLooseEdgeLoopRef.current) => {
    const modelRoot = rootRef.current;

    if (!edge || !modelRoot || !isSameLooseEdgeLoop(edge, selectedLooseEdgeLoopRef.current)) {
      removeCapOffsetGizmo();
      return;
    }

    const key = getLooseEdgeLoopFillKey(edge);
    const state = getLooseEdgeLoopCapState(edge);
    const axisData = state
      ? getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget)
      : null;
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
      const gizmo = capOffsetGizmoRef.current;

      if (gizmo) {
        gizmo.parent?.remove(gizmo);
        disposeObject(gizmo);
        capOffsetGizmoRef.current = null;
        capOffsetGizmoHandleRef.current = null;
      }

      const transformControls = capNormalTransformControlsRef.current;
      const transformHelper = capNormalTransformHelperRef.current;
      const transformTarget = capNormalTargetRef.current;

      if (!transformControls || !transformHelper || !transformTarget) {
        return;
      }

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

      return;
    }

    capNormalTransformControlsRef.current?.detach();

    if (capNormalTransformHelperRef.current) {
      capNormalTransformHelperRef.current.visible = false;
    }

    if (capNormalTargetRef.current) {
      capNormalTargetRef.current.visible = false;
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
    const axisData = getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget);

    if (!axisData) {
      return;
    }

    if (state.fill) {
      removeLooseEdgeLoopCapFill(state);
    }

    state.offset = clampLooseEdgeLoopCapOffset(edge, state.mode, state.offset, state.normalTarget);

    if (state.mode !== "fill" && (state.normalTarget || isNormalTargetLoopMode(state.mode))) {
      state.normalTarget = axisData.data.center
        .clone()
        .addScaledVector(axisData.axis, Math.max(Math.abs(state.offset), 0.001));
    }

    const fill = createLooseEdgeLoopFill(
      edge,
      state.mode,
      state.offset,
      state.normalTarget,
      state.cone,
    );
    const parent = edge.mesh.parent ?? rootRef.current;

    if (!fill || !parent) {
      if (fill) {
        disposeObject(fill);
      }
      looseEdgeLoopCapStatesRef.current.set(key, state);
      return;
    }

    parent.add(fill);
    fill.visible = !hiddenObjectIdsRef.current.has(edge.objectId);
    state.fill = fill;
    looseEdgeLoopCapStatesRef.current.set(key, state);
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
      const normalTarget =
        capState.normalTarget && capState.mode !== "fill"
          ? new THREE.Vector3(
              capState.normalTarget[0],
              capState.normalTarget[1],
              capState.normalTarget[2],
            )
          : null;
      const axisData = getLooseEdgeLoopCapAxisData(edge, capState.mode, normalTarget);

      if (!axisData) {
        hadInvalidState = true;
        return;
      }

      const state: LooseEdgeLoopCapState = {
        cone: capState.cone === true,
        fill: null,
        mode: capState.mode,
        normalTarget,
        objectId: edge.objectId,
        occlusionOverlay: null,
        offset: capState.mode === "fill" ? 0 : capState.offset,
        sourceMeshUuid: mesh.uuid,
      };

      state.offset = clampLooseEdgeLoopCapOffset(
        edge,
        state.mode,
        state.offset,
        state.normalTarget,
      );

      if (isNormalTargetLoopMode(state.mode) && !state.normalTarget) {
        state.normalTarget = axisData.data.center
          .clone()
          .addScaledVector(axisData.axis, state.offset);
      }

      rebuildLooseEdgeLoopCapFill(edge, key, state);
    });

    refreshLooseEdgeLoopCapVisibility();
    refreshLooseEdgeLoopDisplayColors(modelRoot);

    return hadInvalidState;
  };

  const setLooseEdgeLoopCapTarget = (edge: HoveredEdge, target: THREE.Vector3) => {
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
    const nextOffset = clampLooseEdgeLoopCapOffset(edge, state.mode, requestedOffset, target);
    const nextTarget = axisData.data.center.clone().addScaledVector(axisData.axis, nextOffset);
    const missingMemberState = members.some(
      (member) => !looseEdgeLoopCapStatesRef.current.has(member.key),
    );

    if (
      !missingMemberState &&
      Math.abs(nextOffset - state.offset) < 0.0001 &&
      state.normalTarget &&
      nextTarget.distanceToSquared(state.normalTarget) < 0.000001
    ) {
      return;
    }

    const sourceAxisWorld = getLoopWorldAxis(edge, axisData.axis);

    members.forEach((member) => {
      const memberState = looseEdgeLoopCapStatesRef.current.get(member.key) ?? {
        cone: state.cone,
        fill: null,
        mode: state.mode,
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
      memberState.normalTarget = getMirroredLoopNormalTarget(
        edge,
        member.edge,
        sourceAxisWorld,
        nextOffset,
      );
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

    return state && isCylinderLoopMode(state.mode) ? state.cone : false;
  };

  const setLooseEdgeLoopCapMode = (edge: HoveredEdge, mode: LooseEdgeLoopMode) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const existingState = getLooseEdgeLoopCapState(edge);
    const existingMode = existingState?.mode;
    const shouldPreserveExistingAxisTarget =
      existingMode === mode ||
      (existingMode != null &&
        isNormalTargetLoopMode(existingMode) &&
        isNormalTargetLoopMode(mode));
    const existingAxisTarget = shouldPreserveExistingAxisTarget
      ? (existingState?.normalTarget ?? null)
      : null;
    const axisData =
      mode === "none" ? null : getLooseEdgeLoopCapAxisData(edge, mode, existingAxisTarget);

    if (mode === "none") {
      const hadExistingState = members.some((member) =>
        looseEdgeLoopCapStatesRef.current.has(member.key),
      );

      if (hadExistingState) {
        pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
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
      return;
    }

    if (!axisData) {
      refreshCapOffsetGizmo(edge);
      return;
    }

    if (!existingState || existingMode !== mode) {
      pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());
    }

    const nextOffset =
      mode === "fill"
        ? 0
        : existingMode === mode && existingState && Number.isFinite(existingState.offset)
          ? existingState.offset
          : axisData.defaultOffset;
    const nextCone = isCylinderLoopMode(mode) ? (existingState?.cone ?? false) : false;
    const shouldStoreAxisTarget =
      mode !== "fill" && (members.length > 1 || isNormalTargetLoopMode(mode));
    const sourceAxisWorld = shouldStoreAxisTarget ? getLoopWorldAxis(edge, axisData.axis) : null;

    members.forEach((member) => {
      const memberState = looseEdgeLoopCapStatesRef.current.get(member.key) ?? {
        cone: nextCone,
        fill: null,
        mode,
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
      memberState.normalTarget =
        sourceAxisWorld && shouldStoreAxisTarget
          ? getMirroredLoopNormalTarget(edge, member.edge, sourceAxisWorld, nextOffset)
          : null;

      rebuildLooseEdgeLoopCapFill(member.edge, member.key, memberState);
    });
    refreshCapOffsetGizmo(edge);
    refreshLooseEdgeLoopDisplayColors(edge.mesh.parent ?? rootRef.current);
    schedulePersistViewerState();
  };

  const setLooseEdgeLoopCapCone = (edge: HoveredEdge, cone: boolean) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const state = getLooseEdgeLoopCapState(edge);

    if (!state || !isCylinderLoopMode(state.mode)) {
      return;
    }

    const missingMemberState = members.some(
      (member) => !looseEdgeLoopCapStatesRef.current.has(member.key),
    );

    if (!missingMemberState && state.cone === cone) {
      return;
    }

    pushViewerHistorySnapshot(createCurrentViewerHistorySnapshot());

    members.forEach((member) => {
      const existingMemberState = looseEdgeLoopCapStatesRef.current.get(member.key);
      const memberState = existingMemberState ?? {
        cone,
        fill: null,
        mode: state.mode,
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
  };

  const setLooseEdgeLoopCapOffset = (edge: HoveredEdge, offset: number) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const members = getLooseEdgeLoopMembers(edge);
    const state = getLooseEdgeLoopCapState(edge);

    if (!state || state.mode === "none") {
      refreshCapOffsetGizmo(edge);
      return;
    }

    const nextOffset = clampLooseEdgeLoopCapOffset(edge, state.mode, offset, state.normalTarget);
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
      ? getLooseEdgeLoopCapAxisData(edge, state.mode, state.normalTarget)
      : null;
    const sourceAxisWorld = selectedAxisData ? getLoopWorldAxis(edge, selectedAxisData.axis) : null;

    members.forEach((member) => {
      const memberState = looseEdgeLoopCapStatesRef.current.get(member.key) ?? {
        cone: state.cone,
        fill: null,
        mode: state.mode,
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
        sourceAxisWorld && shouldStoreAxisTarget
          ? getMirroredLoopNormalTarget(edge, member.edge, sourceAxisWorld, nextOffset)
          : null;

      rebuildLooseEdgeLoopCapFill(member.edge, member.key, memberState);
    });
    refreshCapOffsetGizmo(edge);
    schedulePersistViewerState();
  };

  const clearSelectedLooseEdgeLoop = () => {
    const currentLoop = selectedLooseEdgeLoopRef.current;
    const overlay = selectedLooseEdgeLoopOverlayRef.current;

    if (overlay) {
      overlay.parent?.remove(overlay);
      disposeObject(overlay);
      selectedLooseEdgeLoopOverlayRef.current = null;
    }

    removeCapOffsetGizmo();
    selectedLooseEdgeLoopRef.current = null;
    setSelectedLooseEdgeLoopActive(false);
    refreshLooseEdgeLoopCapVisibility();
    refreshViewportObjectOutlines(currentLoop?.mesh.parent ?? rootRef.current);
    refreshLooseEdgeLoopDisplayColors(currentLoop?.mesh.parent ?? rootRef.current);
  };

  const selectLooseEdgeLoop = (edge: HoveredEdge) => {
    if (!isEdgeLoopCapToolEnabledRef.current) {
      return;
    }

    const modelRoot = rootRef.current;

    clearSelectedLooseEdgeLoop();
    clearLinkedFaceSelectionHandlerRef.current?.(true, true);
    clearHoverEdgeOverlay(edge);
    selectedLooseEdgeLoopRef.current = edge;
    setLooseEdgeLoopMode(getLooseEdgeLoopCapMode(edge));
    setLooseEdgeLoopCone(getLooseEdgeLoopCapCone(edge));
    setSelectedLooseEdgeLoopActive(true);
    refreshLooseEdgeLoopCapVisibility();
    refreshViewportObjectOutlines(edge.mesh.parent ?? modelRoot);
    setLooseEdgeLoopColor(edge.mesh, edge.loopId, selectedLooseEdgeLoopColor);

    const overlay = createLooseEdgeLoopOverlay(edge, selectedLooseEdgeLoopColor);

    if (!overlay) {
      return;
    }

    (edge.mesh.parent ?? modelRoot)?.add(overlay);
    selectedLooseEdgeLoopOverlayRef.current = overlay;
    refreshCapOffsetGizmo(edge);
  };

  const handleLooseEdgeLoopModeChange = (mode: LooseEdgeLoopMode) => {
    if (!isEdgeLoopCapToolEnabled) {
      return;
    }

    const edge = selectedLooseEdgeLoopRef.current;

    setLooseEdgeLoopMode(mode);
    setLooseEdgeLoopCone(edge && isCylinderLoopMode(mode) ? getLooseEdgeLoopCapCone(edge) : false);

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
