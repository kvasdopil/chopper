import type { EditorGlbLoopCapState, EditorMetadata } from "./editor-metadata";

export const viewerPersistenceVersion = 1;

const databaseName = "3dmodel-playground";
const databaseVersion = 1;
const storeName = "viewer-state";
const currentStateKey = "current";

export type PersistedModelSource = {
  data: ArrayBuffer;
  lastModified: number;
  name: string;
  size: number;
  type: string;
};

export type PersistedMeshState = {
  meshIndex: number;
  positions?: Float32Array;
  triangleObjectIds?: Uint32Array;
  vertexTopologyIds?: Uint32Array;
};

export type PersistedLoopCapState = EditorGlbLoopCapState;

export type PersistedViewerState = {
  hiddenObjectIds: number[];
  loopCapStates: PersistedLoopCapState[];
  meshes: PersistedMeshState[];
  metadata?: EditorMetadata;
  nextObjectId: number;
  objectNames: Record<string, string>;
  savedAt: number;
  source: PersistedModelSource;
  version: typeof viewerPersistenceVersion;
};

function openViewerDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readPersistedViewerState() {
  const database = await openViewerDatabase();

  return new Promise<PersistedViewerState | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(currentStateKey);

    request.onerror = () => reject(request.error ?? new Error("Could not read saved viewer"));
    request.onsuccess = () => {
      const value = request.result;

      resolve(value && value.version === viewerPersistenceVersion ? value : null);
    };
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not read saved viewer"));
    };
  });
}

export async function savePersistedViewerState(state: PersistedViewerState) {
  const database = await openViewerDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.put(state, currentStateKey);

    request.onerror = () => reject(request.error ?? new Error("Could not save viewer"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not save viewer"));
    };
  });
}

export async function clearPersistedViewerState() {
  const database = await openViewerDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(currentStateKey);

    request.onerror = () => reject(request.error ?? new Error("Could not clear saved viewer"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not clear saved viewer"));
    };
  });
}
