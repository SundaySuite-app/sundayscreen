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

/** Resize from the SE corner by the pointer delta: position fixed, size
 *  clamped to [minPx, the surface edge]. */
export function resizeSE(
  start: PxRect,
  dx: number,
  dy: number,
  minPx: Size,
  surface: Size,
): PxRect {
  return {
    x: start.x,
    y: start.y,
    w: clamp(start.w + dx, minPx.w, Math.max(surface.w - start.x, minPx.w)),
    h: clamp(start.h + dy, minPx.h, Math.max(surface.h - start.y, minPx.h)),
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

/** Whether a press has travelled far enough to be a drag. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
