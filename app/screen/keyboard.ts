// Global keys: F11 toggles fullscreen, Escape peels ONE layer at a time
// (text field → class menu → manage panel → fullscreen). Installed once
// from main.tsx.

import { classMenuOpen, managePanelOpen } from "../state/classes";
import { addMenuOpen } from "../state/chrome";
import { sceneMenuOpen } from "../state/scenes";
import { plannerPanelOpen } from "../state/planner";
import { chromeActivity, fullscreen, toggleFullscreen } from "../state/chrome";
import { escapeTarget } from "./chrome-core";

export function installKeyboard(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // Keyboard use counts as presence (F-funn C10): the chrome must not
    // slide away under someone tabbing through it.
    chromeActivity();
    if (e.key === "F11") {
      e.preventDefault();
      chromeActivity();
      void toggleFullscreen();
      return;
    }
    if (e.key !== "Escape") return;

    // A focused text field owns its own Escape: leave editing first.
    const active = document.activeElement;
    // A checkbox/radio has nothing to "leave" — Escape there should close a
    // layer, not be swallowed (F-funn C17).
    const isTextField =
      active instanceof HTMLElement &&
      (active.tagName === "TEXTAREA" ||
        (active instanceof HTMLInputElement &&
          !["checkbox", "radio", "button", "submit"].includes(active.type)));
    if (isTextField) {
      (active as HTMLElement).blur();
      return;
    }

    switch (
      escapeTarget({
        addMenuOpen: addMenuOpen.peek(),
        menuOpen: classMenuOpen.peek() || sceneMenuOpen.peek(),
        overlayOpen: managePanelOpen.peek() || plannerPanelOpen.peek(),
        fullscreen: fullscreen.peek(),
      })
    ) {
      case "addmenu":
        addMenuOpen.value = false;
        break;
      case "menu":
        classMenuOpen.value = false;
        sceneMenuOpen.value = false;
        break;
      case "overlay":
        managePanelOpen.value = false;
        plannerPanelOpen.value = false;
        break;
      case "fullscreen":
        void toggleFullscreen();
        break;
      case null:
        break;
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
