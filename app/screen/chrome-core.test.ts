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
  const all = {
    addMenuOpen: true,
    menuOpen: true,
    overlayOpen: true,
    focused: true,
    fullscreen: true,
  };

  it("closes one layer per press, innermost first", () => {
    expect(escapeTarget(all)).toBe("addmenu");
    expect(escapeTarget({ ...all, addMenuOpen: false })).toBe("menu");
    expect(escapeTarget({ ...all, addMenuOpen: false, menuOpen: false })).toBe(
      "overlay",
    );
    expect(
      escapeTarget({
        ...all,
        addMenuOpen: false,
        menuOpen: false,
        overlayOpen: false,
      }),
    ).toBe("focus");
    expect(
      escapeTarget({
        ...all,
        addMenuOpen: false,
        menuOpen: false,
        overlayOpen: false,
        focused: false,
      }),
    ).toBe("fullscreen");
    expect(
      escapeTarget({
        addMenuOpen: false,
        menuOpen: false,
        overlayOpen: false,
        focused: false,
        fullscreen: false,
      }),
    ).toBeNull();
  });

  it("an enlarged card is dismissed AFTER any panel or menu over it", () => {
    // The rung order is the whole decision: a menu drawn on top of the big
    // card must go first, or Escape shrinks the card and leaves the menu.
    expect(escapeTarget({ ...all, addMenuOpen: false, menuOpen: false })).toBe(
      "overlay",
    );
    // …and it goes BEFORE fullscreen, so «Vis stort» never costs the
    // projector view.
    expect(
      escapeTarget({
        addMenuOpen: false,
        menuOpen: false,
        overlayOpen: false,
        focused: true,
        fullscreen: true,
      }),
    ).toBe("focus");
  });
});
