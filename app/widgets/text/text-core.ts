// The text widget's ONE number, as pure functions — the component only wires
// them to two buttons.
//
// ## Why the clamp lives here too
//
// `WidgetConfig::Text` in `crates/sundayscreen-core/src/layout.rs` clamps
// `font_scale` to 0.25..6.0 (and non-finite back to 1.0) on the way into the
// store. A frontend that let 7.5 live in the signal would therefore show one
// size before a restart and another after — a visible JUMP, promise #2
// broken, and a SEAM BUG of exactly the shape `reference-seam-bugs`
// describes: two layers each correct on their own, disagreeing at the joint,
// both with green tests. The clamp is mirrored, not assumed.
//
// ## Why a stop list and not a multiplier
//
// A ×1.2 stepper produces 1.728 and 2.0736 — numbers no one chose, that
// differ between two cards a teacher wanted to match. Seven stops are the
// whole vocabulary, and the ends are honestly `disabled` rather than
// silently inert.

/** Mirrors layout.rs. */
export const FONT_SCALE_MIN = 0.25;
export const FONT_SCALE_MAX = 6.0;

/** The A− / A+ vocabulary. Ordered, and every member inside the clamp. */
export const FONT_STOPS: readonly number[] = [
  0.6, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5,
];

/** What the backend would store, computed here so the board shows it now. */
export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1.0;
  return Math.min(Math.max(scale, FONT_SCALE_MIN), FONT_SCALE_MAX);
}

/**
 * The stop NEAREST the current scale — `reduce`, not `indexOf`.
 *
 * A card configured by an older build (or a hand-edited config) carries a
 * value that is not on the list at all; an exact lookup would return −1 and
 * leave BOTH buttons dead, which is the one failure a teacher cannot work
 * around. Ties keep the lower stop.
 */
export function nearestStop(scale: number): number {
  const v = clampFontScale(scale);
  return FONT_STOPS.reduce((best, s) =>
    Math.abs(s - v) < Math.abs(best - v) ? s : best,
  );
}

/**
 * One press of A− (`dir: -1`) or A+ (`dir: 1`). `null` at the ends: the
 * caller renders `disabled` from the same answer it would act on, so a
 * disabled button and a no-op press are one fact, not two.
 */
export function steppedScale(scale: number, dir: -1 | 1): number | null {
  const next = FONT_STOPS.indexOf(nearestStop(scale)) + dir;
  if (next < 0 || next >= FONT_STOPS.length) return null;
  return FONT_STOPS[next];
}
