import type { WidgetDef } from "../widget-def";
import { PIP_FACES } from "./dice-core";
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
    // The ordinary school die. Mirrors `default_dice_faces()` in layout.rs —
    // a widget added here and one healed by the backend must be the same die.
    faces: PIP_FACES,
    lastRoll: [],
  }),
  Component: DiceWidget,
};
