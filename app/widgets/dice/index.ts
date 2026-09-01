import type { WidgetDef } from "../widget-def";
import { PIP_FACES } from "./dice-core";
import { DiceWidget } from "./DiceWidget";
import { DieLookMenu } from "./DieLookMenu";

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
    zeroBased: false,
    lastRoll: [],
    // The same mirror one axis over: `DieColor::default()` /
    // `DieMaterial::default()` in layout.rs. These are the two places a die
    // is BORN — here when the teacher adds one, and `default_for("dice")`
    // when the backend heals a config it could not read — and a die that
    // came back from a bad row must not look different from the one beside
    // it. The literals are checked by the generated `WidgetConfig` union,
    // so a renamed variant is a tsc error rather than a silent re-colour.
    color: "classic",
    material: "ivory",
  }),
  Component: DiceWidget,
  // The die is the first kind to use the registry's overlay slot: its
  // appearance panel is too big for the card and would be clipped at the
  // card's edge if the widget tried to draw it itself. Declaring it here is
  // the whole wiring — the screen layer places it, layers it and gives it its
  // Escape rung (see `WidgetDef.Overlay`).
  Overlay: DieLookMenu,
};
