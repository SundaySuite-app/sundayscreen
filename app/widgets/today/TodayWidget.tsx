// «Dagen i dag»: the date in big friendly type, today's lessons from the
// planner and the day's messages. A good-morning screen — everything
// derives from the shared planner store and Intl at paint time.

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { localeTag } from "@lib/i18n";
import { t } from "../../i18n";
import { formatMin } from "../../planner/date-core";
import {
  openPlanner,
  plannerNowMs,
  todayPlan,
  todayReadFailed,
} from "../../state/planner";
import { updateWidgetConfig } from "../../state/layout";
import { blockEnd } from "../agenda/agenda-widget-core";
import styles from "./today.module.css";

export function TodayWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "today") return null;

  // ONE clock, and it is the planner's (the agenda's E2-10 lesson). The
  // widget carried a private 60 s `setInterval` on top of this subscription;
  // it was DEAD code, because the 30 s planner tick already re-renders
  // everything the interval could have — twice as often, and from the same
  // signal the date and the plan are read off.
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
  // One row per LESSON, not per period (Runde 6). The resolver copies the
  // head's lesson onto the second half of a double lesson, so an unfiltered
  // list would draw «Norsk» twice — once at 08:30 and once at 09:20 — and
  // read as two separate lessons to a class scanning the day.
  const lessons =
    plan?.entries.filter(
      (e) =>
        e.period.kind === "lesson" &&
        e.lesson != null &&
        e.continuation !== true,
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
              {todayReadFailed.value ? (
                t("planner.readFailed")
              ) : plan != null && plan.entries.length === 0 ? (
                // A DOOR, not a message. «Ingen timeplan satt opp ennå» is
                // the one sentence in this app that names something the
                // teacher can do, and everywhere else it says it — the
                // agenda's own empty state, the picker's «Legg inn navn»,
                // the group generator's. Here it was dead text she clicked
                // on day one and nothing happened. `data-no-drag` is
                // mandatory: the list is part of the drag surface.
                <button class={styles.door} data-no-drag onClick={openPlanner}>
                  {t("planner.noTimetable")}
                </button>
              ) : (
                t("today.noLessons")
              )}
            </li>
          ) : (
            lessons.map((e) => {
              // A merged head now stands for the tail's period too, so its
              // start time alone would understate the day: the class reads
              // «08:30» for something that runs to 10:00, with nothing in the
              // list between. The end is added ONLY when the block actually
              // reaches past this period — an ordinary lesson keeps the bare
              // start time it has always had, and the row keeps its width.
              const end = blockEnd(plan, e);
              const merged = end !== e.period.endMin;
              return (
                <li key={e.period.id} class={styles.lesson}>
                  <span class={styles.time}>
                    {formatMin(e.period.startMin)}
                    {merged && <>–{formatMin(end)}</>}
                  </span>
                  <span class={styles.subject}>
                    {e.lesson!.title || e.lesson!.subject || e.period.label}
                  </span>
                  {e.lesson!.className && (
                    <span class={styles.className}>{e.lesson!.className}</span>
                  )}
                </li>
              );
            })
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
