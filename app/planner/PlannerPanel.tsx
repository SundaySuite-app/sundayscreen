// The planner: a full-screen overlay (ManagePanel pattern) with three tabs —
// Timeoppsett (the school day's period template, defined once), Ukeplan (the
// recurring weekday × period grid) and I dag (a date's overrides, agendas
// and notes). All decisions live in cores/backed commands; this file is
// forms.

import { useState } from "preact/hooks";

import type { DayEntry } from "../bindings/DayEntry";
import type { Period } from "../bindings/Period";
import type { PeriodKind } from "../bindings/PeriodKind";
import { t, tDyn, tf } from "../i18n";
import { classes } from "../state/classes";
import {
  periods,
  plannerChanged,
  plannerHydrated,
  plannerPanelOpen,
  plannerTab,
  refreshPlanner,
  selectDate,
  selectedDate,
  selectedDayPlan,
  weekSlots,
} from "../state/planner";
import { scenes } from "../state/scenes";
import { settings } from "../state/settings";
import { toast } from "../ui/toast";
import { Icon } from "../ui/Icon";
import { addDays, formatMin, localDateStr, parseTime } from "./date-core";
import styles from "./PlannerPanel.module.css";

const LESSON_WEEKDAYS = [1, 2, 3, 4, 5] as const;

export function PlannerPanel() {
  if (!plannerPanelOpen.value) return null;
  const tab = plannerTab.value;

  return (
    <div class={styles.scrim}>
      <section class={styles.panel} aria-label={t("planner.title")}>
        <header class={styles.header}>
          <h2 class={styles.title}>{t("planner.title")}</h2>
          <nav class={styles.tabs}>
            {(["periods", "week", "day"] as const).map((id) => (
              <button
                key={id}
                class={styles.tab}
                data-current={tab === id || undefined}
                onClick={() => {
                  plannerTab.value = id;
                }}
              >
                {tDyn("planner.tab", id)}
              </button>
            ))}
          </nav>
          <button
            class={styles.close}
            aria-label={t("manage.close")}
            onClick={() => {
              plannerPanelOpen.value = false;
            }}
          >
            <Icon name="close" size="md" />
          </button>
        </header>

        {!plannerHydrated.value ? (
          <div class={styles.blocked}>
            <p>{t("planner.blocked")}</p>
            <button
              class={styles.secondary}
              onClick={() => void refreshPlanner()}
            >
              {t("planner.retry")}
            </button>
          </div>
        ) : (
          <div class={styles.body}>
            {tab === "periods" && <PeriodsTab />}
            {tab === "week" && <WeekTab />}
            {tab === "day" && <DayTab />}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Timeoppsett ─────────────────────────────────────────────────────────────

interface PeriodDraft {
  id: string | null;
  label: string;
  start: string;
  end: string;
  kind: PeriodKind;
}

function draftsFrom(list: Period[]): PeriodDraft[] {
  return list.map((p) => ({
    id: p.id,
    label: p.label,
    start: formatMin(p.startMin),
    end: formatMin(p.endMin),
    kind: p.kind,
  }));
}

function PeriodsTab() {
  const [drafts, setDrafts] = useState<PeriodDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const rows = drafts ?? draftsFrom(periods.value);

  const edit = (i: number, patch: Partial<PeriodDraft>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setDrafts(next);
    setReceipt(false);
  };

  const save = async () => {
    setError(null);
    const specs = [];
    for (const r of rows) {
      const start = parseTime(r.start);
      const end = parseTime(r.end);
      if (r.label.trim() === "") continue;
      if (start == null || end == null || end <= start) {
        setError(t("planner.badTime"));
        return;
      }
      specs.push({
        id: r.id,
        label: r.label.trim(),
        startMin: start,
        endMin: end,
        kind: r.kind,
      });
    }
    try {
      periods.value = await window.api.plannerPeriodsSet(specs);
      setDrafts(null);
      setReceipt(true);
      await plannerChanged();
    } catch (e) {
      console.warn("[planner] periods save failed", e);
      setError(t("planner.overlap"));
    }
  };

  return (
    <div class={styles.tabBody}>
      <p class={styles.hint}>{t("planner.periodsHint")}</p>
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} class={styles.periodRow}>
          <input
            class={styles.grow}
            aria-label={t("planner.label")}
            placeholder={t("planner.label")}
            value={r.label}
            onInput={(e) =>
              edit(i, { label: (e.target as HTMLInputElement).value })
            }
          />
          <input
            class={styles.time}
            aria-label={t("planner.start")}
            value={r.start}
            onInput={(e) =>
              edit(i, { start: (e.target as HTMLInputElement).value })
            }
          />
          <input
            class={styles.time}
            aria-label={t("planner.end")}
            value={r.end}
            onInput={(e) =>
              edit(i, { end: (e.target as HTMLInputElement).value })
            }
          />
          <button
            class={styles.pill}
            data-current={r.kind === "lesson" || undefined}
            onClick={() =>
              edit(i, { kind: r.kind === "lesson" ? "break" : "lesson" })
            }
          >
            {r.kind === "lesson" ? t("planner.lesson") : t("planner.break")}
          </button>
          <button
            class={styles.rowAction}
            aria-label={t("manage.delete")}
            title={t("manage.delete")}
            onClick={() => {
              setDrafts(rows.filter((_, j) => j !== i));
              setReceipt(false);
            }}
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      <div class={styles.actions}>
        <button
          class={styles.secondary}
          onClick={() => {
            const last = rows[rows.length - 1];
            const start = last ? last.end : "08:30";
            const startMin = parseTime(start) ?? 510;
            setDrafts([
              ...rows,
              {
                id: null,
                label: tf("planner.defaultPeriodLabel", {
                  n: String(rows.filter((r) => r.kind === "lesson").length + 1),
                }),
                start,
                end: formatMin(Math.min(startMin + 45, 1439)),
                kind: "lesson",
              },
            ]);
            setReceipt(false);
          }}
        >
          <Icon name="plus" size="sm" />
          {t("planner.addPeriod")}
        </button>
        <button class={styles.primary} onClick={() => void save()}>
          {t("planner.savePeriods")}
        </button>
        {receipt && (
          <span class={styles.receipt}>{t("manage.savedReceipt")}</span>
        )}
        {error && <span class={styles.error}>{error}</span>}
      </div>
      <label class={styles.checkRow}>
        <input
          type="checkbox"
          checked={settings.value.autoSwitchScenes}
          onChange={(e) => {
            const next = {
              ...settings.peek(),
              autoSwitchScenes: (e.target as HTMLInputElement).checked,
            };
            const prev = settings.peek();
            settings.value = next;
            window.api.saveSettings(next).catch((err) => {
              console.warn("[planner] auto-toggle save failed", err);
              settings.value = prev;
              toast("error", t("manage.actionFailed"));
            });
          }}
        />
        {t("planner.autoSwitch")}
      </label>
    </div>
  );
}

// ── Ukeplan ─────────────────────────────────────────────────────────────────

function WeekTab() {
  const [cell, setCell] = useState<{
    weekday: number;
    periodId: string;
  } | null>(null);
  const lessons = periods.value.filter((p) => p.kind === "lesson");
  const slotFor = (weekday: number, periodId: string) =>
    weekSlots.value.find(
      (s) => s.weekday === weekday && s.periodId === periodId,
    );

  return (
    <div class={styles.tabBody}>
      {lessons.length === 0 ? (
        <p class={styles.hint}>{t("planner.noPeriodsYet")}</p>
      ) : (
        <div
          class={styles.weekGrid}
          style={`grid-template-columns: 90px repeat(${LESSON_WEEKDAYS.length}, 1fr)`}
        >
          <span />
          {LESSON_WEEKDAYS.map((d) => (
            <span key={d} class={styles.weekHead}>
              {tDyn("planner.weekday", String(d))}
            </span>
          ))}
          {lessons.map((p) => (
            <>
              <span key={`${p.id}-h`} class={styles.periodHead}>
                <b>{p.label}</b>
                <small>{formatMin(p.startMin)}</small>
              </span>
              {LESSON_WEEKDAYS.map((d) => {
                const slot = slotFor(d, p.id);
                const active = cell?.weekday === d && cell.periodId === p.id;
                return (
                  <button
                    key={`${p.id}-${d}`}
                    class={styles.cell}
                    data-current={active || undefined}
                    onClick={() => setCell({ weekday: d, periodId: p.id })}
                  >
                    {slot ? (
                      <>
                        <b>
                          {classes.value.find((c) => c.id === slot.classId)
                            ?.name ?? ""}
                        </b>
                        <small>{slot.subject}</small>
                      </>
                    ) : (
                      <span class={styles.cellEmpty}>—</span>
                    )}
                  </button>
                );
              })}
            </>
          ))}
        </div>
      )}
      {cell && (
        <CellEditor
          weekday={cell.weekday}
          periodId={cell.periodId}
          onDone={() => setCell(null)}
        />
      )}
    </div>
  );
}

function CellEditor(props: {
  weekday: number;
  periodId: string;
  onDone: () => void;
}) {
  const existing = weekSlots.value.find(
    (s) => s.weekday === props.weekday && s.periodId === props.periodId,
  );
  const [classId, setClassId] = useState<string>(existing?.classId ?? "");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [sceneId, setSceneId] = useState<string>(existing?.sceneId ?? "");
  const [error, setError] = useState(false);

  const write = async (
    slot: {
      classId: string | null;
      subject: string;
      sceneId: string | null;
    } | null,
  ) => {
    setError(false);
    try {
      await window.api.plannerSlotSet(props.weekday, props.periodId, slot);
      weekSlots.value = await window.api.plannerWeekGet();
      await plannerChanged();
      props.onDone();
    } catch (e) {
      console.warn("[planner] slot save failed", e);
      setError(true);
    }
  };

  const period = periods.value.find((p) => p.id === props.periodId);
  return (
    <div class={styles.editor}>
      <h3 class={styles.editorTitle}>
        {tDyn("planner.weekday", String(props.weekday))} ·{" "}
        {period ? `${period.label} ${formatMin(period.startMin)}` : ""}
      </h3>
      <div class={styles.editorRow}>
        <label class={styles.field}>
          {t("planner.class")}
          <select
            aria-label={t("planner.class")}
            value={classId}
            onChange={(e) => setClassId((e.target as HTMLSelectElement).value)}
          >
            <option value="">{t("planner.noClass")}</option>
            {classes.value.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class={styles.field}>
          {t("planner.subject")}
          <input
            value={subject}
            placeholder={t("planner.subjectPlaceholder")}
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class={styles.field}>
          {t("planner.scene")}
          <select
            aria-label={t("planner.scene")}
            value={sceneId}
            onChange={(e) => setSceneId((e.target as HTMLSelectElement).value)}
          >
            <option value="">{t("scene.default")}</option>
            {scenes.value.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class={styles.actions}>
        <button
          class={styles.primary}
          onClick={() =>
            void write({
              classId: classId || null,
              subject,
              sceneId: sceneId || null,
            })
          }
        >
          {t("planner.save")}
        </button>
        <button class={styles.secondary} onClick={() => void write(null)}>
          {t("planner.clear")}
        </button>
        <button class={styles.secondary} onClick={props.onDone}>
          {t("manage.cancel")}
        </button>
        {error && <span class={styles.error}>{t("manage.actionFailed")}</span>}
      </div>
    </div>
  );
}

// ── I dag / dato ────────────────────────────────────────────────────────────

function DayTab() {
  const plan = selectedDayPlan.value;
  const date = selectedDate.value;

  return (
    <div class={styles.tabBody}>
      <div class={styles.dateNav}>
        <button
          class={styles.rowAction}
          aria-label={t("planner.prevDay")}
          title={t("planner.prevDay")}
          onClick={() => void selectDate(addDays(date, -1))}
        >
          <Icon name="chevron-up" size="sm" class={styles.rotateLeft} />
        </button>
        <b class={styles.dateLabel}>{date}</b>
        <button
          class={styles.rowAction}
          aria-label={t("planner.nextDay")}
          title={t("planner.nextDay")}
          onClick={() => void selectDate(addDays(date, 1))}
        >
          <Icon name="chevron-down" size="sm" class={styles.rotateLeft} />
        </button>
        <button
          class={styles.secondary}
          onClick={() => void selectDate(localDateStr(new Date()))}
        >
          {t("planner.today")}
        </button>
      </div>

      {!plan || plan.entries.length === 0 ? (
        <p class={styles.hint}>{t("planner.noPeriodsYet")}</p>
      ) : (
        plan.entries
          .filter((e) => e.period.kind === "lesson")
          .map((entry) => (
            <DayLesson key={entry.period.id} date={date} entry={entry} />
          ))
      )}

      {plan && <NotesEditor date={date} notes={plan.notes} />}
    </div>
  );
}

function DayLesson(props: { date: string; entry: DayEntry }) {
  const { period, lesson, agenda } = props.entry;
  const [editing, setEditing] = useState(false);

  return (
    <div class={styles.lessonCard}>
      <div class={styles.lessonHead}>
        <b>
          {period.label} · {formatMin(period.startMin)}–
          {formatMin(period.endMin)}
        </b>
        <span class={styles.lessonInfo}>
          {lesson ? (
            <>
              {lesson.className && <b>{lesson.className}</b>}{" "}
              {lesson.title || lesson.subject}
              {lesson.overridden && (
                <span class={styles.badge}>{t("planner.overriddenBadge")}</span>
              )}
            </>
          ) : (
            <span class={styles.cellEmpty}>{t("planner.free")}</span>
          )}
        </span>
        <button class={styles.secondary} onClick={() => setEditing(!editing)}>
          {lesson?.overridden
            ? t("planner.editOverride")
            : t("planner.override")}
        </button>
      </div>
      {editing && (
        <OverrideEditor
          date={props.date}
          periodId={period.id}
          onDone={() => setEditing(false)}
        />
      )}
      {lesson && (
        <AgendaEditor date={props.date} periodId={period.id} items={agenda} />
      )}
    </div>
  );
}

function OverrideEditor(props: {
  date: string;
  periodId: string;
  onDone: () => void;
}) {
  const [cancelled, setCancelled] = useState(false);
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState(false);

  const write = async (clear: boolean) => {
    setError(false);
    try {
      await window.api.plannerOverrideSet(
        props.date,
        props.periodId,
        clear
          ? null
          : {
              kind: cancelled ? "cancelled" : "lesson",
              classId: classId || null,
              subject,
              sceneId: sceneId || null,
              title,
            },
      );
      await plannerChanged();
      props.onDone();
    } catch (e) {
      console.warn("[planner] override save failed", e);
      setError(true);
    }
  };

  return (
    <div class={styles.editor}>
      <div class={styles.editorRow}>
        <label class={styles.checkRow}>
          <input
            type="checkbox"
            checked={cancelled}
            onChange={(e) =>
              setCancelled((e.target as HTMLInputElement).checked)
            }
          />
          {t("planner.cancelLesson")}
        </label>
      </div>
      {!cancelled && (
        <div class={styles.editorRow}>
          <label class={styles.field}>
            {t("planner.class")}
            <select
              aria-label={t("planner.class")}
              value={classId}
              onChange={(e) =>
                setClassId((e.target as HTMLSelectElement).value)
              }
            >
              <option value="">{t("planner.noClass")}</option>
              {classes.value.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label class={styles.field}>
            {t("planner.subject")}
            <input
              value={subject}
              onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class={styles.field}>
            {t("planner.overrideTitle")}
            <input
              value={title}
              placeholder={t("planner.overrideTitlePlaceholder")}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class={styles.field}>
            {t("planner.scene")}
            <select
              aria-label={t("planner.scene")}
              value={sceneId}
              onChange={(e) =>
                setSceneId((e.target as HTMLSelectElement).value)
              }
            >
              <option value="">{t("scene.default")}</option>
              {scenes.value.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div class={styles.actions}>
        <button class={styles.primary} onClick={() => void write(false)}>
          {t("planner.save")}
        </button>
        <button class={styles.secondary} onClick={() => void write(true)}>
          {t("planner.clearOverride")}
        </button>
        <button class={styles.secondary} onClick={props.onDone}>
          {t("manage.cancel")}
        </button>
        {error && <span class={styles.error}>{t("manage.actionFailed")}</span>}
      </div>
    </div>
  );
}

interface AgendaDraft {
  id: string | null;
  text: string;
  duration: string;
  done: boolean;
}

function AgendaEditor(props: {
  date: string;
  periodId: string;
  items: {
    id: string;
    text: string;
    durationMin: number | null;
    done: boolean;
  }[];
}) {
  const [drafts, setDrafts] = useState<AgendaDraft[] | null>(null);
  const [receipt, setReceipt] = useState(false);
  const [error, setError] = useState(false);
  const rows =
    drafts ??
    props.items.map((i) => ({
      id: i.id,
      text: i.text,
      duration: i.durationMin == null ? "" : String(i.durationMin),
      done: i.done,
    }));

  const edit = (i: number, patch: Partial<AgendaDraft>) => {
    setDrafts(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setReceipt(false);
  };

  const save = async () => {
    setError(false);
    try {
      await window.api.plannerAgendaSet(
        props.date,
        props.periodId,
        rows
          .filter((r) => r.text.trim() !== "")
          .map((r) => ({
            id: r.id,
            text: r.text.trim(),
            durationMin: r.duration.trim() === "" ? null : Number(r.duration),
            done: r.done,
          })),
      );
      setDrafts(null);
      setReceipt(true);
      await plannerChanged();
    } catch (e) {
      console.warn("[planner] agenda save failed", e);
      setError(true);
    }
  };

  return (
    <div class={styles.agenda}>
      <h4 class={styles.subHead}>{t("planner.agenda")}</h4>
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} class={styles.agendaRow}>
          <input
            class={styles.grow}
            aria-label={t("planner.activityPlaceholder")}
            placeholder={t("planner.activityPlaceholder")}
            value={r.text}
            onInput={(e) =>
              edit(i, { text: (e.target as HTMLInputElement).value })
            }
          />
          <input
            class={styles.time}
            aria-label={t("planner.minutes")}
            placeholder={t("planner.minutes")}
            inputMode="numeric"
            value={r.duration}
            onInput={(e) =>
              edit(i, {
                duration: (e.target as HTMLInputElement).value.replace(
                  /[^0-9]/g,
                  "",
                ),
              })
            }
          />
          <button
            class={styles.rowAction}
            aria-label={t("manage.delete")}
            title={t("manage.delete")}
            onClick={() => {
              setDrafts(rows.filter((_, j) => j !== i));
              setReceipt(false);
            }}
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      <div class={styles.actions}>
        <button
          class={styles.secondary}
          onClick={() => {
            setDrafts([
              ...rows,
              { id: null, text: "", duration: "", done: false },
            ]);
            setReceipt(false);
          }}
        >
          <Icon name="plus" size="sm" />
          {t("planner.addActivity")}
        </button>
        <button class={styles.primary} onClick={() => void save()}>
          {t("planner.saveAgenda")}
        </button>
        {receipt && (
          <span class={styles.receipt}>{t("manage.savedReceipt")}</span>
        )}
        {error && <span class={styles.error}>{t("manage.actionFailed")}</span>}
      </div>
    </div>
  );
}

function NotesEditor(props: {
  date: string;
  notes: { id: string; body: string }[];
}) {
  const [drafts, setDrafts] = useState<
    { id: string | null; body: string }[] | null
  >(null);
  const [receipt, setReceipt] = useState(false);
  const [error, setError] = useState(false);
  const rows = drafts ?? props.notes.map((n) => ({ id: n.id, body: n.body }));

  const save = async () => {
    setError(false);
    try {
      await window.api.plannerNotesSet(
        props.date,
        rows
          .filter((r) => r.body.trim() !== "")
          .map((r) => ({ id: r.id, body: r.body.trim() })),
      );
      setDrafts(null);
      setReceipt(true);
      await plannerChanged();
    } catch (e) {
      console.warn("[planner] notes save failed", e);
      setError(true);
    }
  };

  return (
    <div class={styles.lessonCard}>
      <h4 class={styles.subHead}>{t("planner.notes")}</h4>
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} class={styles.agendaRow}>
          <input
            class={styles.grow}
            aria-label={t("planner.notePlaceholder")}
            placeholder={t("planner.notePlaceholder")}
            value={r.body}
            onInput={(e) => {
              const body = (e.target as HTMLInputElement).value;
              setDrafts(rows.map((x, j) => (j === i ? { ...x, body } : x)));
              setReceipt(false);
            }}
          />
          <button
            class={styles.rowAction}
            aria-label={t("manage.delete")}
            title={t("manage.delete")}
            onClick={() => {
              setDrafts(rows.filter((_, j) => j !== i));
              setReceipt(false);
            }}
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      <div class={styles.actions}>
        <button
          class={styles.secondary}
          onClick={() => {
            setDrafts([...rows, { id: null, body: "" }]);
            setReceipt(false);
          }}
        >
          <Icon name="plus" size="sm" />
          {t("planner.addNote")}
        </button>
        <button class={styles.primary} onClick={() => void save()}>
          {t("planner.saveNotes")}
        </button>
        {receipt && (
          <span class={styles.receipt}>{t("manage.savedReceipt")}</span>
        )}
        {error && <span class={styles.error}>{t("manage.actionFailed")}</span>}
      </div>
    </div>
  );
}
