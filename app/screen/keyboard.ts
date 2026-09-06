// Global keys: F11 toggles fullscreen, Cmd/Ctrl+Z takes back the deletion the
// snackbar is offering, and Escape peels ONE layer at a time (text field → a
// widget's own popover → the add menu → class menu → the design session →
// an overlay panel → an enlarged widget → fullscreen — with the last two
// swapped while a design session runs, because the big card is then INSIDE
// the panel rather than under it; `chrome-core.ts` owns that argument).
// Installed once from main.tsx.

import { attendancePanelOpen } from "../state/attendance";
import { classMenuOpen, managePanelOpen } from "../state/classes";
import {
  activeWidgetOverlay,
  addMenuOpen,
  closeWidgetOverlay,
  modalPanelOpen,
} from "../state/chrome";
import { designSession, exitDesign } from "../state/design-session";
import {
  clearFocus,
  focusedWidget,
  undoRemove,
  undoSlot,
} from "../state/layout";
import { sceneMenuOpen } from "../state/scenes";
import { closePlanner } from "../state/planner";
import { chromeActivity, fullscreen, toggleFullscreen } from "../state/chrome";
import { escapeTarget } from "./chrome-core";

/**
 * Does this element own its own keys?
 *
 * A focused text field eats Escape (it leaves the field), Cmd/Ctrl+Z (the
 * browser's text undo belongs to the field) and — since funn 1 — the ARROWS,
 * which move the caret while a teacher is writing a message, not the card the
 * message is written on. One definition, read from both places: two copies of
 * «what counts as typing» is how a card starts sliding under someone's hands
 * halfway through a sentence.
 *
 * A checkbox or a radio has nothing to leave and nothing to type into
 * (F-funn C17), so they are deliberately outside it. `<select>` is too, and
 * that is worth naming: it DOES use the arrows, but no widget renders one —
 * the only selects in the app are inside the planner's tabs, which no card
 * contains. The day a widget grows one, it belongs in this list.
 */
export function isTextEntry(el: Element | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "TEXTAREA" ||
      (el instanceof HTMLInputElement &&
        !["checkbox", "radio", "button", "submit"].includes(el.type)))
  );
}

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
    const isTextField = isTextEntry(active);

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
      // ABOVE the panel it lives in, on purpose: «gå ut av økta, bli i
      // panelet». The ordering argument is in `chrome-core.ts`, where the
      // rung is; here it is only a signal read.
      designOpen: designSession.peek() !== null,
      // EVERY overlay belongs in here. An overlay the chain does not know
      // about reads as "nothing is open", and Escape then leaves
      // FULLSCREEN — the projector view goes away while the panel the
      // teacher meant to dismiss stays on the board. The list itself now
      // lives in `state/chrome.ts`, next to the `inert` that has to answer
      // the same question: two hand-kept copies of «which panels are modal»
      // is the drift this chain has already been bitten by once.
      overlayOpen: modalPanelOpen.peek(),
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
      case "design":
        // The session ends; the panel stays. `exitDesign` flushes the design
        // scene and hands the board back before it returns — the press is
        // fire-and-forget because nothing after it depends on the answer.
        void exitDesign();
        break;
      case "overlay":
        managePanelOpen.value = false;
        attendancePanelOpen.value = false;
        // The planner has ONE door (state/planner.ts). The rung above means
        // no session can still be running by the time we get here — but this
        // is the second of the two closers the house knows about, and the
        // rule is that neither of them sets the signal directly.
        void closePlanner();
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
