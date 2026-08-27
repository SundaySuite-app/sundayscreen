import { describe, expect, it } from "vitest";

import { fromNorm, placeNew, toNorm } from "./coords-core";

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
  it("the first widget lands centred", () => {
    const r = placeNew(0, { w: 480, h: 270 }, SURFACE);
    expect(r.x).toBeCloseTo((1 - r.w) / 2);
    expect(r.y).toBeCloseTo((1 - r.h) / 2);
  });

  it("each later widget cascades so cards stay visible", () => {
    const a = placeNew(0, { w: 480, h: 270 }, SURFACE);
    const b = placeNew(1, { w: 480, h: 270 }, SURFACE);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it("never places outside the surface, however many exist", () => {
    for (let i = 0; i < 40; i++) {
      const r = placeNew(i, { w: 800, h: 600 }, SURFACE);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("a wanted size larger than the surface is capped, not overflowing", () => {
    const r = placeNew(0, { w: 5000, h: 5000 }, SURFACE);
    expect(r.w).toBeLessThanOrEqual(0.9);
    expect(r.h).toBeLessThanOrEqual(0.9);
  });

  it("an unmeasured surface gets a sane normalised default", () => {
    const r = placeNew(3, { w: 480, h: 270 }, { w: 0, h: 0 });
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });
});
