import * as THREE from "three";

import type { LooseEdgeLoopMode } from "../viewer-controls/types";
import {
  collectSelectableMeshes,
  disposeObject,
  getTriangleObjectIds,
  refreshTriangleObjectIdAttribute,
} from "./model-viewer-shared";

export const editorGlbMetadataKey = "modelPlayground";
export const editorGeneratedLoopMeshKey = "modelPlaygroundGeneratedLoop";
export const editorGeneratedLoopMaterialPrefix = "modelPlaygroundGeneratedLoop__";
export const editorGlbMetadataVersion = 1;

export type EditorGlbMeshState = {
  meshIndex: number;
  objectId: number;
};

export type EditorGlbLoopCapState = {
  cone?: boolean;
  meshIndex: number;
  mode: LooseEdgeLoopMode;
  normalAxisTarget?: [number, number, number] | null;
  normalTarget: [number, number, number] | null;
  objectId: number;
  offset: number;
  segmentKeys: string[];
};

export type EditorMetadata = {
  hiddenObjectIds: number[];
  loopCapStates: EditorGlbLoopCapState[];
  nextObjectId: number;
  objectNames: Record<string, string>;
  version: typeof editorGlbMetadataVersion;
};

export type EditorGlbMetadata = EditorMetadata & {
  meshes: EditorGlbMeshState[];
};

export type EditorGeneratedLoopMeshMetadata = {
  cone: boolean;
  mode: LooseEdgeLoopMode;
  normalAxisTarget?: [number, number, number] | null;
  normalTarget: [number, number, number] | null;
  objectId: number;
  offset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => isFiniteNumber(item));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNormalTarget(value: unknown): value is [number, number, number] | null {
  return value === null || (Array.isArray(value) && value.length === 3 && isNumberArray(value));
}

function isLoopCapMode(value: unknown): value is LooseEdgeLoopMode {
  return (
    value === "none" ||
    value === "fill" ||
    value === "extrude-x" ||
    value === "extrude-y" ||
    value === "extrude-z" ||
    value === "extrude-normal" ||
    value === "cylinder-x" ||
    value === "cylinder-y" ||
    value === "cylinder-z" ||
    value === "cylinder-normal"
  );
}

function getEditorGlbMeshState(value: unknown): EditorGlbMeshState | null {
  if (!isRecord(value) || !isFiniteNumber(value.meshIndex) || !isFiniteNumber(value.objectId)) {
    return null;
  }

  return {
    meshIndex: value.meshIndex,
    objectId: value.objectId,
  };
}

function getEditorGlbLoopCapState(value: unknown): EditorGlbLoopCapState | null {
  const normalAxisTarget =
    isRecord(value) && "normalAxisTarget" in value ? value.normalAxisTarget : null;

  if (
    !isRecord(value) ||
    !isFiniteNumber(value.meshIndex) ||
    !isLoopCapMode(value.mode) ||
    !isNormalTarget(normalAxisTarget) ||
    !isNormalTarget(value.normalTarget) ||
    !isFiniteNumber(value.objectId) ||
    !isFiniteNumber(value.offset) ||
    !isStringArray(value.segmentKeys)
  ) {
    return null;
  }

  return {
    cone: value.cone === true,
    meshIndex: value.meshIndex,
    mode: value.mode,
    normalAxisTarget,
    normalTarget: value.normalTarget,
    objectId: value.objectId,
    offset: value.offset,
    segmentKeys: value.segmentKeys,
  };
}

export function getEditorGlbMetadata(model: THREE.Object3D): EditorGlbMetadata | null {
  const candidates: unknown[] = [];

  model.traverse((child) => {
    candidates.push(child.userData[editorGlbMetadataKey]);
  });

  for (const candidate of candidates) {
    if (
      !isRecord(candidate) ||
      candidate.version !== editorGlbMetadataVersion ||
      !isNumberArray(candidate.hiddenObjectIds) ||
      !Array.isArray(candidate.loopCapStates) ||
      !Array.isArray(candidate.meshes) ||
      !isFiniteNumber(candidate.nextObjectId) ||
      !isRecord(candidate.objectNames)
    ) {
      continue;
    }

    const meshes = candidate.meshes
      .map((item) => getEditorGlbMeshState(item))
      .filter((item): item is EditorGlbMeshState => item !== null);
    const loopCapStates = candidate.loopCapStates
      .map((item) => getEditorGlbLoopCapState(item))
      .filter((item): item is EditorGlbLoopCapState => item !== null);

    if (
      meshes.length !== candidate.meshes.length ||
      loopCapStates.length !== candidate.loopCapStates.length
    ) {
      continue;
    }

    return {
      hiddenObjectIds: candidate.hiddenObjectIds,
      loopCapStates,
      meshes,
      nextObjectId: candidate.nextObjectId,
      objectNames: Object.fromEntries(
        Object.entries(candidate.objectNames).filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>,
      version: editorGlbMetadataVersion,
    };
  }

  return null;
}

function getMaterials(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function isEditorGeneratedLoopMaterial(material: THREE.Material) {
  return (
    material.userData[editorGeneratedLoopMeshKey] === true ||
    material.name.startsWith(editorGeneratedLoopMaterialPrefix)
  );
}

function stripGeneratedLoopGroups(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const groups = geometry.groups;
  const position = geometry.getAttribute("position");
  const baseGroup = groups[0];

  if (groups.length <= 1 || !baseGroup || !(position instanceof THREE.BufferAttribute)) {
    return false;
  }

  const index = geometry.getIndex();
  const positions: number[] = [];
  const point = new THREE.Vector3();

  if (index) {
    const end = Math.min(baseGroup.start + baseGroup.count, index.count);

    for (let itemIndex = baseGroup.start; itemIndex + 2 < end; itemIndex += 3) {
      for (let offset = 0; offset < 3; offset += 1) {
        point.fromBufferAttribute(position, index.getX(itemIndex + offset));
        positions.push(point.x, point.y, point.z);
      }
    }
  } else {
    const end = Math.min(baseGroup.start + baseGroup.count, position.count);

    for (let vertexIndex = baseGroup.start; vertexIndex + 2 < end; vertexIndex += 3) {
      for (let offset = 0; offset < 3; offset += 1) {
        point.fromBufferAttribute(position, vertexIndex + offset);
        positions.push(point.x, point.y, point.z);
      }
    }
  }

  if (positions.length < 9) {
    return false;
  }

  const materials = getMaterials(mesh.material);
  const baseMaterial = materials[baseGroup.materialIndex ?? 0] ?? materials[0] ?? mesh.material;
  const nextGeometry = new THREE.BufferGeometry();

  nextGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  nextGeometry.addGroup(0, positions.length / 3, 0);
  nextGeometry.computeVertexNormals();
  nextGeometry.computeBoundingBox();
  nextGeometry.computeBoundingSphere();
  geometry.dispose();
  mesh.geometry = nextGeometry;
  mesh.material = baseMaterial;

  return true;
}

export function removeEditorGeneratedLoopMeshes(model: THREE.Object3D, stripMergedGroups = false) {
  const generatedMeshes: THREE.Object3D[] = [];
  let strippedGroupCount = 0;

  model.traverse((child) => {
    if (child.userData[editorGeneratedLoopMeshKey]) {
      generatedMeshes.push(child);
      return;
    }

    if ((child as THREE.Mesh).isMesh !== true) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const materials = getMaterials(mesh.material);
    const hasGeneratedMaterial = materials.some(isEditorGeneratedLoopMaterial);
    const hasOnlyGeneratedMaterials =
      materials.length > 0 && materials.every(isEditorGeneratedLoopMaterial);

    if (hasOnlyGeneratedMaterials) {
      generatedMeshes.push(child);
      return;
    }

    if (stripMergedGroups && (hasGeneratedMaterial || mesh.geometry.groups.length > 1)) {
      strippedGroupCount += stripGeneratedLoopGroups(child as THREE.Mesh) ? 1 : 0;
    }
  });

  generatedMeshes.forEach((mesh) => {
    mesh.parent?.remove(mesh);
    disposeObject(mesh);
  });

  return generatedMeshes.length + strippedGroupCount;
}

export function applyEditorGlbMeshStates(model: THREE.Object3D, meshStates: EditorGlbMeshState[]) {
  const meshes = collectSelectableMeshes(model);
  let hadInvalidState = false;

  meshStates.forEach((meshState) => {
    const mesh = meshes[meshState.meshIndex];
    const position = mesh?.geometry.getAttribute("position");
    const objectId = Math.max(Math.floor(meshState.objectId), 0);

    if (!mesh || !(position instanceof THREE.BufferAttribute)) {
      hadInvalidState = true;
      return;
    }

    const objectIds = getTriangleObjectIds(mesh);

    if (!objectIds) {
      hadInvalidState = true;
      return;
    }

    objectIds.fill(objectId);
    refreshTriangleObjectIdAttribute(mesh);
  });

  return hadInvalidState;
}
