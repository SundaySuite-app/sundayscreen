// Window-state persistence: the saved geometry is what lets the app come
// back on the projector exactly where the teacher left it. Saves are
// debounced off the move/resize events; fullscreen geometry is never stored
// (it would overwrite the windowed geometry with the monitor's).

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

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

/** Start following the window. No-op outside Tauri. */
export async function initWindowState(): Promise<void> {
  if (!isTauri()) return;
  fullscreen.value = settings.peek().window?.fullscreen ?? false;

  const win = getCurrentWebviewWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void saveGeometry(), SAVE_DEBOUNCE_MS);
  };
  await win.onMoved(schedule);
  await win.onResized(schedule);
}
