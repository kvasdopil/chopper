"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  applyObjectColors,
  collectSeparatedObjects,
  defaultViewDirection,
  disposeObject,
  normalizeModel,
  styleModel,
} from "../model-viewer/model-viewer-core";
import {
  applyEditorGlbMeshStates,
  getEditorGlbMetadata,
  removeEditorGeneratedLoopMeshes,
} from "../model-viewer/editor-metadata";
import { getRestoredObjectNames } from "../model-viewer/model-persistence";
import type { PersistedFileStats, PersistedModelSource } from "../model-viewer/persistence";

const previewImageSize = 640;
const previewPadding = 1.2;

function cloneSourceData(source: PersistedModelSource) {
  return source.data.slice(0);
}

function framePreviewCamera(camera: THREE.OrthographicCamera, model: THREE.Object3D) {
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.1);
  const span = radius * 2 * previewPadding;

  camera.left = -span / 2;
  camera.right = span / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.near = 0.001;
  camera.far = radius * 20;
  camera.position.copy(sphere.center).add(defaultViewDirection.clone().multiplyScalar(radius * 4));
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function getPreviewStats(
  model: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  objectNames: Record<number, string>,
  loopCapCount: number,
): PersistedFileStats {
  const objects = collectSeparatedObjects(model, hiddenObjectIds, objectNames);

  return {
    hiddenObjectCount: objects.filter((object) => !object.visible).length,
    loopCapCount,
    objectCount: objects.length,
    triangleCount: objects.reduce((total, object) => total + object.triangleCount, 0),
  };
}

export async function createGlbFilePreview(source: PersistedModelSource) {
  let scene: THREE.Scene | null = null;
  let renderer: THREE.WebGLRenderer | null = null;

  try {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(cloneSourceData(source), "");
    const model = gltf.scene;
    const editorGlbMetadata = getEditorGlbMetadata(model);
    const hiddenObjectIds = new Set(editorGlbMetadata?.hiddenObjectIds ?? []);
    const objectNames = editorGlbMetadata
      ? getRestoredObjectNames(editorGlbMetadata.objectNames)
      : {};

    removeEditorGeneratedLoopMeshes(model, Boolean(editorGlbMetadata));
    styleModel(model);

    if (editorGlbMetadata) {
      applyEditorGlbMeshStates(model, editorGlbMetadata.meshes);
    }

    applyObjectColors(model);
    normalizeModel(model);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f2f0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);

    keyLight.position.copy(defaultViewDirection).multiplyScalar(6);
    scene.add(keyLight);
    scene.add(model);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100);

    framePreviewCamera(camera, model);

    const canvas = document.createElement("canvas");

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(previewImageSize, previewImageSize, false);
    renderer.render(scene, camera);

    return {
      screenshotDataUrl: canvas.toDataURL("image/png"),
      stats: getPreviewStats(
        model,
        hiddenObjectIds,
        objectNames,
        editorGlbMetadata?.loopCapStates.length ?? 0,
      ),
    };
  } finally {
    renderer?.dispose();

    if (scene) {
      disposeObject(scene);
    }
  }
}
