// THE LOOK — what the six families and five finishes are, as data.
//
// The finishes themselves are CSS: a material is a five-step tone ramp mixed
// out of its family's body colour, and that arithmetic belongs in
// `dice.module.css` where the gate can read it (`dice-ramp.test.ts`). What
// cannot live in a stylesheet is the handful of EXTRA PARTS a finish asks the
// renderer for — a pattern to fill its faces with, a specular window to clip,
// a plate under the numeral, the far edges drawn instead of dropped — because
// each of those is a DOM node that has to exist before CSS can style it.
//
// So: this file says which parts a material wants; the stylesheet says what
// they look like. Pure — no DOM, no colour, no timing.

import type { DieColor } from "../../bindings/DieColor";
import type { DieMaterial } from "../../bindings/DieMaterial";

/**
 * The six families, in the order the picker offers them — lightest body
 * first, which is also the luminance ladder `tokens.test.ts` proves them
 * apart on. A list rather than `Object.keys` of something: the ORDER is a
 * design decision (six swatches a teacher scans in half a second read as a
 * ladder, not as a bag), and a key order is not.
 */
export const DIE_COLORS: readonly DieColor[] = [
  "classic",
  "gold",
  "green",
  "red",
  "blue",
  "slate",
];

/** The five finishes, plainest first. `ivory` is the default — the die the
 *  widget has always drawn. */
export const DIE_MATERIALS: readonly DieMaterial[] = [
  "ivory",
  "casino",
  "wood",
  "metal",
  "glass",
];

/** The extra parts one finish asks the renderer to build. */
export interface MaterialTraits {
  /**
   * Draw the faces turned AWAY from the class, as faint lines.
   *
   * Glass is the only one, and it is the whole of what makes glass read as
   * glass: every other material's back faces are culled by
   * `die-project-core` and never reach the DOM as anything visible.
   *
   * Read by `paintDie`, which writes it onto the die's `<svg>` as
   * `data-back-faces`; the stylesheet keys the far edges off THAT and not off
   * the material's name, so this field is what actually decides (R5-funn M2).
   */
  backFaces: boolean;
  /** Fill the faces from an SVG `<pattern>` instead of a flat tone — one
   *  pattern per tone step, so the grain darkens with the face. */
  grain: boolean;
  /** A specular window clipped to the brightest face — the one thing that
   *  makes a casino die look wet rather than merely bright. */
  gloss: boolean;
  /**
   * A plate of the card's own paper under the front NUMERAL. Glass draws its
   * far edges straight across the front faces, and a «17» with two of them
   * running through it is unreadable at the back of the room.
   *
   * ⚠️ LABEL faces only — a pip face never gets one, so a glass d6 has the
   * node and never shows it (`paintDie` hides the plate whenever the up face
   * has no label matrix). That is deliberate and not a gap: a pip is a solid
   * dot the size of a fingertip, and a far edge crossing one leaves it a
   * solid dot. It is a numeral's THIN strokes that a hairline through them
   * turns into a different number.
   */
  plate: boolean;
}

/**
 * ⚠️ Keyed by `DieMaterial`, so a sixth finish added in Rust is a tsc error
 * here rather than a die that renders with no parts at all.
 */
export const MATERIAL_TRAITS: Record<DieMaterial, MaterialTraits> = {
  ivory: { backFaces: false, grain: false, gloss: false, plate: false },
  casino: { backFaces: false, grain: false, gloss: true, plate: false },
  wood: { backFaces: false, grain: true, gloss: false, plate: false },
  metal: { backFaces: false, grain: false, gloss: false, plate: false },
  glass: { backFaces: true, grain: false, gloss: false, plate: true },
};

/**
 * An id for one of a die's own `<defs>` children.
 *
 * ⚠️ SVG ids are DOCUMENT-global, and `url(#…)` resolves against the whole
 * page — so six dice on a board, each with a `<pattern id="grain">`, would
 * all paint themselves out of whichever one happened to be parsed last, and
 * the bug would only show up on a board with more than one die of the same
 * type. The widget's own id is the only thing on hand that is unique per
 * card, so it is the prefix.
 *
 * The leading letters are not decoration either: `crypto.randomUUID()` can
 * start with a digit, and an id that starts with a digit is legal in HTML but
 * cannot be written as a bare CSS selector — which is exactly the sort of
 * thing that works until the day somebody wants to style one.
 */
export function dieDefId(widgetId: string, part: string): string {
  return `die-${widgetId}-${part}`;
}
