// «Dagen i dag»: the date in big friendly type, today's lessons from the
// planner and the day's messages. A good-morning screen — everything
// derives from the shared planner store and Intl at paint time.

import { useEffect, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { localeTag } from "@lib/i18n";
import { t } from "../../i18n";
import { formatMin } from "../../planner/date-core";
import { plannerNowMs, todayPlan, todayReadFailed } from "../../state/planner";
import { updateWidgetConfig } from "../../state/layout";
import styles from "./today.module.css";

export function TodayWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (cfg.kind !== "today") return null;

  void plannerNowMs.value; // subscribe: date rollover refetches the plan
  const now = new Date();
  const weekday = new Intl.DateTimeFormat(localeTag(), {
    weekday: "long",
  }).format(now);
  const date = new Intl.DateTimeFormat(localeTag(), {
    day: "numeric",
    month: "long",
  }).format(now);

  const plan = todayPlan.value;
  const lessons =
    plan?.entries.filter(
      (e) => e.period.kind === "lesson" && e.lesson != null,
    ) ?? [];

  return (
    <div class={styles.today}>
      <header class={styles.head}>
        <span class={styles.weekday}>{weekday}</span>
        <span class={styles.date}>{date}</span>
      </header>

      {cfg.showLessons && (
        <ul class={styles.lessons} data-no-drag>
          {lessons.length === 0 ? (
            // Three different days, three different sentences. The middle
            // one is keyed on `plan.entries`, NOT on `lessons`: a Saturday
            // with a full week template has periods but no lesson rows, and
            // «Ingen timer i dag» is the true thing to say there. An empty
            // ENTRY list means no timetable exists at all. (`plan != null`
            // keeps the text from flickering before the first IPC answer.)
            <li class={styles.emptyRow}>
              {todayReadFailed.value
                ? t("planner.readFailed")
                : plan != null && plan.entries.length === 0
                  ? t("planner.noTimetable")
                  : t("today.noLessons")}
            </li>
          ) : (
            lessons.map((e) => (
              <li key={e.period.id} class={styles.lesson}>
                <span class={styles.time}>{formatMin(e.period.startMin)}</span>
                <span class={styles.subject}>
                  {e.lesson!.title || e.lesson!.subject || e.period.label}
                </span>
                {e.lesson!.className && (
                  <span class={styles.className}>{e.lesson!.className}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}

      {cfg.showNotes && (plan?.notes.length ?? 0) > 0 && (
        <ul class={styles.notes} data-no-drag>
          {plan!.notes.map((n) => (
            <li key={n.id} class={styles.note}>
              {n.body}
            </li>
          ))}
        </ul>
      )}

      <div data-settings-row data-no-drag>
        <button
          data-settings-btn
          aria-pressed={cfg.showLessons}
          data-current={cfg.showLessons || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, {
              ...cfg,
              showLessons: !cfg.showLessons,
            })
          }
        >
          {t("today.showLessons")}
        </button>
        <button
          data-settings-btn
          aria-pressed={cfg.showNotes}
          data-current={cfg.showNotes || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, showNotes: !cfg.showNotes })
          }
        >
          {t("today.showNotes")}
        </button>
      </div>
    </div>
  );
}
