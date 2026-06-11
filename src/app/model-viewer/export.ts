import * as THREE from "three";

import {
  defaultObjectId,
  exportMergeDistance,
  collectSelectableMeshes,
  getSeparatedObjectColor,
  getSeparatedObjectLabel,
  getTriangleObjectIds,
  type ExportObjectGeometry,
  type LooseEdgeLoopCapState,
  type ObjectNameMap,
} from "./model-viewer-shared";

export function getSafeExportName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Object";
}

export function getBlenderExportFileName(sourceName: string) {
  const baseName = sourceName.replace(/\.[^/.]+$/, "");

  return `${getSafeExportName(baseName || "model")}-blender.glb`;
}

export function createExportMaterial(name: string, color: THREE.Color) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    name,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
}

export function getExportObjectGeometry(
  exportObjects: Map<number, ExportObjectGeometry>,
  objectId: number,
) {
  let objectGeometry = exportObjects.get(objectId);

  if (!objectGeometry) {
    objectGeometry = { basePositions: [], generatedGroups: [] };
    exportObjects.set(objectId, objectGeometry);
  }

  return objectGeometry;
}

export function appendExportGeometryPositions(
  positions: number[],
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const point = new THREE.Vector3();

  if (!(position instanceof THREE.BufferAttribute)) {
    return;
  }

  if (index) {
    for (let itemIndex = 0; itemIndex < index.count; itemIndex += 1) {
      point.fromBufferAttribute(position, index.getX(itemIndex)).applyMatrix4(matrixWorld);
      positions.push(point.x, point.y, point.z);
    }

    return;
  }

  for (let itemIndex = 0; itemIndex < position.count; itemIndex += 1) {
    point.fromBufferAttribute(position, itemIndex).applyMatrix4(matrixWorld);
    positions.push(point.x, point.y, point.z);
  }
}

export function addBaseObjectGeometryToExportObjects(
  exportObjects: Map<number, ExportObjectGeometry>,
  modelRoot: THREE.Object3D,
) {
  const point = new THREE.Vector3();

  modelRoot.updateMatrixWorld(true);

  collectSelectableMeshes(modelRoot).forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const objectIds = getTriangleObjectIds(mesh);

    if (!(position instanceof THREE.BufferAttribute)) {
      return;
    }

    mesh.updateMatrixWorld(true);

    for (let index = 0; index < position.count; index += 3) {
      const triangleIndex = index / 3;
      const objectId = objectIds?.[triangleIndex] ?? defaultObjectId;
      const positions = getExportObjectGeometry(exportObjects, objectId).basePositions;

      for (let offset = 0; offset < 3; offset += 1) {
        point.fromBufferAttribute(position, index + offset).applyMatrix4(mesh.matrixWorld);
        positions.push(point.x, point.y, point.z);
      }
    }
  });
}

export function addGeneratedLoopGeometryToExportObjects(
  exportObjects: Map<number, ExportObjectGeometry>,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
  objectNames: ObjectNameMap,
) {
  const generatedGroupCountByObjectId = new Map<number, number>();

  loopCapStates.forEach((state) => {
    const fill = state.fill;

    if (!fill) {
      return;
    }

    const positions: number[] = [];

    fill.updateMatrixWorld(true);
    appendExportGeometryPositions(positions, fill.geometry, fill.matrixWorld);

    if (positions.length === 0) {
      return;
    }

    const groupNumber = (generatedGroupCountByObjectId.get(state.objectId) ?? 0) + 1;

    generatedGroupCountByObjectId.set(state.objectId, groupNumber);
    getExportObjectGeometry(exportObjects, state.objectId).generatedGroups.push({
      materialName: getSafeExportName(
        `${getSeparatedObjectLabel(state.objectId, objectNames)} ${state.mode} ${groupNumber}`,
      ),
      positions,
    });
  });
}

export function getExportMergeVertexKey(x: number, y: number, z: number) {
  const scale = 1 / exportMergeDistance;

  return `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
}

export function createMergedExportMesh(
  objectId: number,
  objectGeometry: ExportObjectGeometry,
  objectNames: ObjectNameMap,
) {
  const geometry = new THREE.BufferGeometry();
  const materials: THREE.Material[] = [];
  const vertexIndexByKey = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const objectName = getSafeExportName(getSeparatedObjectLabel(objectId, objectNames));
  const objectColor = getSeparatedObjectColor(objectId);

  const getMergedVertexIndex = (x: number, y: number, z: number) => {
    const key = getExportMergeVertexKey(x, y, z);
    const existingIndex = vertexIndexByKey.get(key);

    if (existingIndex !== undefined) {
      return existingIndex;
    }

    const vertexIndex = positions.length / 3;

    vertexIndexByKey.set(key, vertexIndex);
    positions.push(x, y, z);

    return vertexIndex;
  };

  const addGroup = (groupPositions: number[], materialName: string) => {
    if (groupPositions.length < 9) {
      return;
    }

    const start = indices.length;

    for (let index = 0; index + 8 < groupPositions.length; index += 9) {
      const firstIndex = getMergedVertexIndex(
        groupPositions[index],
        groupPositions[index + 1],
        groupPositions[index + 2],
      );
      const secondIndex = getMergedVertexIndex(
        groupPositions[index + 3],
        groupPositions[index + 4],
        groupPositions[index + 5],
      );
      const thirdIndex = getMergedVertexIndex(
        groupPositions[index + 6],
        groupPositions[index + 7],
        groupPositions[index + 8],
      );

      if (firstIndex === secondIndex || secondIndex === thirdIndex || thirdIndex === firstIndex) {
        continue;
      }

      indices.push(firstIndex, secondIndex, thirdIndex);
    }

    const count = indices.length - start;

    if (count === 0) {
      return;
    }

    geometry.addGroup(start, count, materials.length);
    materials.push(createExportMaterial(materialName, objectColor));
  };

  addGroup(objectGeometry.basePositions, `${objectName} faces`);
  objectGeometry.generatedGroups.forEach((group) => {
    addGroup(group.positions, group.materialName);
  });

  if (indices.length === 0 || positions.length === 0) {
    return null;
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);

  mesh.name = objectName;

  return mesh;
}

export function addMergedObjectMeshesToExportScene(
  scene: THREE.Scene,
  modelRoot: THREE.Object3D,
  objectNames: ObjectNameMap,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  const exportObjects = new Map<number, ExportObjectGeometry>();

  addBaseObjectGeometryToExportObjects(exportObjects, modelRoot);
  addGeneratedLoopGeometryToExportObjects(exportObjects, loopCapStates, objectNames);

  Array.from(exportObjects.entries())
    .sort(([firstObjectId], [secondObjectId]) => firstObjectId - secondObjectId)
    .forEach(([objectId, objectGeometry]) => {
      const mesh = createMergedExportMesh(objectId, objectGeometry, objectNames);

      if (mesh) {
        scene.add(mesh);
      }
    });
}

export function createBlenderExportScene(
  modelRoot: THREE.Object3D,
  objectNames: ObjectNameMap,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
) {
  const scene = new THREE.Scene();

  scene.name = "Blender GLB export";
  addMergedObjectMeshesToExportScene(scene, modelRoot, objectNames, loopCapStates);

  return scene;
}

export function downloadArrayBuffer(data: ArrayBuffer, fileName: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
