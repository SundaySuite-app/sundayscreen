import type { WidgetDef } from "../widget-def";
import { TodayWidget } from "./TodayWidget";

export const todayWidgetDef: WidgetDef = {
  kind: "today",
  labelKey: "widget.label.today",
  icon: "today",
  defaultSizePx: { w: 520, h: 420 },
  minSizePx: { w: 260, h: 180 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "today",
    showLessons: true,
    showNotes: true,
  }),
  Component: TodayWidget,
};
