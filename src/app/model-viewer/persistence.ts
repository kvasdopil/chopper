import type { EditorGlbLoopCapState, EditorMetadata } from "./editor-metadata";

export const viewerPersistenceVersion = 1;

const databaseName = "3dmodel-playground";
const storeName = "viewer-state";
const currentStateKey = "current";
const fileRecordsKey = "files:index";
const fileStateKeyPrefix = "file-state:";
const databaseOpenTimeoutMs = 8000;

export type PersistedModelSource = {
  data: ArrayBuffer;
  lastModified: number;
  name: string;
  size: number;
  type: string;
};

export type PersistedMeshState = {
  edgeCut?: Uint8Array;
  edgeLoopId?: Uint16Array | Uint32Array;
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

export type PersistedFileStats = {
  hiddenObjectCount: number;
  loopCapCount: number;
  objectCount: number;
  triangleCount: number;
};

export type PersistedFileRecord = {
  createdAt: number;
  name: string;
  screenshotDataUrl: string | null;
  slug: string;
  source: Omit<PersistedModelSource, "data">;
  stats: PersistedFileStats;
  updatedAt: number;
  version: typeof viewerPersistenceVersion;
};

export type PersistedFileRecordPatch = {
  name?: string;
  screenshotDataUrl?: string | null;
  stats?: PersistedFileStats;
};

export type ViewerStorageEstimate = {
  available: number | null;
  indexedDBUsage: number | null;
  persisted: boolean | null;
  quota: number | null;
  usage: number | null;
};

export const emptyPersistedFileStats: PersistedFileStats = {
  hiddenObjectCount: 0,
  loopCapCount: 0,
  objectCount: 0,
  triangleCount: 0,
};

function getSourceSummary(source: PersistedModelSource): Omit<PersistedModelSource, "data"> {
  return {
    lastModified: source.lastModified,
    name: source.name,
    size: source.size,
    type: source.type,
  };
}

function getRecordName(source: PersistedModelSource, patch?: PersistedFileRecordPatch) {
  return patch?.name ?? source.name;
}

function createFileRecord(
  slug: string,
  state: PersistedViewerState,
  existing: PersistedFileRecord | undefined,
  patch?: PersistedFileRecordPatch,
): PersistedFileRecord {
  return {
    createdAt: existing?.createdAt ?? state.savedAt,
    name: getRecordName(state.source, patch) || existing?.name || state.source.name,
    screenshotDataUrl:
      patch && "screenshotDataUrl" in patch
        ? (patch.screenshotDataUrl ?? null)
        : (existing?.screenshotDataUrl ?? null),
    slug,
    source: getSourceSummary(state.source),
    stats: patch?.stats ?? existing?.stats ?? emptyPersistedFileStats,
    updatedAt: state.savedAt,
    version: viewerPersistenceVersion,
  };
}

function getFileStateKey(slug: string) {
  return `${fileStateKeyPrefix}${slug}`;
}

function getSortedValidFileRecords(value: unknown) {
  return (Array.isArray(value) ? (value as PersistedFileRecord[]) : [])
    .filter((record) => record.version === viewerPersistenceVersion)
    .sort((first, second) => second.updatedAt - first.updatedAt);
}

function createSlugBase(name: string) {
  const withoutExtension = name.replace(/\.glb$/i, "");
  const slug = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "model";
}

export function createPersistedFileSlug(name: string, existingSlugs: Iterable<string>) {
  const usedSlugs = new Set(existingSlugs);
  const base = createSlugBase(name);
  let slug = base;
  let index = 2;

  while (usedSlugs.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }

  return slug;
}

export function createInitialPersistedViewerState(
  source: PersistedModelSource,
): PersistedViewerState {
  return {
    hiddenObjectIds: [],
    loopCapStates: [],
    meshes: [],
    nextObjectId: 1,
    objectNames: {},
    savedAt: Date.now(),
    source,
    version: viewerPersistenceVersion,
  };
}

function getLegacyMigrationSlug(state: PersistedViewerState) {
  return createSlugBase(state.source.name);
}

function openViewerDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("Timed out while opening IndexedDB."));
    }, databaseOpenTimeoutMs);
    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      reject(error);
    };
    const settleResolve = (database: IDBDatabase) => {
      if (settled) {
        database.close();
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      database.onversionchange = () => database.close();
      resolve(database);
    };
    const request = window.indexedDB.open(databaseName);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onblocked = () =>
      settleReject(
        new Error("IndexedDB upgrade is blocked by another open app tab. Close it and reload."),
      );
    request.onerror = () => settleReject(request.error ?? new Error("Could not open IndexedDB"));
    request.onsuccess = () => settleResolve(request.result);
  });
}

export async function listPersistedFiles() {
  const database = await openViewerDatabase();

  return new Promise<PersistedFileRecord[]>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.get(fileRecordsKey);
    let records: PersistedFileRecord[] = [];

    request.onerror = () => reject(request.error ?? new Error("Could not read files"));
    request.onsuccess = () => {
      records = getSortedValidFileRecords(request.result);

      if (records.length > 0) {
        return;
      }

      const legacyRequest = store.get(currentStateKey);

      legacyRequest.onsuccess = () => {
        const legacyState = legacyRequest.result as PersistedViewerState | undefined;

        if (!legacyState || legacyState.version !== viewerPersistenceVersion) {
          return;
        }

        const slug = getLegacyMigrationSlug(legacyState);
        const record = createFileRecord(slug, legacyState, undefined, {
          name: legacyState.source.name,
        });

        records = [record];
        store.put(legacyState, getFileStateKey(slug));
        store.put(records, fileRecordsKey);
      };
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(records);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not read files"));
    };
  });
}

export async function readPersistedFileRecord(slug: string) {
  const database = await openViewerDatabase();

  return new Promise<PersistedFileRecord | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(fileRecordsKey);
    let record: PersistedFileRecord | null = null;

    request.onerror = () => reject(request.error ?? new Error("Could not read file"));
    request.onsuccess = () => {
      record =
        getSortedValidFileRecords(request.result).find((candidate) => candidate.slug === slug) ??
        null;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(record);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not read file"));
    };
  });
}

export async function readPersistedViewerState(slug: string) {
  const database = await openViewerDatabase();

  return new Promise<PersistedViewerState | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(getFileStateKey(slug));
    let state: PersistedViewerState | null = null;

    request.onerror = () => reject(request.error ?? new Error("Could not read saved viewer"));
    request.onsuccess = () => {
      const value = request.result as PersistedViewerState | undefined;

      if (value && value.version === viewerPersistenceVersion) {
        state = value;
        return;
      }

      const legacyRequest = store.get(currentStateKey);

      legacyRequest.onsuccess = () => {
        const legacyState = legacyRequest.result as PersistedViewerState | undefined;

        if (
          legacyState &&
          legacyState.version === viewerPersistenceVersion &&
          getLegacyMigrationSlug(legacyState) === slug
        ) {
          state = legacyState;
        }
      };
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(state);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not read saved viewer"));
    };
  });
}

export async function savePersistedViewerState(
  slug: string,
  state: PersistedViewerState,
  recordPatch?: PersistedFileRecordPatch,
) {
  const database = await openViewerDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const stateRequest = store.put(state, getFileStateKey(slug));
    const recordRequest = store.get(fileRecordsKey);

    stateRequest.onerror = () => reject(stateRequest.error ?? new Error("Could not save viewer"));
    recordRequest.onerror = () =>
      reject(recordRequest.error ?? new Error("Could not save file record"));
    recordRequest.onsuccess = () => {
      const existing = getSortedValidFileRecords(recordRequest.result).find(
        (record) => record.slug === slug,
      );
      const nextRecord = createFileRecord(slug, state, existing, recordPatch);

      const records = getSortedValidFileRecords(recordRequest.result).filter(
        (record) => record.slug !== slug,
      );

      store.put([nextRecord, ...records], fileRecordsKey);
    };
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

export async function clearPersistedViewerState(slug: string) {
  const database = await openViewerDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const recordRequest = store.get(fileRecordsKey);
    const stateRequest = store.delete(getFileStateKey(slug));

    recordRequest.onerror = () =>
      reject(recordRequest.error ?? new Error("Could not clear saved file"));
    stateRequest.onerror = () =>
      reject(stateRequest.error ?? new Error("Could not clear saved viewer"));
    recordRequest.onsuccess = () => {
      store.put(
        getSortedValidFileRecords(recordRequest.result).filter((record) => record.slug !== slug),
        fileRecordsKey,
      );
    };
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

export async function readViewerStorageEstimate(): Promise<ViewerStorageEstimate | null> {
  if (!navigator.storage?.estimate) {
    return null;
  }

  const estimate = await navigator.storage.estimate();
  const estimateWithDetails = estimate as StorageEstimate & {
    usageDetails?: Record<string, number | undefined>;
  };
  const usage = estimate.usage ?? null;
  const quota = estimate.quota ?? null;
  const indexedDBUsage = estimateWithDetails.usageDetails?.indexedDB ?? null;
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;

  return {
    available: quota != null && usage != null ? Math.max(quota - usage, 0) : null,
    indexedDBUsage,
    persisted,
    quota,
    usage,
  };
}
