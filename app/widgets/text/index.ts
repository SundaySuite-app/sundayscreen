import type { WidgetDef } from "../widget-def";
import { TextWidget } from "./TextWidget";

export const textWidgetDef: WidgetDef = {
  kind: "text",
  labelKey: "widget.label.text",
  icon: "text",
  defaultSizePx: { w: 520, h: 240 },
  // 260×160, not 200×120: below that the projector formula in
  // text.module.css has nothing left to shrink into, and the card stops
  // being a message anyone can read from a desk.
  minSizePx: { w: 260, h: 160 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "text",
    content: "",
    fontScale: 1.0,
    align: "center",
  }),
  Component: TextWidget,
};
