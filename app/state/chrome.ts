// The chrome's live state: the auto-hiding toolbar and the fullscreen flag.
// Decisions live in screen/chrome-core.ts; this is the thin signal/listener
// half.

import { computed, signal } from "@preact/signals";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isTauri } from "@lib/api-shim";
import { inRevealZone, shouldHide } from "../screen/chrome-core";
import type { AnchorRect } from "../screen/popover-core";
import type { WindowState } from "../bindings/WindowState";
// The registry, for `activeWidgetOverlay` — and the ONE import here that is
// worth a note, because a widget will point back at this module the day it
// opens a popover (`openWidgetOverlay`), closing the ring
// chrome → registry → that widget → chrome.
//
// That ring is safe under exactly one invariant, and it is the invariant to
// keep: NOTHING in this module may read `WIDGET_REGISTRY` or `widgets` while
// the module is being EVALUATED. Both are read inside computeds, effects and
// functions only, all of which run later — so whichever module the bundle
// happens to enter the ring from, the half-built one is never dereferenced.
// A top-level `const kinds = Object.keys(WIDGET_REGISTRY)` here would be a
// `Cannot access before initialization` on boot, from one entry order and not
// the other.
import { WIDGET_REGISTRY } from "../widgets/registry";
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
 * The widget popover that is open, as the OPENER stated it: which card, and
 * the trigger's box in viewport pixels. Raw, and never read by the screen —
 * read [`activeWidgetOverlay`] instead.
 *
 * It lives in the chrome and not in the widget because the card cannot draw
 * it (see `WidgetDef.Overlay`): the panel is the SCREEN's to render, so the
 * fact that one is open is the screen's to know — the same division the add
 * menu and the manage panel already follow.
 *
 * The anchor is stored, not re-measured. By the time anything reads it the
 * trigger may be under the panel's own backdrop, and a rect measured then
 * would be a rect measured against a moved board.
 */
export const widgetOverlay = signal<{ id: string; anchor: AnchorRect } | null>(
  null,
);

/**
 * The open widget popover CROSSED against what is actually on the board and
 * in the registry — the widget itself, its `Overlay`, and the anchor. `null`
 * whenever there is nothing to draw.
 *
 * The crossing is the whole of it (the `focusedWidget` precedent in
 * state/layout.ts, and E2-12 before that). A raw id can go stale without
 * anyone clicking anything: the planner's auto-switch and the suggestion
 * banner both swap the board on a timer, and they can do it while the panel
 * is open. An id left pointing at a card that is no longer there would then
 * draw a panel with no anchor — or, worse, draw NOTHING and still answer
 * «yes» to the Escape chain, which is Escape silently doing nothing once.
 *
 * The `Overlay` is crossed for the same reason and not as paranoia: without
 * it, a kind that opened a panel it does not declare would hold the top rung
 * of the Escape chain with an empty screen behind it. Crossed, this signal
 * means exactly «there is a panel on screen», which is what both readers
 * below need it to mean.
 */
export const activeWidgetOverlay = computed(() => {
  const open = widgetOverlay.value;
  if (!open) return null;
  const widget = widgets.value.find((w) => w.id === open.id);
  if (!widget) return null;
  const Overlay = WIDGET_REGISTRY[widget.config.kind].Overlay;
  if (!Overlay) return null;
  return { widget, Overlay, anchor: open.anchor };
});

/**
 * Open `id`'s registered overlay against `anchor` — the trigger's own
 * `getBoundingClientRect()`, in viewport pixels.
 *
 * NOTE for a caller on a hover-revealed control (the die's settings row is
 * the first): the row is `visibility`-gated on `:hover`/`[data-selected]` and
 * the panel is NOT a descendant of the card, so the row blinks out from under
 * the finger the moment the pointer leaves the card. Select the widget as you
 * open — that is the widget's call to make about its own chrome, so it is not
 * made here.
 */
export function openWidgetOverlay(id: string, anchor: AnchorRect): void {
  widgetOverlay.value = { id, anchor };
}

/** Close it — what the backdrop, the Escape rung and the overlay's own
 *  `close()` all call. */
export function closeWidgetOverlay(): void {
  widgetOverlay.value = null;
}

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
    addMenuOpen.value ||
    // The CROSSED one, so a panel whose card has gone cannot pin the chrome
    // open for the rest of the day with nothing on screen to explain it.
    activeWidgetOverlay.value !== null,
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

  // Sweep a widget popover whose card has left the board.
  //
  // [`activeWidgetOverlay`] already makes a stale id invisible and mute, and
  // that is what protects the screen and the Escape chain. This clears the
  // RAW signal behind it, which matters for exactly one journey: ids survive
  // deletion (`undoRemove` puts the widget back under its own id) and boards
  // come back (the planner switches to the next lesson and back again), so an
  // id left standing could match a returning card and pop a panel open by
  // itself, at a rect measured against a layout that has since moved.
  //
  // Here rather than in `adoptSnapshot`/`removeWidget` because state/layout.ts
  // does not import this module — the arrow points one way, chrome → layout,
  // and it is what keeps the two from becoming an import cycle. Reading
  // `widgets` and PEEKING at `widgetOverlay` is the same one-way discipline
  // inside the callback: a subscriber that also subscribed to what it writes
  // would be a cycle of its own.
  const stopStaleSweep = widgets.subscribe((list) => {
    const open = widgetOverlay.peek();
    if (open && !list.some((w) => w.id === open.id)) closeWidgetOverlay();
  });

  return () => {
    window.removeEventListener("pointermove", onPointerMove);
    clearInterval(ticker);
    stopStaleSweep();
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
