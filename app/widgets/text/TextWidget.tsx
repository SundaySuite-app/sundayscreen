// The text widget: big messages on the projector. Click the text to edit in
// place (the textarea opts back into text selection); blur commits. Typing
// streams through the debounced save; blur forces the immediate one.

import { useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { saveNow, updateWidgetConfig } from "../../state/layout";
import styles from "./text.module.css";

export function TextWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  // The registry routed us here, so the kind is stable for this instance —
  // the early return can never flip between renders (hook order is safe),
  // and TS narrows the config union for everything below.
  if (cfg.kind !== "text") return null;
  const [editing, setEditing] = useState(false);

  const commit = (content: string, opts: { debounce: boolean }) => {
    updateWidgetConfig(widget.id, { ...cfg, content }, opts);
  };

  if (editing) {
    return (
      <textarea
        class={styles.editor}
        style={{ fontSize: `${8 * cfg.fontScale}cqmin` }}
        value={cfg.content}
        data-no-drag
        autofocus
        onInput={(e) =>
          commit((e.target as HTMLTextAreaElement).value, { debounce: true })
        }
        onBlur={() => {
          setEditing(false);
          saveNow();
        }}
      />
    );
  }

  const empty = cfg.content.trim() === "";
  return (
    <button
      class={styles.display}
      data-align={cfg.align}
      data-empty={empty || undefined}
      style={{ fontSize: `${8 * cfg.fontScale}cqmin` }}
      onClick={() => setEditing(true)}
    >
      <span class={styles.inner}>
        {empty ? t("widget.text.placeholder") : cfg.content}
      </span>
    </button>
  );
}
