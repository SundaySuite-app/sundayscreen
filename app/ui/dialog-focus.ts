// FOCUS FOR THE THREE MODAL PANELS: in on opening, back to the opener on
// closing. `DieLookMenu.tsx` is the recipe this generalises (R7-funn 2).
//
// ## What was measured, and why it is not a small thing
//
// With the planner open, the keyboard stood on the «Planlegger» button BEHIND
// the scrim, and Tab walked `Bytt skjerm → Bytt klasse → Fullskjerm` — all
// three under a panel that covers them — before entering the panel at all,
// and then straight out the other side onto a card's «Fjern». One tab stop
// too far and a teacher deletes a card she cannot see; `removeWidget` restores
// the instance but not a running countdown, so a timer deleted mid-lesson is
// not recoverable however fast the Undo. Closing then dropped the keyboard on
// `<body>`, i.e. back to the top of the document.
//
// ## The opener is tracked, not read at mount time
//
// The obvious spelling — read `document.activeElement` in the panel's own
// mount effect — cannot work here, and the reason is an ordering the DOM
// decides: the shell marks the board `inert` in the SAME commit that mounts
// the panel, the browser blurs an element the moment an ancestor becomes
// inert, and effects run after the commit. By then the opener is `<body>`.
//
// So a `focusin` listener keeps the last REAL focus, and the panel asks it.
// `<body>` is never recorded: it is not somewhere to send the keyboard back
// to, it is where the keyboard already is when nothing holds it. A mouse open
// in an engine that does not focus a clicked button (WKWebView is one) leaves
// nothing to remember — and nothing to restore either, which is correct.

import { useLayoutEffect } from "preact/hooks";

/** The last element that actually held the keyboard. Module state on purpose:
 *  there is one keyboard, and the panels are mutually exclusive. */
let lastFocused: HTMLElement | null = null;

/** Start tracking. Called once from `main.tsx`, beside the other global
 *  listeners; the cleanup exists for symmetry and is never needed (the shell
 *  lives as long as the window). */
export function trackDialogOpeners(): () => void {
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target;
    if (el instanceof HTMLElement && el !== document.body) lastFocused = el;
  };
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}

/** Everything a dialog may hand the keyboard to. Deliberately narrow — the
 *  real controls, the same list `base.css` draws the focus ring on, plus the
 *  `[tabindex]` a panel may one day put on its own root. `:not([tabindex="-1"])`
 *  keeps the dismiss backdrops out of it. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Move the keyboard INTO `root` when it mounts, and hand it back to whatever
 * opened it when it unmounts.
 *
 * Focus lands on the first focusable control in document order — for these
 * three panels the first tab in the planner's header, and the «Lukk» button
 * in the other two. Onto a real control rather than the panel root with
 * `tabindex="-1"`: a button is focusable in every engine without an added
 * attribute, WKWebView included (the DieLookMenu argument), and it costs no
 * extra Tab to reach the first thing the teacher can do.
 *
 * `isConnected` on the way out: a panel can close because the thing that
 * opened it went away (a lesson auto-switch swapping the board under a
 * widget's own button). Focusing a detached node is a silent no-op that would
 * strand the keyboard on `<body>` with no way back, so it is CHECKED rather
 * than attempted.
 */
export function useDialogFocus(root: { current: HTMLElement | null }): void {
  // Mount only: the three panels are never swapped for one another in place,
  // so there is no change for a dependency list to catch.
  useLayoutEffect(() => {
    const opener = lastFocused;
    const first = root.current?.querySelector<HTMLElement>(FOCUSABLE);
    // `preventScroll`: the panel is full-screen and its body may be scrollable,
    // and a scroll to the first control before the first paint is a jump the
    // teacher sees.
    first?.focus({ preventScroll: true });
    return () => {
      if (!opener) return;
      // A MICROTASK, and it is not a nicety — it is the other half of the same
      // ordering the module note above is about. Preact removes a child before
      // it diffs its siblings' props, so at this instant the wall is STILL
      // `inert`, and `focus()` on an inert element is a silent no-op: measured
      // without this, `document.activeElement` after closing the planner is
      // `<body>`, which is the bug this hook exists to fix. The whole commit
      // is synchronous, so a microtask runs once the attribute is gone.
      // `isConnected` is re-read there rather than here for the same reason.
      queueMicrotask(() => {
        if (opener.isConnected) opener.focus();
      });
    };
  }, []);
}
