// The chrome's live state: the auto-hiding toolbar and the fullscreen flag.
// Decisions live in screen/chrome-core.ts; this is the thin signal/listener
// half.

import { signal } from "@preact/signals";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isTauri } from "@lib/api-shim";
import { inRevealZone, shouldHide } from "../screen/chrome-core";
import type { WindowState } from "../bindings/WindowState";
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

/** The current WINDOWED geometry, read live. `null` outside Tauri or on any
 *  read failure. Used to seed the persisted state the first time fullscreen
 *  is entered on a fresh install (F9-funn S#7/U#4). */
async function captureGeometry(): Promise<WindowState | null> {
  if (!isTauri()) return null;
  try {
    const win = getCurrentWebviewWindow();
    const factor = await win.scaleFactor();
    const pos = (await win.outerPosition()).toLogical(factor);
    const size = (await win.outerSize()).toLogical(factor);
    return {
      x: pos.x,
      y: pos.y,
      w: size.width,
      h: size.height,
      fullscreen: false,
    };
  } catch (e) {
    console.warn("[chrome] geometry capture failed", e);
    return null;
  }
}

/**
 * Flip fullscreen. The two operations have SEPARATE failure handling
 * (F9-funn U#3): the window toggle decides the signal — a failed settings
 * persist must never make the UI lie about what the window is doing, nor
 * trap F11 in a revert loop.
 */
export async function toggleFullscreen(): Promise<void> {
  const next = !fullscreen.peek();
  // Fresh install entering fullscreen: capture the windowed geometry
  // BEFORE the toggle, or there is nothing truthful to persist.
  let baseline = settings.peek().window;
  if (next && !baseline) baseline = await captureGeometry();

  try {
    await window.api.windowSetFullscreen(next);
  } catch (e) {
    console.warn("[chrome] fullscreen toggle failed", e);
    return;
  }
  fullscreen.value = next;

  try {
    const s = settings.peek();
    const win = baseline ?? s.window;
    if (win) {
      const withFlag = { ...s, window: { ...win, fullscreen: next } };
      settings.value = withFlag;
      await window.api.saveSettings(withFlag);
    }
  } catch (e) {
    // The window state itself is correct — only the persistence failed.
    console.warn("[chrome] persisting the fullscreen flag failed", e);
  }
}
