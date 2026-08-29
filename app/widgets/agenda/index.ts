import type { WidgetDef } from "../widget-def";
import { AgendaWidget } from "./AgendaWidget";

export const agendaWidgetDef: WidgetDef = {
  kind: "agenda",
  labelKey: "widget.label.agenda",
  icon: "agenda",
  defaultSizePx: { w: 380, h: 420 },
  minSizePx: { w: 240, h: 200 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "agenda",
    source: "planner",
    showTimes: true,
    manualItems: [],
    pinnedItemId: null,
  }),
  Component: AgendaWidget,
};
