import type { WidgetDef } from "../widget-def";
import { DeadlineWidget } from "./DeadlineWidget";

export const deadlineWidgetDef: WidgetDef = {
  kind: "deadline",
  labelKey: "widget.label.deadline",
  icon: "deadline",
  defaultSizePx: { w: 320, h: 220 },
  minSizePx: { w: 180, h: 130 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "deadline",
    title: "",
    targetEpochMs: 0,
    showHours: true,
  }),
  Component: DeadlineWidget,
};
