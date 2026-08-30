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

/** What one Escape press closes, in order: the add menu, then the class
 *  menu, then the manage panel, then the enlarged widget, then fullscreen —
 *  one layer per press, innermost first.
 *
 *  «focus» sits between the overlays and fullscreen, not innermost. A menu or
 *  a panel is drawn ON TOP of an enlarged card, so an inner focus rung would
 *  shrink the card back while the thing the teacher was actually dismissing
 *  stayed on the board — the mirror image of the missing-overlay bug that put
 *  `overlayOpen` in this chain in the first place. */
export type EscapeLayer =
  "addmenu" | "menu" | "overlay" | "focus" | "fullscreen" | null;

export function escapeTarget(state: {
  addMenuOpen: boolean;
  menuOpen: boolean;
  overlayOpen: boolean;
  focused: boolean;
  fullscreen: boolean;
}): EscapeLayer {
  if (state.addMenuOpen) return "addmenu";
  if (state.menuOpen) return "menu";
  if (state.overlayOpen) return "overlay";
  if (state.focused) return "focus";
  if (state.fullscreen) return "fullscreen";
  return null;
}
