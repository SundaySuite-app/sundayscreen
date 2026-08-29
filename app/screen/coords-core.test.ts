import { describe, expect, it } from "vitest";

import {
  REFERENCE_SURFACE,
  fromNorm,
  offsetRect,
  overlaps,
  placeNew,
  toNorm,
} from "./coords-core";

const SURFACE = { w: 1920, h: 1080 };

describe("fromNorm/toNorm", () => {
  it("round-trips through both conversions", () => {
    const rect = { x: 0.25, y: 0.1, w: 0.5, h: 0.3 };
    expect(toNorm(fromNorm(rect, SURFACE), SURFACE)).toEqual(rect);
  });

  it("x/w scale against width and y/h against height — not one shared scale", () => {
    const px = fromNorm({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, SURFACE);
    expect(px).toEqual({ x: 960, y: 540, w: 960, h: 540 });
  });

  it("a zero-sized surface yields a zero rect, never NaN", () => {
    const n = toNorm({ x: 100, y: 100, w: 50, h: 50 }, { w: 0, h: 0 });
    expect(n).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("placeNew", () => {
  const SIZE = { w: 480, h: 270 };
  const MIN = { w: 200, h: 120 };
  // Six of the standard card fill a 1080p board once the sizes scale with
  // the wall (that IS the trade in 5.4), so the no-pile journeys below use a
  // smaller card. The scan is what is under test, not the scale.
  const SMALL = { w: 300, h: 200 };

  it("the first widget lands top-left, not dead centre", () => {
    // Reading order: the board fills the way a page does.
    const r = placeNew([], SIZE, MIN, SURFACE);
    expect(r.x).toBeLessThan(0.1);
    expect(r.y).toBeLessThan(0.1);
  });

  it("a second widget never overlaps the first", () => {
    const a = placeNew([], SIZE, MIN, SURFACE);
    const b = placeNew([a], SIZE, MIN, SURFACE);
    expect(overlaps(a, b)).toBe(false);
  });

  it("six widgets land as six separate cards — no pile", () => {
    // The old cascade put every card on top of the last one, and the
    // teacher had to drag all six apart before the board was usable.
    const placed: ReturnType<typeof placeNew>[] = [];
    for (let i = 0; i < 6; i++)
      placed.push(placeNew(placed, SMALL, MIN, SURFACE));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j]), `${i} vs ${j}`).toBe(false);
      }
    }
  });

  it("keeps clear of the toolbar band at the bottom", () => {
    const placed: ReturnType<typeof placeNew>[] = [];
    for (let i = 0; i < 6; i++)
      placed.push(placeNew(placed, SMALL, MIN, SURFACE));
    const chromeTop = 1 - 96 / SURFACE.h;
    for (const r of placed) {
      expect(r.y + r.h).toBeLessThanOrEqual(chromeTop + 0.0001);
    }
  });

  it("a full board still accepts one more card (cascade fallback)", () => {
    // Cover the surface, then ask for one more: it must land somewhere on
    // the surface rather than nowhere.
    const wall = [{ x: 0, y: 0, w: 1, h: 1 }];
    const r = placeNew(wall, SIZE, MIN, SURFACE);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
    expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
  });

  it("never places outside the surface, however many exist", () => {
    const placed: ReturnType<typeof placeNew>[] = [];
    for (let i = 0; i < 40; i++) {
      const r = placeNew(placed, { w: 800, h: 600 }, MIN, SURFACE);
      placed.push(r);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("a wanted size larger than the surface is capped, not overflowing", () => {
    const r = placeNew([], { w: 5000, h: 5000 }, MIN, SURFACE);
    expect(r.w).toBeLessThanOrEqual(0.9);
    expect(r.h).toBeLessThanOrEqual(0.9);
  });

  it("an unmeasured surface gets a sane normalised default", () => {
    const r = placeNew([], SIZE, MIN, { w: 0, h: 0 });
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });

  // ── The defaults scale with the wall (5.4) ───────────────────────────────

  it("on the reference surface the registry's px are taken literally", () => {
    const r = placeNew([], SIZE, MIN, REFERENCE_SURFACE);
    expect(r.w).toBeCloseTo(SIZE.w / REFERENCE_SURFACE.w, 6);
    expect(r.h).toBeCloseTo(SIZE.h / REFERENCE_SURFACE.h, 6);
  });

  it("a card keeps the same SHAPE on a wider screen — one shared scalar", () => {
    // The clock is square in the registry. Independent per-axis fractions
    // would make it 450×405 on 16:9; a shared k keeps it square.
    const square = { w: 300, h: 300 };
    const r = placeNew([], square, { w: 200, h: 190 }, SURFACE);
    const px = fromNorm(r, SURFACE);
    expect(px.w).toBeCloseTo(px.h, 6);
    // k = min(1920/1280, 1080/800) = 1.35 → 405 px.
    expect(px.w).toBeCloseTo(405, 6);
  });

  it("the same proportion of the wall on 1080p and on 1024×768", () => {
    const timer = { w: 440, h: 280 };
    const min = { w: 260, h: 180 };
    const big = placeNew([], timer, min, SURFACE);
    const small = placeNew([], timer, min, { w: 1024, h: 768 });
    expect(fromNorm(big, SURFACE).w).toBeCloseTo(594, 6);
    expect(fromNorm(big, SURFACE).h).toBeCloseTo(378, 6);
    // k = min(0.8, 0.96) = 0.8.
    expect(fromNorm(small, { w: 1024, h: 768 }).w).toBeCloseTo(352, 6);
    expect(fromNorm(small, { w: 1024, h: 768 }).h).toBeCloseTo(224, 6);
  });

  it("no widget is BORN smaller than the teacher could drag it to", () => {
    // A tiny projector shrinks everything; the kind's own minimum is the
    // floor, or the card would appear at a size `useDrag` refuses.
    const surface = { w: 640, h: 400 };
    const r = placeNew([], { w: 300, h: 240 }, { w: 260, h: 190 }, surface);
    const px = fromNorm(r, surface);
    expect(px.w).toBeGreaterThanOrEqual(260 - 1e-6);
    expect(px.h).toBeGreaterThanOrEqual(190 - 1e-6);
  });

  it("the 0.9 ceiling survives an absurd minimum", () => {
    const r = placeNew([], { w: 100, h: 100 }, { w: 9000, h: 9000 }, SURFACE);
    expect(r.w).toBeLessThanOrEqual(0.9);
    expect(r.h).toBeLessThanOrEqual(0.9);
  });
});

describe("offsetRect", () => {
  it("nudges the copy down-right by 32 px", () => {
    const r = offsetRect({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, SURFACE);
    const px = fromNorm(r, SURFACE);
    expect(px.x).toBeCloseTo(0.1 * SURFACE.w + 32, 6);
    expect(px.y).toBeCloseTo(0.1 * SURFACE.h + 32, 6);
  });

  it("keeps the size — a duplicate is not a new default-sized card", () => {
    const src = { x: 0.1, y: 0.1, w: 0.42, h: 0.37 };
    const r = offsetRect(src, SURFACE);
    expect(r.w).toBe(src.w);
    expect(r.h).toBe(src.h);
  });

  it("goes the OTHER way at the far edge, never exactly on top", () => {
    // Flush against the bottom-right: clamping would return the original's
    // own coordinates and the copy would be invisible.
    const src = { x: 0.7, y: 0.6, w: 0.3, h: 0.4 };
    const r = offsetRect(src, SURFACE);
    expect(r.x).toBeLessThan(src.x);
    expect(r.y).toBeLessThan(src.y);
    expect(overlaps(r, src)).toBe(true); // still overlapping, just not hidden
  });

  it("stays on the surface in both directions", () => {
    const cases = [
      { x: 0, y: 0, w: 0.3, h: 0.3 },
      { x: 0.7, y: 0.7, w: 0.3, h: 0.3 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
    for (const src of cases) {
      const r = offsetRect(src, SURFACE);
      const label = JSON.stringify(src);
      expect(r.x, label).toBeGreaterThanOrEqual(0);
      expect(r.y, label).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, label).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h, label).toBeLessThanOrEqual(1.0001);
    }
  });

  it("an unmeasured surface returns the rect untouched, never NaN", () => {
    const src = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    expect(offsetRect(src, { w: 0, h: 0 })).toEqual(src);
  });
});

describe("overlaps", () => {
  it("edge-touching rects do not overlap", () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const b = { x: 0.5, y: 0, w: 0.5, h: 0.5 };
    expect(overlaps(a, b)).toBe(false);
  });

  it("a shared corner pixel does overlap", () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const b = { x: 0.49, y: 0.49, w: 0.5, h: 0.5 };
    expect(overlaps(a, b)).toBe(true);
  });
});
