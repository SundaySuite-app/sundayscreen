// The thin DOM half of the interaction layer: pointer capture, the
// click-vs-drag threshold, and committing the result. All the math lives in
// interact-core.ts; render state lives in the `activeDrag` signal so the
// component tree simply draws what the signal says.

import { signal } from "@preact/signals";

import type { WidgetInstance } from "../bindings/WidgetInstance";
import {
  bringToFront,
  commitWidgetRect,
  focusedWidget,
  widgets,
} from "../state/layout";
import { settings } from "../state/settings";
import { surfaceSize } from "../state/surface";
import { fromNorm, toNorm, type PxRect } from "./coords-core";
import {
  dragMove,
  isDrag,
  resizeSE,
  snapRect,
  snapResize,
  type SnapResult,
} from "./interact-core";
import { WIDGET_REGISTRY } from "../widgets/registry";

/** What the surface is currently showing being dragged/resized, or null. */
export const activeDrag = signal<{
  id: string;
  px: PxRect;
  guidesV: number[];
  guidesH: number[];
} | null>(null);

/**
 * One-shot click suppression: a drag ends with a pointerup that the browser
 * follows with a CLICK on whatever is under the pointer — which would open
 * the text editor at the end of every drag.
 *
 * EXPORTED, and deliberately so. The die's trackball (R5) is a second drag
 * that has to swallow its own trailing click — a die spun with the finger
 * must not also be thrown — and it uses the whole recipe from this file:
 * window listeners keyed on `pointerId`, `isDrag` as the threshold, capture
 * taken only ON CROSSING, and this. Two copies of «which click gets
 * swallowed» is exactly how a drag-that-also-rolls appears six months later,
 * once one of them has been tuned and the other has not.
 */
export function suppressNextClick(): void {
  window.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true, once: true },
  );
}

function beginTracking(
  e: PointerEvent,
  widget: WidgetInstance,
  compute: (dx: number, dy: number) => SnapResult | { rect: PxRect },
): void {
  const el = e.currentTarget as HTMLElement;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;

  // Listeners live on WINDOW (captured events still bubble there), and the
  // pointer is captured only when the press actually BECOMES a drag: capture
  // retargets the browser's synthesized `click` to the capture element, so
  // capturing on pointerdown would eat the click that opens the text editor.
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (!isDrag(dx, dy)) return;
      dragging = true;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // A pointer that just ended cannot be captured — the up handler is
        // already on its way.
      }
    }
    const result = compute(dx, dy);
    activeDrag.value = {
      id: widget.id,
      px: result.rect,
      guidesV: "guidesV" in result ? result.guidesV : [],
      guidesH: "guidesH" in result ? result.guidesH : [],
    };
  };

  const teardown = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    teardown();
    const drag = activeDrag.value;
    activeDrag.value = null;
    if (dragging && drag) {
      suppressNextClick();
      commitWidgetRect(widget.id, toNorm(drag.px, surfaceSize.peek()));
    }
  };

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    teardown();
    activeDrag.value = null;
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}

/**
 * Is the board frozen for arranging? While ONE card is shown large, no card
 * moves or scales — not the big one, and not the cards under the scrim.
 *
 * FIRST in both entry points, ahead of `bringToFront`: raising is a WRITE (z
 * is persisted), and the enlarged card's own rect is a view, not its stored
 * one. Dragging it would collapse it back to normal size under the finger and
 * commit a position the teacher never saw — promise 2, broken silently.
 *
 * Read through the CROSSED computed, not the raw id (R4-funn E2-12): the
 * keyboard layer deliberately asks `focusedWidget`, and the two must agree
 * about what «in focus» means. A STALE id — a card removed under the view, a
 * board swapped out from under it — draws no big card and swallows no Escape,
 * so it must not freeze the board either; the raw id said "frozen" and left
 * every card on a live board unmovable with nothing on screen to explain it.
 */
function frozenForFocus(): boolean {
  return focusedWidget.peek() !== null;
}

/** Pointerdown on the widget body: select, raise, and maybe drag. */
export function startMove(e: PointerEvent, widget: WidgetInstance): void {
  if (frozenForFocus()) return;
  if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
  bringToFront(widget.id);
  const surface = surfaceSize.peek();
  const startPx = fromNorm(widget.rect, surface);
  const siblings = widgets
    .peek()
    .filter((w) => w.id !== widget.id)
    .map((w) => fromNorm(w.rect, surface));
  const snap = settings.peek().snapEnabled;
  beginTracking(e, widget, (dx, dy) => {
    const moved = dragMove(startPx, dx, dy, surface);
    return snap ? snapRect(moved, siblings, surface) : { rect: moved };
  });
}

/** Pointerdown on the SE resize handle. Mirrors `startMove`: same sibling
 *  set, same snap setting — scaling a card lines it up with its neighbours
 *  the way moving one does. */
export function startResize(e: PointerEvent, widget: WidgetInstance): void {
  if (frozenForFocus()) return;
  e.stopPropagation();
  bringToFront(widget.id);
  const surface = surfaceSize.peek();
  const startPx = fromNorm(widget.rect, surface);
  const min = WIDGET_REGISTRY[widget.config.kind].minSizePx;
  const siblings = widgets
    .peek()
    .filter((w) => w.id !== widget.id)
    .map((w) => fromNorm(w.rect, surface));
  const snap = settings.peek().snapEnabled;
  beginTracking(e, widget, (dx, dy) => {
    const sized = resizeSE(startPx, dx, dy, min, surface);
    return snap ? snapResize(sized, siblings, surface, min) : { rect: sized };
  });
}
