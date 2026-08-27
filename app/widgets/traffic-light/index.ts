import type { WidgetDef } from "../widget-def";
import { TrafficLightWidget } from "./TrafficLightWidget";

export const trafficLightWidgetDef: WidgetDef = {
  kind: "trafficlight",
  labelKey: "widget.label.trafficlight",
  defaultSizePx: { w: 190, h: 420 },
  minSizePx: { w: 120, h: 260 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "trafficlight",
    active: "red",
  }),
  Component: TrafficLightWidget,
};
