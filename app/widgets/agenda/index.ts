import type { WidgetDef } from "../widget-def";
import { AgendaWidget } from "./AgendaWidget";

export const agendaWidgetDef: WidgetDef = {
  kind: "agenda",
  labelKey: "widget.label.agenda",
  icon: "agenda",
  // The default grows with the type (see agenda.module.css); the MINIMUM does
  // not — a teacher who deliberately shrinks the card keeps that right.
  defaultSizePx: { w: 460, h: 520 },
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
