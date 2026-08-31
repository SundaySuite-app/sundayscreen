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
 *  add menu, then the class menu, then the manage panel, then the enlarged
 *  widget, then fullscreen — one layer per press, innermost first.
 *
 *  «widgetoverlay» is OUTERMOST-first, above even the add menu, because it is
 *  the only layer that can be open over any of the others: it belongs to a
 *  card, and a card can be enlarged, so the die's appearance panel may be
 *  floating over «Vis stort» on the projector (it rides at `--z-popover`,
 *  which clears both the focus scrim and the toolbar). Anywhere lower in this
 *  chain, the first Escape would have taken away the big card underneath it
 *  and left the panel standing.
 *
 *  «focus» sits between the overlays and fullscreen, not innermost. A menu or
 *  a panel is drawn ON TOP of an enlarged card, so an inner focus rung would
 *  shrink the card back while the thing the teacher was actually dismissing
 *  stayed on the board — the mirror image of the missing-overlay bug that put
 *  `overlayOpen` in this chain in the first place. */
export type EscapeLayer =
  | "widgetoverlay"
  | "addmenu"
  | "menu"
  | "overlay"
  | "focus"
  | "fullscreen"
  | null;

export function escapeTarget(state: {
  widgetOverlayOpen: boolean;
  addMenuOpen: boolean;
  menuOpen: boolean;
  overlayOpen: boolean;
  focused: boolean;
  fullscreen: boolean;
}): EscapeLayer {
  if (state.widgetOverlayOpen) return "widgetoverlay";
  if (state.addMenuOpen) return "addmenu";
  if (state.menuOpen) return "menu";
  if (state.overlayOpen) return "overlay";
  if (state.focused) return "focus";
  if (state.fullscreen) return "fullscreen";
  return null;
}
