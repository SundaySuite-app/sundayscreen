// One widget's card: position, selection state and the per-widget chrome —
// the delete button, the SE resize handle, and the drag surface (the whole
// body; interactive controls opt out with `data-no-drag`).
// `container-type: size` on the shell is what lets widget content scale with
// `cqmin`/`cqw` — no JS measurement loops.

import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t } from "../i18n";
import {
  duplicateWidget,
  removeWidget,
  selectedWidgetId,
} from "../state/layout";
import { Icon } from "../ui/Icon";
import { surfaceSize } from "../state/surface";
import { WIDGET_REGISTRY } from "../widgets/registry";
import { fromNorm } from "./coords-core";
import { activeDrag, startMove, startResize } from "./useDrag";
import styles from "./WidgetShell.module.css";

export function WidgetShell({ widget }: { widget: WidgetInstance }) {
  const def = WIDGET_REGISTRY[widget.config.kind];
  const drag = activeDrag.value;
  const dragging = drag?.id === widget.id;
  const px = dragging ? drag.px : fromNorm(widget.rect, surfaceSize.value);
  const selected = selectedWidgetId.value === widget.id;

  return (
    <section
      class={styles.shell}
      data-widget-kind={def.kind}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      style={{
        left: `${px.x}px`,
        top: `${px.y}px`,
        width: `${px.w}px`,
        height: `${px.h}px`,
        zIndex: widget.z + 1,
      }}
      onPointerDown={(e) => startMove(e, widget)}
    >
      <def.Component widget={widget} />
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
