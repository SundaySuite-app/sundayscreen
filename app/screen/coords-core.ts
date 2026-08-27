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
 * Where a NEW widget lands: centred, with a small cascading offset per
 * existing widget so five clicks on "add" give five visible cards, not one
 * stack pretending to be one. Pure function of (count, wanted px size,
 * surface) — clamped so the cascade can never walk off the surface.
 */
export function placeNew(
  existingCount: number,
  wantedPx: Size,
  surface: Size,
): NormRect {
  if (surface.w <= 0 || surface.h <= 0) {
    // No measured surface yet — a sane normalised default.
    return { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
  }
  const w = Math.min(wantedPx.w / surface.w, 0.9);
  const h = Math.min(wantedPx.h / surface.h, 0.9);
  const stepX = 32 / surface.w;
  const stepY = 32 / surface.h;
  const offset = existingCount % 8;
  const x = clamp01((1 - w) / 2 + offset * stepX, 1 - w);
  const y = clamp01((1 - h) / 2 + offset * stepY, 1 - h);
  return { x, y, w, h };
}

function clamp01(v: number, max: number): number {
  return Math.min(Math.max(v, 0), Math.max(max, 0));
}
