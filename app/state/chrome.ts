// The chrome's live state: the auto-hiding toolbar and the fullscreen flag.
// Decisions live in screen/chrome-core.ts; this is the thin signal/listener
// half.

import { signal } from "@preact/signals";

import { inRevealZone, shouldHide } from "../screen/chrome-core";
import { settings } from "./settings";
import { classMenuOpen, managePanelOpen } from "./classes";

export const chromeVisible = signal(true);
export const fullscreen = signal(false);

let lastActivityMs = Date.now();

/** Anything that counts as "the teacher is here": wake the chrome and
 *  restart the idle clock. */
export function chromeActivity(): void {
  lastActivityMs = Date.now();
  chromeVisible.value = true;
}

/** Install the pointer listener and the idle ticker. Returns a cleanup. */
export function initChrome(): () => void {
  const onPointerMove = (e: PointerEvent) => {
    if (inRevealZone(e.clientY, window.innerHeight)) chromeActivity();
  };
  window.addEventListener("pointermove", onPointerMove);

  const ticker = setInterval(() => {
    const pinned = managePanelOpen.peek() || classMenuOpen.peek();
    if (
      chromeVisible.peek() &&
      shouldHide(lastActivityMs, Date.now(), pinned)
    ) {
      chromeVisible.value = false;
    }
  }, 1000);

  return () => {
    window.removeEventListener("pointermove", onPointerMove);
    clearInterval(ticker);
  };
}

/** Flip fullscreen: optimistic signal, revert if the backend refuses (a
 *  plain browser has no window to manage). The flag is persisted with the
 *  window state so boot restores the projector setup. */
export async function toggleFullscreen(): Promise<void> {
  const next = !fullscreen.peek();
  fullscreen.value = next;
  try {
    await window.api.windowSetFullscreen(next);
    const s = settings.peek();
    if (s.window) {
      const withFlag = { ...s, window: { ...s.window, fullscreen: next } };
      settings.value = withFlag;
      await window.api.saveSettings(withFlag);
    }
  } catch (e) {
    console.warn("[chrome] fullscreen toggle failed", e);
    fullscreen.value = !next;
  }
}
