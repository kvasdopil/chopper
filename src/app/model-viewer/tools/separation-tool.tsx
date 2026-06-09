import type { ComponentProps } from "react";

import { LinkedFaceSelectionPanel } from "../../viewer-controls/linked-face-selection-panel";
import type { ViewerTool } from "./types";

export const separationTool: ViewerTool = {
  id: "separation",
};

type SeparationToolPanelProps = ComponentProps<typeof LinkedFaceSelectionPanel>;

export function SeparationToolPanel(props: SeparationToolPanelProps) {
  return <LinkedFaceSelectionPanel {...props} />;
}
