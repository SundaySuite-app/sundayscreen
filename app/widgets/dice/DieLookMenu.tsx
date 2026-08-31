// THE APPEARANCE PANEL — type, colour and finish, in one place.
//
// Registered as the die's `WidgetDef.Overlay`, which means the SCREEN draws
// it: every card is `overflow: hidden` with `container-type: size`, so a
// widget cannot open a popover of its own (see `widget-def.ts` and
// `screen/WidgetOverlay.tsx`). This file renders the contents; the host owns
// the box, the layer, the backdrop and the Escape rung.
//
// ## Three sections, three different kinds of swatch
//
// A type is a WORD («D20») — six pills. A colour is a COLOUR — six flat
// blocks, because six of those are scanned in half a second while six labels
// are read one at a time. A finish is a SHADING, which is the one thing
// neither a word nor a flat block can show: «kasino» and «metall» differ in
// how the light falls across the facets, so the five finish swatches are five
// real dice, drawn at 40 px by the same `paintDie` the card uses, in the type
// and colour the teacher currently has. She is looking at the die she will
// get, not at a name for it.
//
// ## Nothing here closes the panel
//
// A teacher comparing wood against metal presses two of these in a row, and a
// panel that shut after the first would make the comparison a chore. The way
// out is the backdrop or Escape — both of which the host already owns, which
// is why the `close` the slot hands over is not destructured here.
//
// ## Keyboard: Tab and Escape, and no roving tabindex
//
// `menuitemradio` + `aria-checked` describes the three groups honestly, but
// the arrow-key roving-tabindex pattern that usually comes with a `menu` is
// NOT in this house — no other panel has it — and a die round is not the
// place to introduce a keyboard convention the other eleven widgets would
// then be missing. Every control is a real, tabbable button.

import { useLayoutEffect, useRef } from "preact/hooks";

import type { DieColor } from "../../bindings/DieColor";
import type { DieMaterial } from "../../bindings/DieMaterial";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tDyn, tf } from "../../i18n";
import { updateWidgetConfigBy } from "../../state/layout";
import { FACE_OPTIONS, snapFaces } from "./dice-core";
import { facePool, paintDie } from "./DiceWidget";
import {
  dieDefId,
  DIE_COLORS,
  DIE_MATERIALS,
  MATERIAL_TRAITS,
} from "./die-materials-core";
import { solidFor } from "./die-solids-core";
import { IDLE_TILT } from "./die-spin-core";
import styles from "./dice.module.css";

/**
 * One finish, as a die.
 *
 * A single frame — no rAF, no state. `paintDie` is imperative, so Preact
 * renders the pool and a layout effect paints it once; the effect has no deps
 * because the type and the colour above it can both change under it.
 *
 * `IDLE_TILT`, not square-on: a swatch drawn face-on shows ONE face, and one
 * face is the same picture for all five finishes.
 */
function FinishSwatch({
  widgetId,
  faces,
  material,
}: {
  widgetId: string;
  faces: number;
  material: DieMaterial;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const solid = solidFor(faces);
  const traits = MATERIAL_TRAITS[material];
  const id = (part: string) => dieDefId(`${widgetId}-look-${material}`, part);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    paintDie(svg, solid, IDLE_TILT, {
      traits,
      poolKey: `${solid.sides}:${material}`,
      grainId: (tone) => id(`grain${tone}`),
    });
  });

  return (
    <svg
      ref={ref}
      class={styles.miniDie}
      viewBox="0 0 100 100"
      data-mini-die={material}
      aria-hidden="true"
    >
      {facePool(solid, material, id)}
    </svg>
  );
}

export function DieLookMenu({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "dice") return null;
  const faces = snapFaces(cfg.faces);

  const write = (patch: {
    faces?: number;
    color?: DieColor;
    material?: DieMaterial;
  }) => {
    updateWidgetConfigBy(widget.id, (current) =>
      current.kind === "dice"
        ? {
            ...current,
            ...patch,
            // A TYPE change clears the roll — «5-5-6» under a D8 label is a
            // lie about what the class just watched. Colour and finish do
            // NOT: re-cutting the same die out of red glass does not change
            // what it landed on, and clearing the answer would make choosing
            // a colour a destructive act.
            ...(patch.faces !== undefined && patch.faces !== current.faces
              ? { lastRoll: [] }
              : {}),
          }
        : current,
    );
  };

  return (
    <div class={styles.panel} role="menu" aria-label={t("dice.look")}>
      <div class={styles.section} role="group" aria-label={t("dice.faces")}>
        <span class={styles.sectionLabel}>{t("dice.faces")}</span>
        <div class={styles.row}>
          {FACE_OPTIONS.map((option) => (
            <button
              key={option}
              class={styles.pill}
              data-die-faces={option}
              role="menuitemradio"
              aria-checked={option === faces}
              onClick={() => write({ faces: option })}
            >
              {tf("dice.facesLabel", { n: option })}
            </button>
          ))}
        </div>
      </div>

      <div class={styles.section} role="group" aria-label={t("dice.color")}>
        <span class={styles.sectionLabel}>{t("dice.color")}</span>
        <div class={styles.row}>
          {DIE_COLORS.map((option) => (
            // The swatch is its own label, so the family's ink has to be
            // legible ON it — which is also a live check on the pair
            // `tokens.test.ts` proves: a tick nobody can see is a family that
            // failed its floor.
            <button
              key={option}
              class={`${styles.chip} ${styles.look}`}
              data-color={option}
              data-die-color={option}
              role="menuitemradio"
              aria-checked={option === cfg.color}
              aria-label={tDyn("dice.colorName", option)}
              title={tDyn("dice.colorName", option)}
              onClick={() => write({ color: option })}
            >
              <span class={styles.chipMark} />
            </button>
          ))}
        </div>
      </div>

      <div class={styles.section} role="group" aria-label={t("dice.look")}>
        <span class={styles.sectionLabel}>{t("dice.look")}</span>
        <div class={styles.row}>
          {DIE_MATERIALS.map((option) => (
            <button
              key={option}
              class={`${styles.finish} ${styles.look}`}
              data-color={cfg.color}
              data-material={option}
              data-die-material={option}
              role="menuitemradio"
              aria-checked={option === cfg.material}
              aria-label={tDyn("dice.materialName", option)}
              title={tDyn("dice.materialName", option)}
              onClick={() => write({ material: option })}
            >
              <FinishSwatch
                widgetId={widget.id}
                faces={faces}
                material={option}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
