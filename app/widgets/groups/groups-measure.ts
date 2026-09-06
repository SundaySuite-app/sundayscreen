// A name's width in em — the DOM half of `groups-fit-core`'s `measure`.
//
// Canvas `measureText`, in the font a rendered chip actually has. The font
// is READ from a chip rather than spelled here: the weight lives in
// groups.module.css and the family in tokens.css, and a copy of either in
// this file is a seam that drifts the day one of them is retuned. Until a
// chip has been seen (the first render of a restored split) the estimate
// from the core stands in, and the layout effect that adopts the font bumps
// `measureEpoch` so the widget re-renders with real numbers before paint.
//
// Fonts settle late. Inter Variable is bundled, but at boot the first
// measurement can run against the system fallback while the woff2 is still
// landing — and «Andreas» in Helvetica is not «Andreas» in Inter. Every
// settled batch clears the cache and bumps the epoch; a widget that read the
// epoch re-measures. There is no timer and no polling in this: the font
// set's own events are the only clock.

import { signal } from "@preact/signals";

import { estimateEm } from "./groups-fit-core";

/** Bumped whenever a measurement may have changed. Read it in render to
 *  subscribe. */
export const measureEpoch = signal(0);

/** `undefined` = not tried yet; `null` = this environment has no canvas. */
let ctx: CanvasRenderingContext2D | null | undefined;
let font: string | null = null;
const cache = new Map<string, number>();

function invalidate(): void {
  cache.clear();
  measureEpoch.value++;
}

/** Adopt the computed font of a rendered chip, once. Later chips carry the
 *  same rule, so the first one seen is as good as any. */
export function adoptChipFont(chip: Element): void {
  if (font !== null) return;
  const cs = getComputedStyle(chip);
  // The `font` shorthand is empty in some engines' computed style; the
  // longhands are always there. 100px so the width divides to em exactly.
  font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
  invalidate();
}

/** The width of `name` at font-size 1em, in the adopted font. */
export function nameEm(name: string): number {
  if (ctx === undefined) {
    ctx =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  if (!ctx || font === null) return estimateEm(name);
  let em = cache.get(name);
  if (em === undefined) {
    ctx.font = font;
    em = ctx.measureText(name).width / 100;
    cache.set(name, em);
  }
  return em;
}

if (typeof document !== "undefined" && "fonts" in document) {
  // `ready` covers the boot-time load that is usually in flight when the
  // first split renders; `loadingdone` covers a face that starts loading
  // later (`ready` is already resolved by then and will not fire again).
  void document.fonts.ready.then(invalidate);
  document.fonts.addEventListener("loadingdone", invalidate);
}
