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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
