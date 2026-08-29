import type { WidgetDef } from "../widget-def";
import { DiceWidget } from "./DiceWidget";

export const diceWidgetDef: WidgetDef = {
  kind: "dice",
  labelKey: "widget.label.dice",
  icon: "dice",
  defaultSizePx: { w: 300, h: 240 },
  minSizePx: { w: 170, h: 150 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "dice",
    count: 1,
    lastRoll: [],
  }),
  Component: DiceWidget,
};
