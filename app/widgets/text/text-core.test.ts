import { describe, expect, it } from "vitest";

import {
  FONT_STOPS,
  clampFontScale,
  nearestStop,
  steppedScale,
} from "./text-core";

describe("clampFontScale", () => {
  it("mirrors the backend: non-finite is 1.0, the rest clamps to 0.25..6", () => {
    expect(clampFontScale(Number.POSITIVE_INFINITY)).toBe(1.0);
    expect(clampFontScale(Number.NaN)).toBe(1.0);
    expect(clampFontScale(99)).toBe(6.0);
    expect(clampFontScale(0.01)).toBe(0.25);
    expect(clampFontScale(1.3)).toBe(1.3);
  });
});

describe("steppedScale", () => {
  it("walks the stop list in both directions", () => {
    expect(steppedScale(1.0, 1)).toBe(1.3);
    expect(steppedScale(1.0, -1)).toBe(0.8);
  });

  it("WRITES NOTHING at either end", () => {
    expect(steppedScale(2.5, 1)).toBeNull();
    expect(steppedScale(0.6, -1)).toBeNull();
  });

  it("a value that is not on the list still moves — from its nearest stop", () => {
    // The bug this guards: `indexOf` on an off-list value returns −1, and
    // BOTH buttons go dead on a card an older build configured.
    expect(steppedScale(1.5, 1)).toBe(2.0); // nearest is 1.6
    expect(steppedScale(1.5, -1)).toBe(1.3);
    // 7.5 clamps to 6.0, whose nearest stop is the top one: A+ is spent,
    // A− steps DOWN into the list rather than doing nothing.
    expect(steppedScale(7.5, 1)).toBeNull();
    expect(steppedScale(7.5, -1)).toBe(2.0);
  });

  it("every stop the buttons can write survives the backend clamp", () => {
    for (const stop of FONT_STOPS) {
      expect(clampFontScale(stop)).toBe(stop);
    }
  });

  it("nearestStop keeps the lower stop on a tie", () => {
    expect(nearestStop(0.9)).toBe(0.8);
  });
});
