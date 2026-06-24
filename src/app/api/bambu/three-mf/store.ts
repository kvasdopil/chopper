const bambuFileTtlMs = 10 * 60 * 1000;
const maxStoredBambuFiles = 8;
const maxBambuFileSizeBytes = 256 * 1024 * 1024;

export type StoredBambuFile = {
  contentType: string;
  data: ArrayBuffer;
  expiresAt: number;
  name: string;
};

const storedBambuFiles = new Map<string, StoredBambuFile>();

export function sanitizeBambuFileName(name: string) {
  const trimmedName = name.trim() || "model.3mf";
  const withoutPath = trimmedName.replace(/[\\/]/g, "-");
  const safeName = withoutPath
    .replace(/[^\w .()[\]-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return safeName || "model.3mf";
}

export function cleanupExpiredBambuFiles(now = Date.now()) {
  storedBambuFiles.forEach((file, id) => {
    if (file.expiresAt <= now) {
      storedBambuFiles.delete(id);
    }
  });

  while (storedBambuFiles.size > maxStoredBambuFiles) {
    const oldestId = storedBambuFiles.keys().next().value as string | undefined;

    if (!oldestId) {
      break;
    }

    storedBambuFiles.delete(oldestId);
  }
}

export function assertBambuFileSize(size: number) {
  if (size > maxBambuFileSizeBytes) {
    throw new Error("3MF is too large to send to Bambu Studio.");
  }
}

export function setBambuFile(id: string, file: Omit<StoredBambuFile, "expiresAt">) {
  cleanupExpiredBambuFiles();
  storedBambuFiles.set(id, {
    ...file,
    expiresAt: Date.now() + bambuFileTtlMs,
  });
}

export function getBambuFile(id: string) {
  cleanupExpiredBambuFiles();

  const file = storedBambuFiles.get(id);

  if (!file || file.expiresAt <= Date.now()) {
    storedBambuFiles.delete(id);
    return null;
  }

  return file;
}
