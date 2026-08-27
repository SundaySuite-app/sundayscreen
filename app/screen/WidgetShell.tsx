// One widget's card: position, selection state and the per-widget chrome
// (the delete button in F1; drag/resize handles arrive with the interaction
// layer in F2). `container-type: size` on the shell is what lets widget
// content scale with `cqmin`/`cqw` — no JS measurement loops.

import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t } from "../i18n";
import { removeWidget, selectedWidgetId } from "../state/layout";
import { surfaceSize } from "../state/surface";
import { WIDGET_REGISTRY } from "../widgets/registry";
import { fromNorm } from "./coords-core";
import styles from "./WidgetShell.module.css";

export function WidgetShell({ widget }: { widget: WidgetInstance }) {
  const def = WIDGET_REGISTRY[widget.config.kind];
  const px = fromNorm(widget.rect, surfaceSize.value);
  const selected = selectedWidgetId.value === widget.id;

  return (
    <section
      class={styles.shell}
      data-widget-kind={def.kind}
      data-selected={selected || undefined}
      style={{
        left: `${px.x}px`,
        top: `${px.y}px`,
        width: `${px.w}px`,
        height: `${px.h}px`,
        zIndex: widget.z + 1,
      }}
      onPointerDown={() => {
        selectedWidgetId.value = widget.id;
      }}
    >
      <def.Component widget={widget} />
      <button
        class={styles.delete}
        aria-label={t("widget.delete")}
        title={t("widget.delete")}
        onClick={() => removeWidget(widget.id)}
      >
        ×
      </button>
    </section>
  );
}
