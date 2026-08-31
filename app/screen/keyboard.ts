// Global keys: F11 toggles fullscreen, Cmd/Ctrl+Z takes back the deletion the
// snackbar is offering, and Escape peels ONE layer at a time (text field → a
// widget's own popover → the add menu → class menu → an overlay panel → an
// enlarged widget → fullscreen). Installed once from main.tsx.

import { attendancePanelOpen } from "../state/attendance";
import { classMenuOpen, managePanelOpen } from "../state/classes";
import {
  activeWidgetOverlay,
  addMenuOpen,
  closeWidgetOverlay,
} from "../state/chrome";
import {
  clearFocus,
  focusedWidget,
  undoRemove,
  undoSlot,
} from "../state/layout";
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
    // A focused text field owns its own Escape — and its own Cmd/Ctrl+Z:
    // the browser's text undo belongs to the field, not to the board.
    const active = document.activeElement;
    // A checkbox/radio has nothing to "leave" — Escape there should close a
    // layer, not be swallowed (F-funn C17).
    const isTextField =
      active instanceof HTMLElement &&
      (active.tagName === "TEXTAREA" ||
        (active instanceof HTMLInputElement &&
          !["checkbox", "radio", "button", "submit"].includes(active.type)));

    // Cmd/Ctrl+Z puts back the widget the snackbar is offering — and ONLY
    // that. The `undoSlot` guard is the whole point: with nothing to take
    // back the binding is INERT, so it never promises an undo history the
    // app does not have. Lower-case "z" only, so Cmd+Shift+Z (redo) falls
    // through rather than un-deleting something.
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === "z" &&
      !isTextField &&
      undoSlot.peek()
    ) {
      e.preventDefault();
      undoRemove();
      return;
    }

    if (e.key !== "Escape") return;

    if (isTextField) {
      (active as HTMLElement).blur();
      return;
    }

    const layer = escapeTarget({
      // The CROSSED signal again, for the same reason as `focused` below: a
      // widget popover whose card left the board draws nothing, so it must
      // not answer for a press either.
      widgetOverlayOpen: activeWidgetOverlay.peek() !== null,
      addMenuOpen: addMenuOpen.peek(),
      menuOpen: classMenuOpen.peek() || sceneMenuOpen.peek(),
      // EVERY overlay belongs in here. An overlay the chain does not know
      // about reads as "nothing is open", and Escape then leaves
      // FULLSCREEN — the projector view goes away while the panel the
      // teacher meant to dismiss stays on the board.
      overlayOpen:
        managePanelOpen.peek() ||
        plannerPanelOpen.peek() ||
        attendancePanelOpen.peek(),
      // The CROSSED signal, not the raw id: a focus id left pointing at a
      // card that is no longer on the board would swallow this press and
      // do nothing visible — Escape would simply stop working once.
      focused: focusedWidget.peek() !== null,
      fullscreen: fullscreen.peek(),
    });
    switch (layer) {
      case "widgetoverlay":
        closeWidgetOverlay();
        break;
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
        attendancePanelOpen.value = false;
        break;
      case "focus":
        clearFocus();
        break;
      case "fullscreen":
        void toggleFullscreen();
        break;
      case null:
        break;
      default: {
        // A rung added to `escapeTarget` and FORGOTTEN here would make Escape
        // do nothing at all on that state — not even leave fullscreen — and
        // nothing would go red. This line is what turns that silence into a
        // compile error: `layer` only narrows to `never` while every member
        // of `EscapeLayer` is handled above.
        const _unhandled: never = layer;
        break;
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
