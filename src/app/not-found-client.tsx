"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModelViewer } from "./model-viewer/model-viewer";
import { defaultViewerTools } from "./model-viewer/tools";

function getFileSlugFromPath(pathname: string) {
  const match = /^\/file\/([^/?#]+)$/.exec(pathname);

  return match ? decodeURIComponent(match[1]) : null;
}

export function NotFoundClient() {
  const pathname = usePathname();
  const fileSlug = getFileSlugFromPath(pathname);

  if (fileSlug) {
    return <ModelViewer fileSlug={fileSlug} tools={defaultViewerTools} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Not found</h1>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
        >
          Back to files
        </Link>
      </div>
    </main>
  );
}
