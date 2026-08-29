// Normalised-coordinate math — pure, table-tested.
//
// Widgets persist rects in 0..1 per AXIS (x,w against surface width; y,h
// against height), so a layout reflows proportionally across projector
// swaps, aspect changes and Windows-DPI changes. Pixels exist only at the
// render edge, through these two converters.

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Normalised → CSS px for the given surface size. */
export function fromNorm(rect: NormRect, surface: Size): PxRect {
  return {
    x: rect.x * surface.w,
    y: rect.y * surface.h,
    w: rect.w * surface.w,
    h: rect.h * surface.h,
  };
}

/** CSS px → normalised for the given surface size. A zero-sized surface
 *  (pre-layout) yields a zero rect rather than NaN — the caller should not
 *  persist anything measured against a surface that has no size yet. */
export function toNorm(rect: PxRect, surface: Size): NormRect {
  if (surface.w <= 0 || surface.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: rect.x / surface.w,
    y: rect.y / surface.h,
    w: rect.w / surface.w,
    h: rect.h / surface.h,
  };
}

/**
 * Where a NEW widget lands: the first FREE spot, scanned in reading order.
 *
 * The old rule was "centre, plus 32 px per existing widget", which is fine
 * for two cards and a pile for six — the teacher had to drag every widget
 * out of the stack before the board was usable. Now the surface is scanned
 * on a coarse grid and the first candidate that overlaps nothing wins;
 * only when genuinely nothing fits do we fall back to the old cascade (a
 * full board should still accept one more card rather than refuse).
 *
 * Pure function of (existing rects, wanted px size, surface).
 */
export function placeNew(
  existing: readonly NormRect[],
  wantedPx: Size,
  surface: Size,
): NormRect {
  if (surface.w <= 0 || surface.h <= 0) {
    // No measured surface yet — a sane normalised default.
    return { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
  }
  const w = Math.min(wantedPx.w / surface.w, 0.9);
  const h = Math.min(wantedPx.h / surface.h, 0.9);

  // A small margin keeps new cards off the very edge, and the bottom band
  // is where the toolbar lives — a card there is hidden behind chrome the
  // moment it appears.
  const margin = 16 / surface.w;
  const marginY = 16 / surface.h;
  const chrome = CHROME_BAND_PX / surface.h;

  const spot = firstFreeSpot(existing, w, h, {
    left: margin,
    top: marginY,
    right: 1 - margin,
    bottom: 1 - Math.max(marginY, chrome),
  });
  if (spot) return spot;

  // Full board: fall back to the cascade, so adding still does something.
  const stepX = 32 / surface.w;
  const stepY = 32 / surface.h;
  const offset = existing.length % 8;
  return {
    x: clamp01((1 - w) / 2 + offset * stepX, 1 - w),
    y: clamp01((1 - h) / 2 + offset * stepY, 1 - h),
    w,
    h,
  };
}

/** How much of the surface's bottom the toolbar occupies, in px. */
const CHROME_BAND_PX = 96;

/** How finely the free-spot scan steps across the surface. */
const SCAN_STEPS = 24;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function firstFreeSpot(
  existing: readonly NormRect[],
  w: number,
  h: number,
  bounds: Bounds,
): NormRect | null {
  const maxX = bounds.right - w;
  const maxY = bounds.bottom - h;
  if (maxX < bounds.left || maxY < bounds.top) return null;

  const stepX = (maxX - bounds.left) / SCAN_STEPS;
  const stepY = (maxY - bounds.top) / SCAN_STEPS;

  for (let row = 0; row <= SCAN_STEPS; row++) {
    const y = bounds.top + (stepY > 0 ? row * stepY : 0);
    for (let col = 0; col <= SCAN_STEPS; col++) {
      const x = bounds.left + (stepX > 0 ? col * stepX : 0);
      const candidate = { x, y, w, h };
      if (!existing.some((r) => overlaps(candidate, r))) return candidate;
      if (stepX <= 0) break;
    }
    if (stepY <= 0) break;
  }
  return null;
}

/** Do two normalised rects share any area? Edge-touching does not count. */
export function overlaps(a: NormRect, b: NormRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

function clamp01(v: number, max: number): number {
  return Math.min(Math.max(v, 0), Math.max(max, 0));
}
