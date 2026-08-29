// «Frist»: a long-horizon countdown to a wall date — «5 dager igjen» on the
// board, day after day. Everything derives from Date.now() at paint time
// (60 s repaint is a re-derivation, never a counter), and the urgency bands
// recolour the number as the date closes in.

import { useEffect, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tn } from "../../i18n";
import { saveNow, updateWidgetConfig } from "../../state/layout";
import { breakdown, urgency } from "./deadline-core";
import styles from "./deadline.module.css";

/** The date input carries a local wall date; the deadline lands END OF that
 *  school day (16:00) — «fristen er fredag» means Friday afternoon, not
 *  Friday midnight. */
export function targetFromDateInput(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 16, 0, 0, 0).getTime();
}

function toDateInput(targetEpochMs: number): string {
  if (targetEpochMs <= 0) return "";
  const d = new Date(targetEpochMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function DeadlineWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [editingTitle, setEditingTitle] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (cfg.kind !== "deadline") return null;

  const now = Date.now();
  const set = cfg.targetEpochMs > 0;
  const b = breakdown(cfg.targetEpochMs, now);
  const band = urgency(cfg.targetEpochMs, now);
  const showHours = cfg.showHours && !b.overdue && b.days < 7;

  return (
    <div class={styles.deadline} data-urgency={set ? band : undefined}>
      {editingTitle ? (
        <input
          class={styles.titleInput}
          aria-label={t("deadline.titlePlaceholder")}
          placeholder={t("deadline.titlePlaceholder")}
          value={cfg.title}
          autofocus
          data-no-drag
          onInput={(e) =>
            updateWidgetConfig(
              widget.id,
              { ...cfg, title: (e.target as HTMLInputElement).value },
              { debounce: true },
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              setEditingTitle(false);
              // Blur commits with the immediate save (the text-widget
              // contract) — a pending debounce must not die with a quit.
              saveNow();
            }
          }}
          onBlur={() => {
            setEditingTitle(false);
            saveNow();
          }}
        />
      ) : (
        <button
          class={styles.title}
          data-no-drag
          onClick={() => setEditingTitle(true)}
        >
          {cfg.title || t("deadline.titlePlaceholder")}
        </button>
      )}
      {set ? (
        b.overdue ? (
          <span class={styles.overdue}>{t("deadline.overdue")}</span>
        ) : (
          <div class={styles.count}>
            <span class={styles.big}>
              {b.days > 0 || !showHours ? b.days : b.hours}
            </span>
            <span class={styles.unit}>
              {b.days > 0 || !showHours
                ? tn("deadline.days", b.days)
                : tn("deadline.hours", b.hours)}
            </span>
            {showHours && b.days > 0 && (
              <span class={styles.small}>
                {tn("deadline.hoursShort", b.hours)}
              </span>
            )}
          </div>
        )
      ) : (
        <span class={styles.empty}>{t("deadline.pickDate")}</span>
      )}

      <div data-settings-row data-no-drag>
        <input
          data-settings-btn
          type="date"
          class={styles.dateInput}
          aria-label={t("deadline.pickDate")}
          title={t("deadline.pickDate")}
          value={toDateInput(cfg.targetEpochMs)}
          onChange={(e) =>
            updateWidgetConfig(widget.id, {
              ...cfg,
              targetEpochMs: targetFromDateInput(
                (e.target as HTMLInputElement).value,
              ),
            })
          }
        />
        <button
          data-settings-btn
          aria-pressed={cfg.showHours}
          data-current={cfg.showHours || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, showHours: !cfg.showHours })
          }
        >
          {t("deadline.showHours")}
        </button>
      </div>
    </div>
  );
}
