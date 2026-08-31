// The chrome's live state: the auto-hiding toolbar and the fullscreen flag.
// Decisions live in screen/chrome-core.ts; this is the thin signal/listener
// half.

import { computed, signal } from "@preact/signals";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isTauri } from "@lib/api-shim";
import { inRevealZone, shouldHide } from "../screen/chrome-core";
import type { WindowState } from "../bindings/WindowState";
import { settings } from "./settings";
// One direction only: the panel/menu signals live in their own modules and
// this one reads them — exactly how `managePanelOpen` is wired, and what
// keeps `chrome ⇄ attendance` from becoming an import cycle.
import { attendancePanelOpen } from "./attendance";
import { classMenuOpen, managePanelOpen } from "./classes";
import { widgets } from "./layout";
import { sceneMenuOpen } from "./scenes";
import { plannerPanelOpen } from "./planner";

export const chromeVisible = signal(true);
export const fullscreen = signal(false);

/** The add-widget popover on the toolbar (AddMenu.tsx). */
export const addMenuOpen = signal(false);

/**
 * Is any panel or menu open? ONE list, because it is read from two places
 * that must never disagree: the idle ticker (which may not hide the chrome
 * out from under an open panel) and Shell's reveal handle (which may not
 * appear ON TOP of one). Shell's copy had already drifted — it knew about
 * the manage panel and the class menu but not the planner, the screen
 * library, the add menu or attendance. Read it with `.peek()` where you must
 * not subscribe, `.value` where you must.
 */
export const anyOverlayOpen = computed(
  () =>
    managePanelOpen.value ||
    attendancePanelOpen.value ||
    classMenuOpen.value ||
    sceneMenuOpen.value ||
    plannerPanelOpen.value ||
    addMenuOpen.value,
);

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
    // An EMPTY board holds the chrome open. Four seconds after the splash a
    // first-time teacher was left with a wordless rectangle and the only way
    // forward slid off the bottom of the screen — and so was anyone building
    // their fifth screen, because every new screen starts empty. This is the
    // DOM half's call: `shouldHide`/`CHROME_HIDE_MS` in chrome-core stay pure
    // and table-tested. It also covers deleting the LAST widget mid-lesson,
    // which "don't start the idle clock until the first input" would not.
    const holdOpen = widgets.peek().length === 0 || anyOverlayOpen.peek();
    if (
      chromeVisible.peek() &&
      shouldHide(lastActivityMs, Date.now(), holdOpen)
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
    const win = baseline ?? settings.peek().window;
    if (win) {
      // The window column ALONE (R4-spor 3.3): the blob this used to write
      // was read before the geometry capture and the toggle above, so F11
      // could hand back a language or an update channel the teacher had
      // changed in between. Adopt the CLAMPED answer, so the signal says what
      // the disk says.
      const stored = await window.api.settingsSetWindow({
        ...win,
        fullscreen: next,
      });
      settings.value = { ...settings.peek(), window: stored };
    }
  } catch (e) {
    // The window state itself is correct — only the persistence failed.
    console.warn("[chrome] persisting the fullscreen flag failed", e);
  }
}
