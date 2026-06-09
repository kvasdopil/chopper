import { edgeLoopCapTool } from "./edge-loop-cap-tool";
import { separationTool } from "./separation-tool";
import type { ViewerTool } from "./types";

export const defaultViewerTools: ViewerTool[] = [separationTool, edgeLoopCapTool];

export type { ViewerTool, ViewerToolId } from "./types";
