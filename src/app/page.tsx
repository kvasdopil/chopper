"use client";

import { ModelViewer } from "./model-viewer/model-viewer";
import { defaultViewerTools } from "./model-viewer/tools";

export default function Home() {
  return <ModelViewer tools={defaultViewerTools} />;
}
