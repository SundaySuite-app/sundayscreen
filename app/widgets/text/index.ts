import type { WidgetDef } from "../widget-def";
import { TextWidget } from "./TextWidget";

export const textWidgetDef: WidgetDef = {
  kind: "text",
  labelKey: "widget.label.text",
  defaultSizePx: { w: 520, h: 240 },
  minSizePx: { w: 200, h: 120 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "text",
    content: "",
    fontScale: 1.0,
    align: "center",
  }),
  Component: TextWidget,
};
