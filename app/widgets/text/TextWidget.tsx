// The text widget: big messages on the projector. Click the text to edit in
// place (the textarea opts back into text selection); blur commits. Typing
// streams through the debounced save; blur forces the immediate one.
//
// The settings row is built ONCE and returned in BOTH branches, always as a
// SIBLING of the content — never inside the display button. A button inside
// a button is invalid HTML, and the click would bubble straight into «go to
// edit mode», so the row would fight the widget it configures.

import { useState } from "preact/hooks";

import type { TextAlign } from "../../bindings/TextAlign";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { LIMITS } from "@lib/limits.generated";
import { saveNow, updateWidgetConfig } from "../../state/layout";
import { clampFontScale, steppedScale } from "./text-core";
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

  // What the BACKEND would store, used for both the render and the stepper:
  // a stored 7.5 is drawn at 6.0 here because 6.0 is what comes back after a
  // restart (see text-core.ts).
  const scale = clampFontScale(cfg.fontScale);
  const smaller = steppedScale(scale, -1);
  const bigger = steppedScale(scale, 1);

  const setAlign = (align: TextAlign) => {
    if (align === cfg.align) return;
    updateWidgetConfig(widget.id, { ...cfg, align });
  };
  const setScale = (next: number | null) => {
    if (next == null) return;
    updateWidgetConfig(widget.id, { ...cfg, fontScale: next });
  };

  /**
   * The whole fix for the blur race, on EVERY button in the row.
   *
   * Without it, mousedown blurs the textarea, `setEditing(false)` swaps the
   * DOM under the mouse between mousedown and mouseup, and the click lands
   * on whatever parent inherited that pixel — never on the button. With it,
   * the textarea keeps focus and the alignment changes LIVE while the
   * teacher is still typing.
   */
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  // Right-alignment is deliberately absent: it has no classroom use and
  // would cost a third button in a row that is 260 px wide at its minimum.
  // The `[data-align="right"] `CSS branch stays, unused, for configs that
  // already carry it.
  const row = (
    <div class={styles.settings} data-settings-row data-no-drag>
      <button
        data-settings-btn
        data-current={cfg.align === "left" || undefined}
        onMouseDown={keepFocus}
        onClick={() => setAlign("left")}
      >
        {t("text.alignLeft")}
      </button>
      <button
        data-settings-btn
        data-current={cfg.align === "center" || undefined}
        onMouseDown={keepFocus}
        onClick={() => setAlign("center")}
      >
        {t("text.alignCenter")}
      </button>
      <button
        data-settings-btn
        class={styles.step}
        aria-label={t("text.smaller")}
        title={t("text.smaller")}
        disabled={smaller == null}
        onMouseDown={keepFocus}
        onClick={() => setScale(smaller)}
      >
        A−
      </button>
      <button
        data-settings-btn
        class={styles.step}
        aria-label={t("text.bigger")}
        title={t("text.bigger")}
        disabled={bigger == null}
        onMouseDown={keepFocus}
        onClick={() => setScale(bigger)}
      >
        A+
      </button>
    </div>
  );

  if (editing) {
    return (
      <>
        <textarea
          class={styles.editor}
          data-align={cfg.align}
          style={{ "--text-scale": scale }}
          value={cfg.content}
          maxLength={LIMITS.TEXT_CONTENT_MAX_CHARS}
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
        {row}
      </>
    );
  }

  const empty = cfg.content.trim() === "";
  return (
    <>
      <button
        class={styles.display}
        data-align={cfg.align}
        data-empty={empty || undefined}
        style={{ "--text-scale": scale }}
        onClick={() => setEditing(true)}
      >
        <span class={styles.inner}>
          {empty ? t("widget.text.placeholder") : cfg.content}
        </span>
      </button>
      {row}
    </>
  );
}
