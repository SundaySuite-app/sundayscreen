import { describe, expect, it } from "vitest";

import {
  CHROME_HIDE_MS,
  escapeTarget,
  inRevealZone,
  shouldHide,
} from "./chrome-core";

describe("inRevealZone", () => {
  it("the bottom tenth wakes the chrome, the rest does not", () => {
    expect(inRevealZone(719, 800)).toBe(false);
    expect(inRevealZone(720, 800)).toBe(true);
    expect(inRevealZone(800, 800)).toBe(true);
    expect(inRevealZone(100, 800)).toBe(false);
  });

  it("an unmeasured surface reveals nothing", () => {
    expect(inRevealZone(10, 0)).toBe(false);
  });
});

describe("shouldHide", () => {
  it("hides exactly at the idle threshold", () => {
    expect(shouldHide(1000, 1000 + CHROME_HIDE_MS - 1, false)).toBe(false);
    expect(shouldHide(1000, 1000 + CHROME_HIDE_MS, false)).toBe(true);
  });

  it("never hides while pinned — an open menu keeps its anchor", () => {
    expect(shouldHide(0, 999_999, true)).toBe(false);
  });
});

describe("escapeTarget", () => {
  it("closes one layer per press, innermost first", () => {
    expect(
      escapeTarget({ menuOpen: true, overlayOpen: true, fullscreen: true }),
    ).toBe("menu");
    expect(
      escapeTarget({ menuOpen: false, overlayOpen: true, fullscreen: true }),
    ).toBe("overlay");
    expect(
      escapeTarget({ menuOpen: false, overlayOpen: false, fullscreen: true }),
    ).toBe("fullscreen");
    expect(
      escapeTarget({ menuOpen: false, overlayOpen: false, fullscreen: false }),
    ).toBeNull();
  });
});
