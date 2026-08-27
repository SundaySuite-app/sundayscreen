import type { WidgetDef } from "../widget-def";
import { TimerWidget } from "./TimerWidget";

export const timerWidgetDef: WidgetDef = {
  kind: "timer",
  labelKey: "widget.label.timer",
  defaultSizePx: { w: 440, h: 280 },
  minSizePx: { w: 260, h: 180 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "timer",
    durationMs: 300_000,
    warnAtMs: 60_000,
    soundOn: true,
    mode: "countdown",
  }),
  Component: TimerWidget,
};
