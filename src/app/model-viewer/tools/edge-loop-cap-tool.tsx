import type { ComponentProps } from "react";

import { LoopPanel } from "../../viewer-controls/loop-panel";
import type { ViewerTool } from "./types";

export const edgeLoopCapTool: ViewerTool = {
  id: "edge-loop-cap",
};

type EdgeLoopCapToolPanelProps = ComponentProps<typeof LoopPanel>;

export function EdgeLoopCapToolPanel(props: EdgeLoopCapToolPanelProps) {
  return <LoopPanel {...props} />;
}
