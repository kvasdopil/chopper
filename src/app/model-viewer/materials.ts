import * as THREE from "three";

import {
  defaultObjectId,
  maxSelectedObjectOutlineIds,
  nonFocusedObjectBoundaryOpacity,
  nonFocusedObjectOutlineColor,
  nonFocusedObjectOutlinePixels,
  selectedObjectOutlineColor,
  selectedObjectOutlinePixels,
  disposeMaterial,
  getMeshSourceTextureMap,
  getTriangleObjectIds,
  getVertexPositionKey,
  isSelectableMesh,
  refreshTriangleObjectIdAttribute,
} from "./model-viewer-shared";

export function refreshObjectBoundaryAttributes(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);

  if (!(position instanceof THREE.BufferAttribute) || !objectIds) {
    return;
  }

  const triangleVertexCount = objectIds.length * 3;
  const valueCount = position.count * 3;
  const existingBarycentric = mesh.geometry.getAttribute("objectBoundaryBarycentric");
  const existingEdges = mesh.geometry.getAttribute("objectBoundaryEdges");
  const canReuseBarycentric =
    existingBarycentric instanceof THREE.BufferAttribute &&
    existingBarycentric.array instanceof Float32Array &&
    existingBarycentric.array.length === valueCount;
  const canReuseEdges =
    existingEdges instanceof THREE.BufferAttribute &&
    existingEdges.array instanceof Float32Array &&
    existingEdges.array.length === valueCount;
  const barycentricValues =
    canReuseBarycentric && existingBarycentric instanceof THREE.BufferAttribute
      ? existingBarycentric.array
      : new Float32Array(valueCount);
  const edgeValues =
    canReuseEdges && existingEdges instanceof THREE.BufferAttribute
      ? existingEdges.array
      : new Float32Array(valueCount);
  const edgeRecords = new Map<
    string,
    Array<{
      edgeSlot: number;
      objectId: number;
      triangleIndex: number;
    }>
  >();

  edgeValues.fill(0);

  for (let index = 0; index < triangleVertexCount; index += 3) {
    const triangleIndex = index / 3;
    const objectId = objectIds[triangleIndex] ?? defaultObjectId;
    const vertexKeys = [
      getVertexPositionKey(position, index),
      getVertexPositionKey(position, index + 1),
      getVertexPositionKey(position, index + 2),
    ];
    const barycentricStart = index * 3;

    barycentricValues.set([1, 0, 0, 0, 1, 0, 0, 0, 1], barycentricStart);

    [
      { edgeSlot: 2, first: 0, second: 1 },
      { edgeSlot: 0, first: 1, second: 2 },
      { edgeSlot: 1, first: 2, second: 0 },
    ].forEach(({ edgeSlot, first, second }) => {
      const edgeKey = [vertexKeys[first], vertexKeys[second]].sort().join("|");
      const records = edgeRecords.get(edgeKey);
      const record = { edgeSlot, objectId, triangleIndex };

      if (records) {
        records.push(record);
      } else {
        edgeRecords.set(edgeKey, [record]);
      }
    });
  }

  edgeRecords.forEach((records) => {
    const edgeObjectIds = new Set(records.map((record) => record.objectId));

    if (records.length > 1 && edgeObjectIds.size === 1) {
      return;
    }

    records.forEach((record) => {
      const edgeStart = record.triangleIndex * 9;

      for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
        edgeValues[edgeStart + vertexOffset * 3 + record.edgeSlot] = 1;
      }
    });
  });

  if (canReuseBarycentric && existingBarycentric instanceof THREE.BufferAttribute) {
    existingBarycentric.needsUpdate = true;
  } else {
    mesh.geometry.setAttribute(
      "objectBoundaryBarycentric",
      new THREE.BufferAttribute(barycentricValues, 3),
    );
  }

  if (canReuseEdges && existingEdges instanceof THREE.BufferAttribute) {
    existingEdges.needsUpdate = true;
  } else {
    mesh.geometry.setAttribute("objectBoundaryEdges", new THREE.BufferAttribute(edgeValues, 3));
  }
}

export function createFaceMaterial(
  visible = true,
  textureMap: THREE.Texture | null = null,
  objectId = defaultObjectId,
) {
  const objectBoundaryOutlineUniforms = {
    objectBoundaryOutlineColor: { value: new THREE.Color(nonFocusedObjectOutlineColor) },
    objectBoundaryOutlineEnabled: { value: 1 },
    objectBoundaryOutlineOpacity: { value: nonFocusedObjectBoundaryOpacity },
    objectBoundaryOutlinePixels: { value: nonFocusedObjectOutlinePixels },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textureMap,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    roughness: 0.82,
    side: THREE.FrontSide,
    vertexColors: textureMap === null,
  });

  material.visible = visible;
  material.userData.objectId = objectId;
  material.userData.objectBoundaryOutlineUniforms = objectBoundaryOutlineUniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, objectBoundaryOutlineUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 objectBoundaryBarycentric;
attribute vec3 objectBoundaryEdges;
varying vec3 vObjectBoundaryBarycentric;
varying vec3 vObjectBoundaryEdges;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vObjectBoundaryBarycentric = objectBoundaryBarycentric;
vObjectBoundaryEdges = objectBoundaryEdges;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 objectBoundaryOutlineColor;
uniform float objectBoundaryOutlineEnabled;
uniform float objectBoundaryOutlineOpacity;
uniform float objectBoundaryOutlinePixels;
varying vec3 vObjectBoundaryBarycentric;
varying vec3 vObjectBoundaryEdges;

float getObjectBoundaryEdgeAlpha(float barycentricValue, float edgeEnabled) {
  if (edgeEnabled < 0.5) {
    return 0.0;
  }

  float derivative = max(fwidth(barycentricValue), 0.000001);
  float inner = derivative * max(objectBoundaryOutlinePixels - 0.75, 0.0);
  float outer = derivative * (objectBoundaryOutlinePixels + 0.75);

  return 1.0 - smoothstep(inner, outer, barycentricValue);
}

float getObjectBoundaryOutlineAlpha() {
  if (objectBoundaryOutlineEnabled < 0.5) {
    return 0.0;
  }

  float edgeAlpha = max(
    max(
      getObjectBoundaryEdgeAlpha(vObjectBoundaryBarycentric.x, vObjectBoundaryEdges.x),
      getObjectBoundaryEdgeAlpha(vObjectBoundaryBarycentric.y, vObjectBoundaryEdges.y)
    ),
    getObjectBoundaryEdgeAlpha(vObjectBoundaryBarycentric.z, vObjectBoundaryEdges.z)
  );

  return edgeAlpha * objectBoundaryOutlineOpacity;
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float objectBoundaryOutlineAlpha = getObjectBoundaryOutlineAlpha();
outgoingLight = mix(outgoingLight, objectBoundaryOutlineColor, objectBoundaryOutlineAlpha);
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "object-boundary-outline-v1";

  return material;
}

export function createSelectedObjectStencilMaterial(stencilRef = 1) {
  const material = new THREE.ShaderMaterial({
    defines: {
      MAX_SELECTED_OBJECT_IDS: maxSelectedObjectOutlineIds,
    },
    uniforms: {
      selectedObjectIdCount: { value: 0 },
      selectedObjectIds: { value: new Array(maxSelectedObjectOutlineIds).fill(-1) },
    },
    vertexShader: `
      attribute float objectId;
      varying float vObjectId;

      void main() {
        vObjectId = objectId;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform int selectedObjectIdCount;
      uniform float selectedObjectIds[MAX_SELECTED_OBJECT_IDS];
      varying float vObjectId;

      bool isSelectedObjectId(float objectId) {
        for (int index = 0; index < MAX_SELECTED_OBJECT_IDS; index += 1) {
          if (index >= selectedObjectIdCount) {
            break;
          }

          if (abs(objectId - selectedObjectIds[index]) <= 0.5) {
            return true;
          }
        }

        return false;
      }

      void main() {
        if (!isSelectedObjectId(vObjectId)) {
          discard;
        }

        gl_FragColor = vec4(1.0);
      }
    `,
    colorWrite: false,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  material.stencilWrite = true;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilRef = stencilRef;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.ReplaceStencilOp;

  return material;
}

export function createSelectedObjectOutlineMaterial(
  outlineColor = selectedObjectOutlineColor,
  outlinePixels = selectedObjectOutlinePixels,
  stencilRef = 1,
) {
  const material = new THREE.ShaderMaterial({
    defines: {
      MAX_SELECTED_OBJECT_IDS: maxSelectedObjectOutlineIds,
    },
    uniforms: {
      outlineColor: { value: new THREE.Color(outlineColor) },
      outlinePixels: { value: outlinePixels },
      resolution: { value: new THREE.Vector2(1, 1) },
      selectedObjectIdCount: { value: 0 },
      selectedObjectIds: { value: new Array(maxSelectedObjectOutlineIds).fill(-1) },
    },
    vertexShader: `
      attribute float objectId;
      uniform float outlinePixels;
      uniform vec2 resolution;
      varying float vObjectId;

      void main() {
        vObjectId = objectId;

        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 clipPosition = projectionMatrix * viewPosition;
        vec3 viewNormal = normalize(normalMatrix * normal);
        vec4 clipNormal = projectionMatrix * vec4(viewNormal, 0.0);
        vec2 direction = clipNormal.xy;
        float lengthSq = dot(direction, direction);

        if (lengthSq < 0.000001) {
          direction = clipPosition.xy;
          lengthSq = dot(direction, direction);
        }

        if (lengthSq > 0.000001) {
          direction = normalize(direction);
          clipPosition.xy += direction * outlinePixels * 2.0 * clipPosition.w / resolution;
        }

        gl_Position = clipPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 outlineColor;
      uniform int selectedObjectIdCount;
      uniform float selectedObjectIds[MAX_SELECTED_OBJECT_IDS];
      varying float vObjectId;

      bool isSelectedObjectId(float objectId) {
        for (int index = 0; index < MAX_SELECTED_OBJECT_IDS; index += 1) {
          if (index >= selectedObjectIdCount) {
            break;
          }

          if (abs(objectId - selectedObjectIds[index]) <= 0.5) {
            return true;
          }
        }

        return false;
      }

      void main() {
        if (!isSelectedObjectId(vObjectId)) {
          discard;
        }

        gl_FragColor = vec4(outlineColor, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  material.depthFunc = THREE.LessDepth;
  material.stencilWrite = true;
  material.stencilWriteMask = 0x00;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilRef = stencilRef;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.KeepStencilOp;

  return material;
}

export function refreshMeshObjectMaterialGroups(mesh: THREE.Mesh, hiddenObjectIds: Set<number>) {
  const position = mesh.geometry.getAttribute("position");
  const objectIds = getTriangleObjectIds(mesh);
  const sourceMaterialIndexes = mesh.geometry.userData.sourceMaterialIndexes as
    | Uint32Array
    | undefined;
  const textureVisible = mesh.userData.textureVisible === true;

  if (!(position instanceof THREE.BufferAttribute) || !objectIds || objectIds.length === 0) {
    return;
  }

  refreshTriangleObjectIdAttribute(mesh);
  refreshObjectBoundaryAttributes(mesh);

  const materialIndexByKey = new Map<string, number>();
  const materials: THREE.Material[] = [];
  const getMaterialIndex = (objectId: number, sourceMaterialIndex: number) => {
    const textureMaterialIndex = textureVisible ? sourceMaterialIndex : -1;
    const key = `${objectId}:${textureMaterialIndex}`;
    const existingMaterialIndex = materialIndexByKey.get(key);

    if (existingMaterialIndex != null) {
      return existingMaterialIndex;
    }

    const materialIndex = materials.length;
    const textureMap = textureVisible ? getMeshSourceTextureMap(mesh, sourceMaterialIndex) : null;

    materialIndexByKey.set(key, materialIndex);
    materials.push(createFaceMaterial(!hiddenObjectIds.has(objectId), textureMap, objectId));

    return materialIndex;
  };

  disposeMaterial(mesh.material);
  mesh.material = materials;
  mesh.geometry.clearGroups();

  let currentObjectId = objectIds[0] ?? defaultObjectId;
  let currentMaterialIndex = getMaterialIndex(currentObjectId, sourceMaterialIndexes?.[0] ?? 0);
  let runStartTriangleIndex = 0;

  for (let triangleIndex = 1; triangleIndex <= objectIds.length; triangleIndex += 1) {
    const objectId =
      triangleIndex < objectIds.length ? (objectIds[triangleIndex] ?? defaultObjectId) : null;
    const materialIndex =
      objectId == null
        ? -1
        : getMaterialIndex(objectId, sourceMaterialIndexes?.[triangleIndex] ?? 0);

    if (objectId === currentObjectId && materialIndex === currentMaterialIndex) {
      continue;
    }

    mesh.geometry.addGroup(
      runStartTriangleIndex * 3,
      (triangleIndex - runStartTriangleIndex) * 3,
      currentMaterialIndex,
    );
    currentObjectId = objectId ?? defaultObjectId;
    currentMaterialIndex = materialIndex;
    runStartTriangleIndex = triangleIndex;
  }
}

export function refreshObjectMaterialGroups(model: THREE.Object3D, hiddenObjectIds: Set<number>) {
  model.traverse((child) => {
    if (isSelectableMesh(child)) {
      refreshMeshObjectMaterialGroups(child, hiddenObjectIds);
    }
  });
}
