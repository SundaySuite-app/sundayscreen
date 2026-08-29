import type { WidgetDef } from "../widget-def";
import { ChecklistWidget } from "./ChecklistWidget";

export const checklistWidgetDef: WidgetDef = {
  kind: "checklist",
  labelKey: "widget.label.checklist",
  icon: "checklist",
  defaultSizePx: { w: 340, h: 380 },
  minSizePx: { w: 200, h: 160 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "checklist",
    items: [],
  }),
  Component: ChecklistWidget,
};
