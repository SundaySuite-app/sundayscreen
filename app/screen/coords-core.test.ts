import { describe, expect, it } from "vitest";

import { fromNorm, overlaps, placeNew, toNorm } from "./coords-core";

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

  it("the first widget lands top-left, not dead centre", () => {
    // Reading order: the board fills the way a page does.
    const r = placeNew([], SIZE, SURFACE);
    expect(r.x).toBeLessThan(0.1);
    expect(r.y).toBeLessThan(0.1);
  });

  it("a second widget never overlaps the first", () => {
    const a = placeNew([], SIZE, SURFACE);
    const b = placeNew([a], SIZE, SURFACE);
    expect(overlaps(a, b)).toBe(false);
  });

  it("six widgets land as six separate cards — no pile", () => {
    // The old cascade put every card on top of the last one, and the
    // teacher had to drag all six apart before the board was usable.
    const placed: ReturnType<typeof placeNew>[] = [];
    for (let i = 0; i < 6; i++) placed.push(placeNew(placed, SIZE, SURFACE));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j]), `${i} vs ${j}`).toBe(false);
      }
    }
  });

  it("keeps clear of the toolbar band at the bottom", () => {
    const placed: ReturnType<typeof placeNew>[] = [];
    for (let i = 0; i < 6; i++) placed.push(placeNew(placed, SIZE, SURFACE));
    const chromeTop = 1 - 96 / SURFACE.h;
    for (const r of placed) {
      expect(r.y + r.h).toBeLessThanOrEqual(chromeTop + 0.0001);
    }
  });

  it("a full board still accepts one more card (cascade fallback)", () => {
    // Cover the surface, then ask for one more: it must land somewhere on
    // the surface rather than nowhere.
    const wall = [{ x: 0, y: 0, w: 1, h: 1 }];
    const r = placeNew(wall, SIZE, SURFACE);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
    expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
  });

  it("never places outside the surface, however many exist", () => {
    const placed: ReturnType<typeof placeNew>[] = [];
    for (let i = 0; i < 40; i++) {
      const r = placeNew(placed, { w: 800, h: 600 }, SURFACE);
      placed.push(r);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("a wanted size larger than the surface is capped, not overflowing", () => {
    const r = placeNew([], { w: 5000, h: 5000 }, SURFACE);
    expect(r.w).toBeLessThanOrEqual(0.9);
    expect(r.h).toBeLessThanOrEqual(0.9);
  });

  it("an unmeasured surface gets a sane normalised default", () => {
    const r = placeNew([], SIZE, { w: 0, h: 0 });
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
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
