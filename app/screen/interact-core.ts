// The interaction layer's math — pure, table-tested, all in PX SPACE (the
// pointer's world). `toNorm`/`fromNorm` sit at the seam; nothing here knows
// about signals or the DOM.

import type { PxRect, Size } from "./coords-core";

/** How far a pointer must travel before a press becomes a DRAG (px). Under
 *  this it is a click — which is what lets the text widget's click-to-edit
 *  and dragging share the same surface. */
export const DRAG_THRESHOLD_PX = 4;

/** Snap distance, px. */
export const SNAP_PX = 8;

/** A snap result: the (possibly moved) rect plus the guide lines to draw. */
export interface SnapResult {
  rect: PxRect;
  /** Vertical guide x-positions, px. */
  guidesV: number[];
  /** Horizontal guide y-positions, px. */
  guidesH: number[];
}

/** Move `start` by the pointer delta, kept fully on the surface. */
export function dragMove(
  start: PxRect,
  dx: number,
  dy: number,
  surface: Size,
): PxRect {
  return {
    x: clamp(start.x + dx, 0, Math.max(surface.w - start.w, 0)),
    y: clamp(start.y + dy, 0, Math.max(surface.h - start.h, 0)),
    w: start.w,
    h: start.h,
  };
}

/**
 * Resize from the SE corner by the pointer delta: position fixed, size
 * clamped to [minPx, the surface edge].
 *
 * THE SURFACE EDGE WINS OVER THE MINIMUM. A projector swap can leave a card
 * narrower than its own minimum right against the right edge; the old rule
 * (`max(surface.w - x, minPx.w)`) then let the FIRST pixel of a resize snap
 * it out past the edge, `.surface` clipped it, and the next boot's
 * `clamp_rect` teleported it ~200 px back — promise 2 broken, silently.
 *
 * So the invariant this owes the rest of the app is not the minimum: it is
 * that the committed rect is a FIXPOINT for `clamp_rect`, i.e.
 * `x + w <= surface.w` and `y + h <= surface.h`. Where there is room for the
 * minimum it still applies, which is every ordinary resize.
 */
export function resizeSE(
  start: PxRect,
  dx: number,
  dy: number,
  minPx: Size,
  surface: Size,
): PxRect {
  const maxW = Math.max(surface.w - start.x, 0);
  const maxH = Math.max(surface.h - start.y, 0);
  return {
    x: start.x,
    y: start.y,
    w: clamp(start.w + dx, Math.min(minPx.w, maxW), maxW),
    h: clamp(start.h + dy, Math.min(minPx.h, maxH), maxH),
  };
}

/**
 * Snap a dragged rect's edges and centre to the surface's edges and centre
 * and to every sibling's edges. First hit per axis wins (candidates are
 * ordered: surface edges, surface centre, then siblings); an axis that hits
 * nothing within [`SNAP_PX`] stays where the pointer put it.
 */
export function snapRect(
  rect: PxRect,
  siblings: PxRect[],
  surface: Size,
  threshold: number = SNAP_PX,
): SnapResult {
  const vCandidates: number[] = [
    0,
    surface.w / 2,
    surface.w,
    ...siblings.flatMap((s) => [s.x, s.x + s.w]),
  ];
  const hCandidates: number[] = [
    0,
    surface.h / 2,
    surface.h,
    ...siblings.flatMap((s) => [s.y, s.y + s.h]),
  ];

  let x = rect.x;
  const guidesV: number[] = [];
  outerV: for (const edge of [
    (c: number) => c, // left edge lands on c
    (c: number) => c - rect.w / 2, // centre lands on c
    (c: number) => c - rect.w, // right edge lands on c
  ]) {
    for (const c of vCandidates) {
      const candidate = edge(c);
      if (Math.abs(rect.x - candidate) <= threshold) {
        x = candidate;
        guidesV.push(c);
        break outerV;
      }
    }
  }

  let y = rect.y;
  const guidesH: number[] = [];
  outerH: for (const edge of [
    (c: number) => c,
    (c: number) => c - rect.h / 2,
    (c: number) => c - rect.h,
  ]) {
    for (const c of hCandidates) {
      const candidate = edge(c);
      if (Math.abs(rect.y - candidate) <= threshold) {
        y = candidate;
        guidesH.push(c);
        break outerH;
      }
    }
  }

  return { rect: { x, y, w: rect.w, h: rect.h }, guidesV, guidesH };
}

/**
 * Snap a RESIZING rect: the right and bottom EDGES are pulled onto the same
 * candidate lines `snapRect` uses (surface edges and centre, every sibling's
 * edges), so a card lines up with its neighbour while it is being scaled
 * exactly as it does while it is being moved — and the guides come free.
 *
 * No centre variant: `c - w/2` means "move the box so its centre lands on
 * c", which is a MOVE. Here the position is fixed and only the size changes,
 * so the only meaningful question is where the far edge lands.
 *
 * The re-clamp at the end is load-bearing: a sibling edge 6 px inside the
 * minimum would otherwise let a snap pull the card under `minSizePx`, past
 * a floor `resizeSE` had just enforced. Same "the surface edge wins over the
 * minimum" rule as `resizeSE`, for the same reason.
 */
export function snapResize(
  rect: PxRect,
  siblings: PxRect[],
  surface: Size,
  minPx: Size,
  threshold: number = SNAP_PX,
): SnapResult {
  const vCandidates: number[] = [
    0,
    surface.w / 2,
    surface.w,
    ...siblings.flatMap((s) => [s.x, s.x + s.w]),
  ];
  const hCandidates: number[] = [
    0,
    surface.h / 2,
    surface.h,
    ...siblings.flatMap((s) => [s.y, s.y + s.h]),
  ];

  let w = rect.w;
  const guidesV: number[] = [];
  for (const c of vCandidates) {
    if (Math.abs(rect.x + rect.w - c) <= threshold) {
      w = c - rect.x;
      guidesV.push(c);
      break;
    }
  }

  let h = rect.h;
  const guidesH: number[] = [];
  for (const c of hCandidates) {
    if (Math.abs(rect.y + rect.h - c) <= threshold) {
      h = c - rect.y;
      guidesH.push(c);
      break;
    }
  }

  const maxW = Math.max(surface.w - rect.x, 0);
  const maxH = Math.max(surface.h - rect.y, 0);
  const clampedW = clamp(w, Math.min(minPx.w, maxW), maxW);
  const clampedH = clamp(h, Math.min(minPx.h, maxH), maxH);
  // A guide is a PROMISE about where the edge landed. If the clamp overrode
  // the snap, the edge is not on that line — drawing it anyway would be a
  // gold line through empty space.
  if (clampedW !== w) guidesV.length = 0;
  if (clampedH !== h) guidesH.length = 0;

  return {
    rect: { x: rect.x, y: rect.y, w: clampedW, h: clampedH },
    guidesV,
    guidesH,
  };
}

/** Whether a press has travelled far enough to be a drag. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

// ── The keyboard's half of the same layer ───────────────────────────────────
//
// A teacher without a mouse — RSI, a switch, a dead battery in the middle of
// a lesson — could add, copy, delete and enlarge a card but never PLACE one,
// and the «Endre størrelse» button was focusable, announced, and inert
// (WCAG 2.1.1). The keys reuse `dragMove`/`resizeSE` rather than growing a
// second set of clamps: one arrow press is one pointer delta, so the surface
// edge, the pixel minimum and the `clamp_rect` fixpoint are inherited whole.
//
// NO SNAPPING here, and that is a decision rather than an omission. A nudge is
// an EXACT amount the teacher asked for; a snap that swallows it makes the key
// look broken, and the guides it draws belong to a gesture that is still in
// the hand. Snapping stays what the pointer does.

/**
 * How far one arrow press travels, as a fraction of the surface's OWN axis.
 *
 * A fraction rather than a pixel count because the coordinates are normalised
 * (ADR: 0..1 per axis): the same press has to mean the same thing on a
 * 1024×768 projector and on a 4K panel, and «6 px» does not. One percent is
 * ~13 px on an ordinary board — fine enough to line two cards up by eye, and
 * a hundred presses from edge to edge, which is what [`NUDGE_COARSE_FACTOR`]
 * is for.
 */
export const NUDGE_FRACTION = 0.01;

/** Shift's multiplier: ten presses cross the board instead of a hundred.
 *  Shift means A BIGGER STEP and never «resize» — scaling is what the arrows
 *  do while the resize handle has the keyboard, so the modifier is free to
 *  mean the one thing a modifier on a movement key normally means. */
export const NUDGE_COARSE_FACTOR = 10;

/** Which way an arrow key points, in unit steps — `null` for every other key,
 *  which is what lets the DOM half be a single `if`. */
export function arrowDirection(key: string): { x: number; y: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return null;
  }
}

/** The px step one press takes on `surface`, per axis. */
export function nudgeStep(surface: Size, coarse: boolean): Size {
  const f = NUDGE_FRACTION * (coarse ? NUDGE_COARSE_FACTOR : 1);
  return { w: surface.w * f, h: surface.h * f };
}

/** Move `rect` by one arrow press, kept fully on the surface. `null` when the
 *  key is not an arrow. */
export function nudgeMove(
  rect: PxRect,
  key: string,
  surface: Size,
  coarse: boolean,
): PxRect | null {
  const dir = arrowDirection(key);
  if (!dir) return null;
  const step = nudgeStep(surface, coarse);
  return dragMove(rect, dir.x * step.w, dir.y * step.h, surface);
}

/** Scale `rect` from the SE corner by one arrow press: left/up shrink,
 *  right/down grow — the same corner the pointer drags, so the two gestures
 *  cannot disagree about which edges move. `null` for a non-arrow key. */
export function nudgeResize(
  rect: PxRect,
  key: string,
  minPx: Size,
  surface: Size,
  coarse: boolean,
): PxRect | null {
  const dir = arrowDirection(key);
  if (!dir) return null;
  const step = nudgeStep(surface, coarse);
  return resizeSE(rect, dir.x * step.w, dir.y * step.h, minPx, surface);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
