import type { WidgetDef } from "../widget-def";
import { GroupsWidget } from "./GroupsWidget";

export const groupsWidgetDef: WidgetDef = {
  kind: "groups",
  labelKey: "widget.label.groups",
  defaultSizePx: { w: 560, h: 380 },
  minSizePx: { w: 320, h: 240 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "groups",
    mode: "count",
    n: 2,
    lastResult: [],
  }),
  Component: GroupsWidget,
};
