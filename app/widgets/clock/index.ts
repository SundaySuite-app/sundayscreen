import type { WidgetDef } from "../widget-def";
import { ClockWidget } from "./ClockWidget";

export const clockWidgetDef: WidgetDef = {
  kind: "clock",
  labelKey: "widget.label.clock",
  defaultSizePx: { w: 300, h: 300 },
  minSizePx: { w: 170, h: 170 },
  aspect: "square",
  defaultConfig: () => ({
    kind: "clock",
    face: "digital",
    showSeconds: false,
    showDate: false,
  }),
  Component: ClockWidget,
};
