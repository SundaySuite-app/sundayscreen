// The chrome's decisions — auto-hide timing, the reveal zone, and the
// layered Escape — pure and table-tested. The thin DOM half is
// `app/state/chrome.ts` and `app/screen/keyboard.ts`.

/** How long without activity before the toolbar slips away. */
export const CHROME_HIDE_MS = 4000;

/** The bottom fraction of the surface that wakes the chrome on pointer
 *  movement — generous, so "reach for the toolbar" IS the gesture. */
export const REVEAL_ZONE_FRACTION = 0.1;

/** Is a pointer at `y` inside the reveal zone of a surface `height` tall? */
export function inRevealZone(y: number, height: number): boolean {
  if (height <= 0) return false;
  return y >= height * (1 - REVEAL_ZONE_FRACTION);
}

/**
 * Should the chrome hide now? `pinned` is true while something chrome-owned
 * is open (the class menu, the manage panel) — an open menu must never have
 * its anchor slide out from under it.
 */
export function shouldHide(
  lastActivityMs: number,
  nowMs: number,
  pinned: boolean,
): boolean {
  if (pinned) return false;
  return nowMs - lastActivityMs >= CHROME_HIDE_MS;
}

/** What one Escape press closes, in order: a widget's own popover, then the
 *  add menu, then the class menu, then the design session, then the manage
 *  panel, then the enlarged widget, then fullscreen — one layer per press,
 *  innermost first. INSIDE a design session the last two swap places; see the
 *  «focus» paragraph at the bottom of this note.
 *
 *  «widgetoverlay» is OUTERMOST-first, above even the add menu, because it is
 *  the only layer that can be open over any of the others: it belongs to a
 *  card, and a card can be enlarged, so the die's appearance panel may be
 *  floating over «Vis stort» on the projector (it rides at `--z-popover`,
 *  which clears both the focus scrim and the toolbar). Anywhere lower in this
 *  chain, the first Escape would have taken away the big card underneath it
 *  and left the panel standing.
 *
 *  «design» sits between the menus and «overlay», and that position is the
 *  whole decision (Runde 6). The design session lives INSIDE the planner
 *  panel — the panel is the `overlayOpen` rung — and it borrows the board's
 *  globals while it runs. So:
 *
 *    - ABOVE «overlay», because Escape has to mean «leave the session, stay
 *      in the panel». Below it, the first press would close the panel and the
 *      session would be torn down by `closePlanner` on the way out: one press
 *      would have undone two layers, and the teacher who pressed it to get
 *      out of a screen she was editing would be back at the week grid — or,
 *      worse, at the board.
 *    - BELOW «widgetoverlay» and «addmenu», because both of those are things
 *      the teacher opened INSIDE the design panel (the panel reuses
 *      `addMenuOpen`, and a card on the little board has the same popover it
 *      has on the wall). Peeling the session first would take the panel's
 *      board away from under a menu that was still standing.
 *
 *  «focus» sits between the overlays and fullscreen, not innermost. A menu or
 *  a panel is drawn ON TOP of an enlarged card, so an inner focus rung would
 *  shrink the card back while the thing the teacher was actually dismissing
 *  stayed on the board — the mirror image of the missing-overlay bug that put
 *  `overlayOpen` in this chain in the first place.
 *
 *  …with ONE exception, and it is the design session (R6-F3). «Vis stort» on
 *  the wall enlarges a card that the panel is drawn over, which is the case
 *  the paragraph above describes. Inside a session the layering is the other
 *  way round: the enlarged card belongs to the panel's own little board and is
 *  drawn INSIDE it, over the session — so with both open the innermost thing
 *  on screen is the big card. Answering «design» there peels two layers at
 *  once: the card shrinks back AND the session ends, and the teacher who
 *  pressed Escape to put one card down is back at the week grid. Hence the
 *  swap below: while `designOpen`, focus outranks design. On the wall
 *  (`designOpen` false) the order is untouched. */
export type EscapeLayer =
  | "widgetoverlay"
  | "addmenu"
  | "menu"
  | "design"
  | "overlay"
  | "focus"
  | "fullscreen"
  | null;

export function escapeTarget(state: {
  widgetOverlayOpen: boolean;
  addMenuOpen: boolean;
  menuOpen: boolean;
  /** Is the planner BORROWING the board right now? (state/design-session.ts) */
  designOpen: boolean;
  overlayOpen: boolean;
  focused: boolean;
  fullscreen: boolean;
}): EscapeLayer {
  if (state.widgetOverlayOpen) return "widgetoverlay";
  if (state.addMenuOpen) return "addmenu";
  if (state.menuOpen) return "menu";
  // The enlarged card is INSIDE the session's board here, not under the panel
  // the way it is on the wall — so it is the inner layer and goes first.
  if (state.designOpen && state.focused) return "focus";
  if (state.designOpen) return "design";
  if (state.overlayOpen) return "overlay";
  if (state.focused) return "focus";
  if (state.fullscreen) return "fullscreen";
  return null;
}
