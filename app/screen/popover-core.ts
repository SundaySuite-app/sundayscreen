// Where a popover lands next to the control that opened it — pure and
// table-tested. The DOM half is `app/screen/WidgetOverlay.tsx`, which
// measures the panel after mount and writes these two numbers to `style`.
//
// Deliberately NOT the browser's own anchor positioning (`anchor-name` /
// `position-area`): WKWebView on the macOS versions this app supports does
// not carry it, and «the panel is off the screen on the school laptop» is
// exactly the class of failure a projector app cannot ship. Eighty lines of
// arithmetic with a table behind it is the cheaper promise.

import type { Size } from "./coords-core";

/**
 * The control the panel belongs to, in VIEWPORT pixels — i.e. straight out of
 * `getBoundingClientRect()`.
 *
 * Its own type rather than `PxRect` from coords-core, which means "pixels
 * against the SURFACE". The surface is inset by the chrome and (in Tauri) by
 * the window frame, so the two frames of reference differ by a few dozen
 * pixels — enough to push a panel off a 768-tall screen, and impossible to
 * catch in review if both are spelled the same.
 */
export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which side of the anchor the panel ended up on. The caller renders it as
 *  `data-placement` so the pointer/shadow can face the right way — and so a
 *  journey can assert the flip happened rather than guess from coordinates. */
export type PopoverPlacement = "above" | "below";

export interface PopoverPos {
  x: number;
  y: number;
  placement: PopoverPlacement;
}

/** The air between the anchor and the panel — and, for lack of a reason to
 *  have two knobs, the same air the panel keeps from the screen edges. */
export const POPOVER_GAP_PX = 8;

/**
 * Place `panel` next to `anchor` inside `viewport`.
 *
 * BELOW by default, flipped ABOVE when the panel does not fit under the
 * anchor — the ordinary case for a control on a widget's bottom settings row,
 * which is where the first of these panels opens from. When neither side
 * fits (a short window, a tall panel) the roomier side wins and the panel is
 * clamped: overlapping the anchor is bad, and being off-screen is worse.
 *
 * The result is ALWAYS inside the viewport, with two documented exceptions
 * that are the same exception: when the panel is larger than the viewport on
 * an axis, that axis pins to 0, so the top-left corner — where reading starts
 * — is the part that survives. Never a negative coordinate, never `NaN` on an
 * unmeasured (0×0) viewport.
 */
export function popoverPos(
  anchor: AnchorRect,
  panel: Size,
  viewport: Size,
  gap: number = POPOVER_GAP_PX,
): PopoverPos {
  const belowY = anchor.y + anchor.h + gap;
  const aboveY = anchor.y - gap - panel.h;

  // «Fits» means EXACTLY «the clamp below will not have to move it» — the
  // edge margin is part of both halves or of neither. Measured against the
  // bare viewport instead, the last few pixels of the fitting range would say
  // «below», and the clamp would then quietly slide the panel back up those
  // pixels until it touched the trigger it was supposed to hang under.
  const fitsBelow = belowY + panel.h <= viewport.h - gap;
  const fitsAbove = aboveY >= gap;
  // Room MEASURED FROM THE ANCHOR, not from the flipped panel's own top edge:
  // the question in the last-resort branch is «which side of this control has
  // more screen», and that is a property of the control alone.
  const roomBelow = viewport.h - (anchor.y + anchor.h);
  const roomAbove = anchor.y;
  const placement: PopoverPlacement = fitsBelow
    ? "below"
    : fitsAbove
      ? "above"
      : roomBelow >= roomAbove
        ? "below"
        : "above";

  return {
    // Centred on the anchor, then clamped — so a panel wider than its trigger
    // opened from the screen's edge slides inward instead of hanging off it.
    x: clampAxis(
      anchor.x + anchor.w / 2 - panel.w / 2,
      panel.w,
      viewport.w,
      gap,
    ),
    y: clampAxis(
      placement === "below" ? belowY : aboveY,
      panel.h,
      viewport.h,
      gap,
    ),
    placement,
  };
}

/**
 * One axis, clamped into `[margin, extent - size - margin]`.
 *
 * The fallback branch is the whole reason this is a named function: when the
 * panel is within `2 * margin` of the viewport's own size that interval is
 * EMPTY, and a naive `Math.min(Math.max(…))` on a reversed interval returns
 * the upper bound — which is negative, i.e. off the top-left of the screen.
 * The margin is a nicety; staying on screen is not, so it is the margin that
 * gives way.
 */
function clampAxis(
  pos: number,
  size: number,
  extent: number,
  margin: number,
): number {
  const min = margin;
  const max = extent - size - margin;
  if (max < min) {
    return Math.min(Math.max(pos, 0), Math.max(extent - size, 0));
  }
  return Math.min(Math.max(pos, min), max);
}
