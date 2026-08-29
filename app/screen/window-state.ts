// Window-state persistence: the saved geometry is what lets the app come
// back on the projector exactly where the teacher left it. Saves are
// debounced off the move/resize events; fullscreen geometry is never stored
// (it would overwrite the windowed geometry with the monitor's).

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isTauri } from "@lib/api-shim";
import { fullscreen } from "../state/chrome";
import { settings } from "../state/settings";

const SAVE_DEBOUNCE_MS = 500;

async function saveGeometry(): Promise<void> {
  if (fullscreen.peek()) return;
  try {
    const win = getCurrentWebviewWindow();
    const factor = await win.scaleFactor();
    const pos = (await win.outerPosition()).toLogical(factor);
    const size = (await win.outerSize()).toLogical(factor);
    // Re-check AFTER the awaits (F9-funn S#5): an F11 during the reads
    // would otherwise persist the MONITOR rect as windowed geometry and
    // clobber the toggle's own save.
    if (fullscreen.peek()) return;
    const s = settings.peek();
    const next = {
      ...s,
      window: {
        x: pos.x,
        y: pos.y,
        w: size.width,
        h: size.height,
        fullscreen: false,
      },
    };
    settings.value = next;
    await window.api.saveSettings(next);
  } catch (e) {
    console.warn("[window-state] save failed", e);
  }
}

/**
 * MEASURE the fullscreen state instead of assuming it. The stored flag only
 * says what the app WANTED at the last quit: a restore can fail (the saved
 * geometry pointed at a monitor that is gone, `set_fullscreen` errored), and
 * then the two disagree. The direction that hurts is believing we ARE
 * fullscreen when we are not — `saveGeometry` returns early on the flag, so
 * one wrong `true` costs the window position for the WHOLE session.
 *
 * The backend answers, not `win.isFullscreen()`: on macOS the app uses
 * SIMPLE fullscreen, which that JS call reports as `false`.
 */
async function refreshFullscreen(): Promise<void> {
  fullscreen.value = await window.api.windowIsFullscreen();
}

/** Start following the window. No-op outside Tauri. */
export async function initWindowState(): Promise<void> {
  if (!isTauri()) return;
  await refreshFullscreen();

  const win = getCurrentWebviewWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    // Re-measure on every move/resize, BEFORE the debounced save decides:
    // fullscreen can be entered or left without passing through our own
    // toggle (the green button, the window manager's own shortcut), and
    // both of those arrive here as a resize.
    void refreshFullscreen();
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void saveGeometry(), SAVE_DEBOUNCE_MS);
  };
  await win.onMoved(schedule);
  await win.onResized(schedule);
}
