import type * as THREE from "three";

import {
  collectSeparatedObjects,
  type LooseEdgeLoopCapState,
  type ObjectNameMap,
} from "./model-viewer-core";
import type { PersistedFileStats } from "./persistence";

function getPersistedLoopCapCount(loopCapStates: Map<string, LooseEdgeLoopCapState>) {
  const countedStateKeys = new Set<string>();

  loopCapStates.forEach((state, key) => {
    if (state.mode === "none") {
      return;
    }

    countedStateKeys.add(state.groupLoopKeys?.join("||") ?? key);
  });

  return countedStateKeys.size;
}

export function getViewerFileStats(
  modelRoot: THREE.Object3D,
  hiddenObjectIds: Set<number>,
  objectNames: ObjectNameMap,
  loopCapStates: Map<string, LooseEdgeLoopCapState>,
): PersistedFileStats {
  const objects = collectSeparatedObjects(modelRoot, hiddenObjectIds, objectNames);

  return {
    hiddenObjectCount: objects.filter((object) => !object.visible).length,
    loopCapCount: getPersistedLoopCapCount(loopCapStates),
    objectCount: objects.length,
    triangleCount: objects.reduce((total, object) => total + object.triangleCount, 0),
  };
}
