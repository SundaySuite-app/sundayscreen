import { describe, expect, it } from "vitest";

import {
  CHROME_HIDE_MS,
  escapeTarget,
  inRevealZone,
  shouldHide,
  type EscapeLayer,
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
    widgetOverlayOpen: true,
    addMenuOpen: true,
    menuOpen: true,
    designOpen: true,
    overlayOpen: true,
    focused: true,
    fullscreen: true,
  };
  /** Nothing open at all — the base every single-rung case is built from. */
  const none = {
    widgetOverlayOpen: false,
    addMenuOpen: false,
    menuOpen: false,
    designOpen: false,
    overlayOpen: false,
    focused: false,
    fullscreen: false,
  };

  it("closes one layer per press, innermost first", () => {
    expect(escapeTarget(all)).toBe("widgetoverlay");
    expect(escapeTarget({ ...all, widgetOverlayOpen: false })).toBe("addmenu");
    expect(
      escapeTarget({ ...all, widgetOverlayOpen: false, addMenuOpen: false }),
    ).toBe("menu");
    // `focused: false` here, and it is not tidying: with a card enlarged INSIDE
    // the session the two rungs swap places (R6-F3, asserted below). This line
    // is about where «design» sits among the menus and the panel.
    expect(
      escapeTarget({
        ...all,
        widgetOverlayOpen: false,
        addMenuOpen: false,
        menuOpen: false,
        focused: false,
      }),
    ).toBe("design");
    expect(
      escapeTarget({
        ...all,
        widgetOverlayOpen: false,
        addMenuOpen: false,
        menuOpen: false,
        designOpen: false,
      }),
    ).toBe("overlay");
    expect(
      escapeTarget({
        ...all,
        widgetOverlayOpen: false,
        addMenuOpen: false,
        menuOpen: false,
        designOpen: false,
        overlayOpen: false,
      }),
    ).toBe("focus");
    expect(
      escapeTarget({
        ...all,
        widgetOverlayOpen: false,
        addMenuOpen: false,
        menuOpen: false,
        designOpen: false,
        overlayOpen: false,
        focused: false,
      }),
    ).toBe("fullscreen");
    expect(escapeTarget(none)).toBeNull();
  });

  it("a widget's own popover is dismissed before anything else", () => {
    // It is the one layer that can float over every other: it belongs to a
    // card, the card can be enlarged, and it sits at --z-popover — above the
    // focus scrim AND the toolbar. A lower rung would take the big card away
    // from under the panel the teacher is looking at.
    expect(
      escapeTarget({ ...none, widgetOverlayOpen: true, focused: true }),
    ).toBe("widgetoverlay");
  });

  it("an enlarged card is dismissed AFTER any panel or menu over it", () => {
    // The rung order is the whole decision: a menu drawn on top of the big
    // card must go first, or Escape shrinks the card and leaves the menu.
    expect(
      escapeTarget({
        ...all,
        widgetOverlayOpen: false,
        addMenuOpen: false,
        menuOpen: false,
        designOpen: false,
      }),
    ).toBe("overlay");
    // …and it goes BEFORE fullscreen, so «Vis stort» never costs the
    // projector view.
    expect(escapeTarget({ ...none, focused: true, fullscreen: true })).toBe(
      "focus",
    );
  });

  // ── The design session's rung (Runde 6) ─────────────────────────────────
  //
  // The session lives INSIDE the planner panel and BORROWS the board's
  // globals while it runs, so its placement in this chain is not cosmetic:
  // one rung too low and a single Escape leaves the session AND the panel;
  // one rung too high and it pulls the little board out from under a menu
  // the teacher opened on top of it.

  it("leaves the design session and STAYS in the planner panel", () => {
    // The panel is `overlayOpen`, and it is open the whole time a session
    // runs. Escape must peel the session first, or one press undoes two
    // layers — and the teacher who pressed it to get out of a screen she was
    // editing ends up back at the week grid instead of at its board.
    expect(escapeTarget({ ...none, designOpen: true, overlayOpen: true })).toBe(
      "design",
    );
    // Second press, session gone: NOW the panel.
    expect(escapeTarget({ ...none, overlayOpen: true })).toBe("overlay");
  });

  it("closes what is open INSIDE the design panel before leaving it", () => {
    // Both of these belong to the session's own board: the panel reuses
    // `addMenuOpen` for «Legg til verktøy», and a card on the little board
    // has the same popover it has on the wall. Peeling the session first
    // would take the board away from under a menu still standing on it.
    expect(escapeTarget({ ...none, addMenuOpen: true, designOpen: true })).toBe(
      "addmenu",
    );
    expect(
      escapeTarget({ ...none, widgetOverlayOpen: true, designOpen: true }),
    ).toBe("widgetoverlay");
  });

  it("peels the enlarged card BEFORE the session it is drawn inside", () => {
    // R6-F3. «Vis stort» on a card on the little board draws the big card
    // INSIDE the panel, over the session — the opposite of the wall, where a
    // panel covers an enlarged card. Answering «design» here would peel two
    // layers with one press: the card shrinks back AND the session ends, and
    // the teacher who pressed Escape to put one card down lands on the week
    // grid. The rung order is contextual for exactly this reason.
    const inSession = {
      ...none,
      designOpen: true,
      overlayOpen: true,
      focused: true,
    };
    expect(escapeTarget(inSession)).toBe("focus");
    // Second press: NOW the session. Third: the panel. One layer each.
    expect(escapeTarget({ ...inSession, focused: false })).toBe("design");
    expect(
      escapeTarget({ ...inSession, focused: false, designOpen: false }),
    ).toBe("overlay");
  });

  it("the swap is the SESSION's, not the panel's", () => {
    // On the wall the panel still outranks the enlarged card: there the card
    // is under the panel, and shrinking it first would leave the panel
    // standing over a board that just changed under it.
    expect(escapeTarget({ ...none, overlayOpen: true, focused: true })).toBe(
      "overlay",
    );
    // And a session with no card enlarged is unaffected either way.
    expect(escapeTarget({ ...none, designOpen: true, overlayOpen: true })).toBe(
      "design",
    );
  });

  it("«peels ONE layer» holds for all 128 states", () => {
    // The contract the whole ladder exists for, asserted as a walk instead of
    // as prose — and the walk is what catches the F3 shape, where one press
    // took two rungs down. Two things must hold from EVERY state: the answer
    // names a layer that is actually open (never a rung nothing is standing
    // on), and pressing Escape until the answer is `null` takes exactly as
    // many presses as there are open layers.
    const flag: Record<Exclude<EscapeLayer, null>, keyof typeof none> = {
      widgetoverlay: "widgetOverlayOpen",
      addmenu: "addMenuOpen",
      menu: "menuOpen",
      design: "designOpen",
      overlay: "overlayOpen",
      focus: "focused",
      fullscreen: "fullscreen",
    };
    const keys = Object.keys(none) as (keyof typeof none)[];
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const start = { ...none };
      keys.forEach((k, i) => {
        start[k] = (mask & (1 << i)) !== 0;
      });
      const open = keys.filter((k) => start[k]).length;

      let state = start;
      let presses = 0;
      for (let layer = escapeTarget(state); layer !== null; presses++) {
        // The rung answered for is one the teacher can actually see.
        expect(state[flag[layer]]).toBe(true);
        state = { ...state, [flag[layer]]: false };
        layer = escapeTarget(state);
        // A runaway is a bug, not a hang.
        expect(presses).toBeLessThan(keys.length);
      }
      expect(presses).toBe(open);
    }
  });

  it("a session without a panel still answers for the press", () => {
    // Not a state the UI can reach today (the session is opened FROM the
    // panel), and asserted anyway: the rung must not be written as «design
    // only when a panel is under it». A session that answered `null` would
    // let Escape fall through to FULLSCREEN — the projector view gone while
    // the borrowed board stays on it.
    expect(escapeTarget({ ...none, designOpen: true, fullscreen: true })).toBe(
      "design",
    );
  });
});
