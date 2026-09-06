// One widget's card: position, selection state and the per-widget chrome —
// the delete button, the SE resize handle, and the drag surface (the whole
// body; interactive controls opt out with `data-no-drag`).
// `container-type: size` on the shell is what lets widget content scale with
// `cqmin`/`cqw` — no JS measurement loops.
//
// ## THE CARD ITSELF IS A TAB STOP, and it has to be (funn 1)
//
// Every piece of a card's chrome — «Fjern», «Dupliser», «Vis stort», the
// resize handle, the standard settings row — is `visibility: hidden` until
// the card is hovered, selected or `:focus-within` (WidgetShell.module.css,
// F9-funn U#9: hidden must mean unhittable). `visibility: hidden` is also not
// focusable, so `:focus-within` could never bootstrap itself: on a clock, a
// traffic light or a work symbol — cards whose ONLY controls live in that
// row — there was no key sequence that reached the card at all. The card
// itself is the one element that is always visible, so it is the door.
//
// `role="group"` rather than the `<section>`'s own implicit `region`: a
// landmark is a major part of a page, and a board of a dozen landmarks makes
// landmark navigation useless. A card is a group of controls with a name,
// which is exactly what it is announced as.
//
// The stop goes away while a card is shown large — `frozenForFocus` refuses
// to move anything then, and a handle for a gesture that cannot happen is a
// stop that does nothing. That also keeps «Vis stort»'s tab ring on the
// controls the mode actually has.

import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t, tDyn } from "../i18n";
import {
  clearFocus,
  duplicateWidget,
  focusWidget,
  focusedWidgetId,
  removeWidget,
  selectedWidgetId,
} from "../state/layout";
import { Icon } from "../ui/Icon";
import { surfaceSize } from "../state/surface";
import { WIDGET_REGISTRY } from "../widgets/registry";
import { FOCUS_Z, focusRect, fromNorm } from "./coords-core";
import { isTextEntry } from "./keyboard";
import { activeDrag, nudgeWidget, startMove, startResize } from "./useDrag";
import styles from "./WidgetShell.module.css";

export function WidgetShell({ widget }: { widget: WidgetInstance }) {
  const def = WIDGET_REGISTRY[widget.config.kind];
  const drag = activeDrag.value;
  const dragging = drag?.id === widget.id;
  const focused = focusedWidgetId.value === widget.id;
  // «Vis stort» swaps ONE rect and nothing else: same component, same
  // `key={w.id}` in Surface, so the card is never re-mounted and a running
  // countdown (whose state lives in the widget's own `useState`) keeps
  // counting straight through. No `transform: scale()` either — it would
  // freeze every `cq` unit inside at the small card's size.
  const px = dragging
    ? drag.px
    : focused
      ? focusRect(surfaceSize.value)
      : fromNorm(widget.rect, surfaceSize.value);
  const selected = selectedWidgetId.value === widget.id;
  // ANY card being large freezes the whole board, not just this one.
  const boardFrozen = focusedWidgetId.value !== null;

  return (
    <section
      class={styles.shell}
      data-widget-kind={def.kind}
      role="group"
      aria-label={tDyn("widget.label", def.kind)}
      tabIndex={boardFrozen ? -1 : 0}
      onKeyDown={(e) => {
        // A text field inside the card owns its arrows — they move the caret
        // in a message being written, never the card it is written on.
        const target = e.target as HTMLElement | null;
        if (isTextEntry(target)) return;
        // Arrows anywhere ELSE in the card belong to the card: no control it
        // contains uses them, and «the card the keyboard is inside is the one
        // that moves» is a rule with no second reading. On the resize handle
        // they scale instead — see `nudgeWidget`.
        nudgeWidget(
          e,
          widget,
          target?.closest("[data-resize-handle]") ? "resize" : "move",
        );
      }}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      data-focused={focused || undefined}
      style={{
        left: `${px.x}px`,
        top: `${px.y}px`,
        width: `${px.w}px`,
        height: `${px.h}px`,
        // A FIXED layer, never `bringToFront`: raising writes z to disk, and a
        // view must not rearrange the board it is showing.
        zIndex: focused ? FOCUS_Z : widget.z + 1,
      }}
      onPointerDown={(e) => startMove(e, widget)}
    >
      <def.Component widget={widget} />
      {/* Furthest from the corner, left of «Dupliser»: «Fjern» keeps the spot
          it has always had, so a new button never lands under a finger aiming
          for the old one. A BUTTON, not a double-click — the interaction
          layer has a regression test AGAINST dblclick semantics. */}
      <button
        class={styles.focus}
        data-no-drag
        aria-pressed={focused}
        aria-label={focused ? t("widget.focusExit") : t("widget.focus")}
        title={focused ? t("widget.focusExit") : t("widget.focus")}
        onClick={() => (focused ? clearFocus() : focusWidget(widget.id))}
      >
        <Icon name={focused ? "collapse" : "expand"} size="sm" />
      </button>
      <button
        class={styles.duplicate}
        data-no-drag
        aria-label={t("widget.duplicate")}
        title={t("widget.duplicate")}
        onClick={() => duplicateWidget(widget.id)}
      >
        <Icon name="copy" size="sm" />
      </button>
      <button
        class={styles.delete}
        data-no-drag
        aria-label={t("widget.delete")}
        title={t("widget.delete")}
        onClick={() => removeWidget(widget.id)}
      >
        <Icon name="close" size="sm" />
      </button>
      {/* The handle is also the RESIZE MODE for the keyboard: with it focused
          the arrows scale the card from this very corner (`nudgeWidget`).
          Before that it was focusable, announced, and did nothing at all —
          a promise the button could not keep. The name says the keys because
          nothing else on the board can; `title` stays the short sentence, so
          the tooltip a mouse gets is not a keyboard instruction. */}
      <button
        class={styles.resize}
        data-no-drag
        data-resize-handle
        aria-label={t("widget.resizeKeys")}
        title={t("widget.resize")}
        onPointerDown={(e) => startResize(e, widget)}
      />
    </section>
  );
}
