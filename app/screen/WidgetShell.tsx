// One widget's card: position, selection state and the per-widget chrome —
// the delete button, the SE resize handle, and the drag surface (the whole
// body; interactive controls opt out with `data-no-drag`).
// `container-type: size` on the shell is what lets widget content scale with
// `cqmin`/`cqw` — no JS measurement loops.

import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t } from "../i18n";
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
import { activeDrag, startMove, startResize } from "./useDrag";
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

  return (
    <section
      class={styles.shell}
      data-widget-kind={def.kind}
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
      <button
        class={styles.resize}
        data-no-drag
        aria-label={t("widget.resize")}
        title={t("widget.resize")}
        onPointerDown={(e) => startResize(e, widget)}
      />
    </section>
  );
}
