import type { WidgetDef } from "../widget-def";
import { LinkWidget } from "./LinkWidget";

export const linkWidgetDef: WidgetDef = {
  kind: "link",
  labelKey: "widget.label.link",
  icon: "link",
  defaultSizePx: { w: 420, h: 280 },
  minSizePx: { w: 180, h: 120 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "link",
    title: "",
    url: "",
    showQr: true,
  }),
  Component: LinkWidget,
};
