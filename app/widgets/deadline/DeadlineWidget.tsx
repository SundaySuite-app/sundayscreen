// «Frist»: a long-horizon countdown to a wall date — «5 dager igjen» on the
// board, day after day. Everything derives from Date.now() at paint time
// (60 s repaint is a re-derivation, never a counter), and the urgency bands
// recolour the number as the date closes in.

import { useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tn } from "../../i18n";
import { localeTag } from "@lib/i18n";
import { LIMITS } from "@lib/limits.generated";
import { updateWidgetConfig } from "../../state/layout";
import { commitField } from "../../ui/commit";
import { MINUTE_TICK_MS, useTick } from "../../ui/useTick";
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
  // A re-derivation, never a counter: everything below is computed from
  // `Date.now()` at paint time, so a missed minute is stale, not wrong.
  useTick(MINUTE_TICK_MS);
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
          maxLength={LIMITS.DEADLINE_TITLE_MAX_CHARS}
          autofocus
          data-no-drag
          // The shared edit-in-place contract (app/ui/commit.ts) — the three
          // hand copies it replaces all said the same thing in different
          // words, and cross-referenced each other for the reason.
          {...commitField({
            write: (title, opts) =>
              updateWidgetConfig(widget.id, { ...cfg, title }, opts),
            close: () => setEditingTitle(false),
          })}
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
        ) : b.days === 0 && b.hours === 0 ? (
          // The last hour: «0 timer igjen» is a lie while 59 minutes remain.
          <span class={styles.overdue}>{t("deadline.soon")}</span>
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
            {showHours && b.days > 0 && b.hours > 0 && (
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
        {/*
         * `lang` is the cheap half of R7-funn K8. A native date field takes
         * its placeholder and its picker from the LOCALE, and on a school Mac
         * running an English system that meant «mm/dd/yyyy» and an English
         * calendar in the middle of a Norwegian app, on a projector. Chromium
         * and WebKit both let the element's own `lang` decide that, so the
         * app's language answers for its own field.
         *
         * The other half — printing the chosen date ourselves, «05.09.2026»
         * through `Intl` — is a bigger change (own display + a hidden field
         * for the picker) and is not made here.
         */}
        <input
          data-settings-btn
          type="date"
          lang={localeTag()}
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
