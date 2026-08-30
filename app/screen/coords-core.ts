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
 * The surface the registry's `defaultSizePx` numbers were tuned against:
 * commit e6d68a3 sized every widget from 1280×800 screenshots. Nothing
 * declared it, so those pixel counts silently meant "34 % of the wall" on
 * the machine they were picked on and "23 % of the wall" on a 1080p
 * projector. Declaring the reference is what lets `placeNew` scale them.
 */
export const REFERENCE_SURFACE = { w: 1280, h: 800 };

/**
 * How much bigger this surface is than the one the defaults were tuned on.
 *
 * ONE shared scalar, deliberately — not a fraction per axis. Independent
 * fractions would turn the 300×300 clock into 450×405 on 16:9: the SHAPE
 * goes, and a square widget stops being square. With `min()` the clock stays
 * square, and every card keeps the same proportion of the wall it had on the
 * reference screen.
 */
function surfaceScale(surface: Size): number {
  return Math.min(
    surface.w / REFERENCE_SURFACE.w,
    surface.h / REFERENCE_SURFACE.h,
  );
}

/**
 * Where a NEW widget lands: the first FREE spot, scanned in reading order,
 * at a size scaled to the surface it is landing on.
 *
 * The old rule was "centre, plus 32 px per existing widget", which is fine
 * for two cards and a pile for six — the teacher had to drag every widget
 * out of the stack before the board was usable. Now the surface is scanned
 * on a coarse grid and the first candidate that overlaps nothing wins;
 * only when genuinely nothing fits do we fall back to the old cascade (a
 * full board should still accept one more card rather than refuse).
 *
 * `minPx` is the kind's own minimum from the registry: it is the FLOOR, so
 * no widget is ever born smaller than the interaction layer would let the
 * teacher drag it to. (Capped by the 0.9 ceiling, which keeps the card on
 * the surface whatever a registry entry claims.)
 *
 * Pure function of (existing rects, wanted px size, minimum px size,
 * surface).
 */
export function placeNew(
  existing: readonly NormRect[],
  wantedPx: Size,
  minPx: Size,
  surface: Size,
): NormRect {
  if (surface.w <= 0 || surface.h <= 0) {
    // No measured surface yet — a sane normalised default.
    return { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
  }
  const k = surfaceScale(surface);
  const w = clamp(
    (wantedPx.w * k) / surface.w,
    Math.min(minPx.w / surface.w, 0.9),
    0.9,
  );
  const h = clamp(
    (wantedPx.h * k) / surface.h,
    Math.min(minPx.h / surface.h, 0.9),
    0.9,
  );

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

/** What the app itself calls "clear of the chrome": MIRRORS
 *  `--chrome-clearance: 84px` in app/styles/tokens.css, which is the same
 *  measurement (the snackbar sits on it). A pure module cannot read a CSS
 *  custom property, so the two are kept in step by hand — change one,
 *  change the other. */
const CHROME_CLEARANCE_PX = 84;

/** How much of the surface's bottom a NEW card must stay out of, in px: the
 *  clearance plus a little air, so a fresh widget does not land flush
 *  against the toolbar's top edge. */
const CHROME_BAND_PX = CHROME_CLEARANCE_PX + 12;

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

/** How far a duplicate sits from its original, in px. */
const DUPLICATE_OFFSET_PX = 32;

/**
 * Where a DUPLICATE lands: the original nudged 32 px down-right — or
 * UP-LEFT when the original is already against the far edge.
 *
 * The negative direction is the whole point. Plain clamping at the edge
 * would put the copy at exactly the original's coordinates, and a
 * «Dupliser» that visibly does nothing is worse than one that refuses:
 * the teacher clicks it again, and again.
 *
 * Not `placeNew` — that centres on a free spot at the kind's DEFAULT size,
 * which would throw away the size and position the teacher just chose.
 */
export function offsetRect(rect: NormRect, surface: Size): NormRect {
  if (surface.w <= 0 || surface.h <= 0) return rect;
  return {
    x: offsetAxis(rect.x, rect.w, DUPLICATE_OFFSET_PX / surface.w),
    y: offsetAxis(rect.y, rect.h, DUPLICATE_OFFSET_PX / surface.h),
    w: rect.w,
    h: rect.h,
  };
}

function offsetAxis(pos: number, size: number, step: number): number {
  const max = Math.max(1 - size, 0);
  if (pos + step <= max) return pos + step;
  return Math.max(pos - step, 0);
}

/** Do two normalised rects share any area? Edge-touching does not count. */
export function overlaps(a: NormRect, b: NormRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

// ── Focus mode ──────────────────────────────────────────────────────────────

/** The air left around a focused card at the top and the sides. Deliberately
 *  thin: the whole point of «Vis stort» is the back row, and every pixel of
 *  margin is a pixel off the digits. The BOTTOM keeps `CHROME_CLEARANCE_PX`
 *  instead, so the toolbar and the snackbar still have their band. */
export const FOCUS_MARGIN_PX = 24;

/** The layer a focused card sits on: ONE above `--z-widget-active` (40) in
 *  app/styles/tokens.css, which is what the snap guides and the focus scrim
 *  use — mirrored by hand for the same reason `CHROME_CLEARANCE_PX` is.
 *  Never written to disk: focus is a VIEW, so `bringToFront` (which persists
 *  z) is deliberately not involved. */
export const FOCUS_Z = 41;

/**
 * The box a focused widget fills: the whole surface less a thin margin, and
 * less the chrome band at the bottom.
 *
 * The signature is `(surface)` ALONE — deliberately NOT aspect-preserving.
 * Honouring the card's own proportions would make «Vis stort» a no-op for
 * exactly the shapes that need it most: a 1728×130 text banner goes from
 * 34 px type to 37 px if its aspect is kept, and to 187 px if it is not.
 * Widgets whose CONTENT has a fixed shape solve that themselves (the traffic
 * light's housing carries its own `aspect-ratio`).
 *
 * On a surface too small for the full margins they shrink to fractions of
 * themselves rather than going negative, so the rect is always inside the
 * surface and always at least half of it. A zero-sized surface (pre-layout)
 * yields a zero rect rather than NaN.
 */
export function focusRect(surface: Size): PxRect {
  if (surface.w <= 0 || surface.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  // At most half of each axis may go to margins; past that they scale down
  // TOGETHER, so the inset keeps its shape instead of collapsing one edge.
  const kx = marginScale(FOCUS_MARGIN_PX * 2, surface.w);
  const ky = marginScale(FOCUS_MARGIN_PX + CHROME_CLEARANCE_PX, surface.h);
  const side = FOCUS_MARGIN_PX * kx;
  const top = FOCUS_MARGIN_PX * ky;
  const bottom = CHROME_CLEARANCE_PX * ky;
  return {
    x: side,
    y: top,
    w: surface.w - side * 2,
    h: surface.h - top - bottom,
  };
}

/** How much of a wanted margin budget fits along an axis while leaving the
 *  card at least half of it. */
function marginScale(wanted: number, available: number): number {
  const budget = available / 2;
  return wanted <= budget ? 1 : budget / wanted;
}

function clamp01(v: number, max: number): number {
  return Math.min(Math.max(v, 0), Math.max(max, 0));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
