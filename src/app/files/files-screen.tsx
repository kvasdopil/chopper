"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  LuBox,
  LuClock3,
  LuHardDrive,
  LuImage,
  LuLayers,
  LuLoaderCircle,
  LuUpload,
} from "react-icons/lu";
import { useRouter } from "next/navigation";

import { createGlbFilePreview } from "./file-preview";
import {
  createInitialPersistedViewerState,
  createPersistedFileSlug,
  emptyPersistedFileStats,
  listPersistedFiles,
  readViewerStorageEstimate,
  savePersistedViewerState,
  type PersistedFileRecord,
  type ViewerStorageEstimate,
} from "../model-viewer/persistence";
import type { PersistedModelSource } from "../model-viewer/persistence";

const relativeDateFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absoluteDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const numberFormatter = new Intl.NumberFormat("en");
const importLogPrefix = "[GLB import]";

function getDisplayFileName(name: string) {
  return name.replace(/\.glb$/i, "");
}

function formatModifiedDate(timestamp: number) {
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  if (absoluteSeconds < 10) {
    return "just now";
  }

  if (absoluteSeconds < 60 * 60 * 24 * 7) {
    const [unit, unitSeconds] =
      units.find(([, seconds]) => absoluteSeconds >= seconds) ?? units[units.length - 1];

    return relativeDateFormatter.format(Math.round(diffSeconds / unitSeconds), unit);
  }

  return absoluteDateFormatter.format(new Date(timestamp));
}

function formatBytes(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current >= 10 || unitIndex === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`;
}

function getStorageLine(estimate: ViewerStorageEstimate | null) {
  if (!estimate) {
    return "Storage estimate unavailable";
  }

  const idbUsage = estimate.indexedDBUsage ?? estimate.usage;
  const available = estimate.available;
  const quota = estimate.quota;

  return `IndexedDB ${formatBytes(idbUsage)} used · ${formatBytes(available)} available of ${formatBytes(quota)}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function logImportStep(startedAt: number, step: string, details?: Record<string, unknown>) {
  console.info(importLogPrefix, step, {
    elapsedMs: Math.round(performance.now() - startedAt),
    ...details,
  });
}

function FileStats({ file }: { file: PersistedFileRecord }) {
  const stats = file.stats ?? emptyPersistedFileStats;

  return (
    <div className="grid grid-cols-2 gap-2 text-xs text-neutral-600">
      <span>{numberFormatter.format(stats.objectCount)} objects</span>
      <span>{numberFormatter.format(stats.triangleCount)} triangles</span>
      <span>{numberFormatter.format(stats.loopCapCount)} loops</span>
      <span>{formatBytes(file.source.size)}</span>
    </div>
  );
}

function FileCard({ file }: { file: PersistedFileRecord }) {
  return (
    <Link
      href={`/file/${file.slug}`}
      className="group overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
    >
      <div className="aspect-[4/3] bg-neutral-100">
        {file.screenshotDataUrl ? (
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${file.screenshotDataUrl})` }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400">
            <LuImage aria-hidden="true" className="text-4xl" />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-neutral-950">
            {getDisplayFileName(file.name)}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
            <LuClock3 aria-hidden="true" />
            {formatModifiedDate(file.updatedAt)}
          </p>
        </div>
        <FileStats file={file} />
      </div>
    </Link>
  );
}

export function FilesScreen() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<PersistedFileRecord[]>([]);
  const [storageEstimate, setStorageEstimate] = useState<ViewerStorageEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFiles = useCallback(async () => {
    const nextFiles = await listPersistedFiles();
    const nextStorageEstimate = await readViewerStorageEstimate().catch((storageError) => {
      console.warn("Could not read storage estimate", storageError);

      return null;
    });

    setFiles(nextFiles);
    setStorageEstimate(nextStorageEstimate);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    refreshFiles()
      .catch((refreshError) => {
        console.error("Could not read saved files", refreshError);

        if (!cancelled) {
          setError(
            refreshError instanceof Error && refreshError.message.trim().length > 0
              ? refreshError.message
              : "Could not read saved files.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshFiles]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const startedAt = performance.now();

    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".glb")) {
      setError("Choose a .glb file.");
      return;
    }

    setUploading(true);
    setError(null);
    logImportStep(startedAt, "selected file", {
      lastModified: file.lastModified,
      name: file.name,
      size: file.size,
      type: file.type,
    });

    try {
      logImportStep(startedAt, "reading file");
      const data = await file.arrayBuffer();
      const source: PersistedModelSource = {
        data,
        lastModified: file.lastModified,
        name: file.name,
        size: file.size,
        type: file.type,
      };

      logImportStep(startedAt, "creating preview", {
        byteLength: data.byteLength,
      });
      const preview = await createGlbFilePreview(source);
      const slug = createPersistedFileSlug(
        file.name,
        files.map((record) => record.slug),
      );
      const state = createInitialPersistedViewerState({
        ...source,
        data: source.data.slice(0),
      });

      logImportStep(startedAt, "saving local file", {
        slug,
        stats: preview.stats,
      });
      await savePersistedViewerState(slug, state, {
        name: file.name,
        screenshotDataUrl: preview.screenshotDataUrl,
        stats: preview.stats,
      });
      logImportStep(startedAt, "refreshing file list", { slug });
      await refreshFiles();
      logImportStep(startedAt, "opening editor", { slug });
      router.push(`/file/${slug}`);
    } catch (uploadError) {
      console.error(importLogPrefix, "failed", {
        elapsedMs: Math.round(performance.now() - startedAt),
        error: uploadError,
        file: {
          name: file.name,
          size: file.size,
          type: file.type,
        },
      });
      setError(getErrorMessage(uploadError, "Could not import this GLB."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-100 px-5 py-6 text-neutral-950 sm:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-neutral-950">Files</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-neutral-600">
              <LuHardDrive aria-hidden="true" />
              {getStorageLine(storageEstimate)}
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".glb,model/gltf-binary"
            className="sr-only"
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-wait disabled:opacity-70"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <LuLoaderCircle aria-hidden="true" className="animate-spin text-base" />
            ) : (
              <LuUpload aria-hidden="true" className="text-base" />
            )}
            Load GLB
          </button>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-80 items-center justify-center text-neutral-500">
            <LuLoaderCircle aria-hidden="true" className="mr-2 animate-spin" />
            Loading files
          </div>
        ) : files.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {files.map((file) => (
              <FileCard key={file.slug} file={file} />
            ))}
          </section>
        ) : (
          <section className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
              <LuLayers aria-hidden="true" className="text-xl" />
            </div>
            <h2 className="mt-4 text-base font-bold text-neutral-950">No files yet</h2>
            <p className="mt-2 max-w-sm text-sm text-neutral-600">
              Load a GLB to create a local editable file with its own saved state.
            </p>
            <button
              type="button"
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-wait disabled:opacity-70"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <LuBox aria-hidden="true" className="text-base" />
              Load GLB
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
