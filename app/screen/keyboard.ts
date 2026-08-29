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
    if (e.key === "F11") {
      e.preventDefault();
      chromeActivity();
      void toggleFullscreen();
      return;
    }
    if (e.key !== "Escape") return;

    // A focused text field owns its own Escape: leave editing first.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === "TEXTAREA" || active.tagName === "INPUT")
    ) {
      active.blur();
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
