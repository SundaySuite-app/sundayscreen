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
// ## Keyboard: in on opening, back out on closing, and no roving tabindex
//
// `menuitemradio` + `aria-checked` describes the three groups honestly, but
// the arrow-key roving-tabindex pattern that usually comes with a `menu` is
// NOT in this house — no other panel has it — and a die round is not the
// place to introduce a keyboard convention the other eleven widgets would
// then be missing. Every control is a real, tabbable button.
//
// That argument is about moving WITHIN the panel, and it never covered
// getting IN. The panel is a sibling of the surface (the host owns the box),
// so document order puts it after everything on the board: a teacher who
// opened it from the keyboard was left standing on the trigger with the first
// pill ELEVEN Tab stops away — the card's own chrome, then the whole toolbar,
// then the backdrop. Measured, in `e2e/dice-picker.spec.ts`. Since R5 this
// panel is also the ONLY route to the die type, so those eleven stops are not
// a shortcut anyone can decline.
//
// So focus is moved IN when the panel opens, onto the first type pill, and
// returned to whatever opened it when it closes (Escape, the backdrop, the
// card leaving the board). Two choices worth naming:
//
//  - onto a real `<button>`, not onto the panel root with `tabindex="-1"`:
//    a button is focusable in every engine without an added attribute,
//    WKWebView included, and it costs no extra Tab to reach the first
//    control. `preventScroll` because child effects run BEFORE the host's
//    placement effect, so at this moment the panel is still at its
//    pre-measurement `left: 0; top: 0`.
//  - the opener is REMEMBERED (`document.activeElement`), not looked up:
//    the trigger lives inside a card this file must not reach into, and the
//    keyboard journey this exists for always has it focused. A mouse open in
//    an engine that does not focus a clicked button leaves nothing to
//    remember — and `<body>` is exactly where the keyboard was before the
//    click, so there is nothing to restore either.

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
import { idleOrientationFor } from "./die-spin-core";
import styles from "./dice.module.css";

/**
 * One finish, as a die.
 *
 * A single frame — no rAF, no state. `paintDie` is imperative, so Preact
 * renders the pool and a layout effect paints it once; the effect has no deps
 * because the type and the colour above it can both change under it.
 *
 * Corner-on (`idleOrientationFor`), not square-on: a swatch drawn face-on
 * shows ONE face, and one face is the same picture for all five finishes.
 * The corner pose shows three-plus equally lit facets — which is exactly
 * what a FINISH swatch exists to differ on.
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
    paintDie(svg, solid, idleOrientationFor(solid), {
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
  // Hooks BEFORE the kind guard, so the hook order is unconditional no matter
  // what a future registry hands this component.
  const firstTypeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Mount only. Opening a SECOND panel while this one is up is unreachable —
  // the host's backdrop takes that click and closes this one first — so there
  // is no swap for a dependency list to catch.
  useLayoutEffect(() => {
    const opener = document.activeElement;
    // `<body>` is not somewhere to send the keyboard back to; it is where the
    // keyboard already is when nothing holds it.
    openerRef.current =
      opener instanceof HTMLElement && opener !== document.body ? opener : null;
    firstTypeRef.current?.focus({ preventScroll: true });
    return () => {
      const back = openerRef.current;
      // `isConnected`: the card can leave the board WHILE the panel is open
      // (the planner switches lesson on a timer, and the stale sweep in
      // `state/chrome.ts` closes the panel behind it). Focusing a detached
      // node is a silent no-op that would strand the keyboard on `<body>`
      // with no way back — so it is checked, not attempted.
      if (back?.isConnected) back.focus();
    };
  }, []);

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
          {FACE_OPTIONS.map((option, i) => (
            <button
              key={option}
              // Where the keyboard lands when the panel opens — the first
              // control of the first group, which is also where the eye
              // starts.
              ref={i === 0 ? firstTypeRef : undefined}
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

      {/* «Materiale», not «Utseende» a second time: the PANEL is the
          appearance panel, and a group inside it that repeats the panel's own
          name reads out as «Utseende, meny … Utseende, gruppe» — two
          different scopes wearing one word. The section is the finish, which
          is what `dice.materialName.*` has always called it. */}
      <div class={styles.section} role="group" aria-label={t("dice.material")}>
        <span class={styles.sectionLabel}>{t("dice.material")}</span>
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
