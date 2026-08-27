import type { WidgetDef } from "../widget-def";
import { WorkSymbolWidget } from "./WorkSymbolWidget";

export const workSymbolWidgetDef: WidgetDef = {
  kind: "worksymbol",
  labelKey: "widget.label.worksymbol",
  defaultSizePx: { w: 320, h: 300 },
  minSizePx: { w: 180, h: 170 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "worksymbol",
    mode: "silent",
  }),
  Component: WorkSymbolWidget,
};
