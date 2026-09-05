// The planner: a full-screen overlay (ManagePanel pattern) with three tabs —
// Timeoppsett (the school day's period template, defined once), Ukeplan (the
// recurring weekday × period grid) and I dag (a date's overrides, agendas
// and notes). All decisions live in cores/backed commands; this file is
// forms.

import { Fragment } from "preact";
import { useState } from "preact/hooks";

import type { DayEntry } from "../bindings/DayEntry";
import type { DayPlan } from "../bindings/DayPlan";
import type { LessonInfo } from "../bindings/LessonInfo";
import type { OverrideSpec } from "../bindings/OverrideSpec";
import type { Period } from "../bindings/Period";
import type { PeriodKind } from "../bindings/PeriodKind";
import type { Scene } from "../bindings/Scene";
import { t, tDyn, tf } from "../i18n";
import { classes } from "../state/classes";
import { designSession, enterDesign } from "../state/design-session";
import {
  closePlanner,
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
import { blockSpan } from "../widgets/agenda/agenda-widget-core";
import { toast } from "../ui/toast";
import { Icon } from "../ui/Icon";
import { localeTag } from "@lib/i18n";
import { LIMITS } from "@lib/limits.generated";
import { defaultSceneId } from "@lib/scene-ids";
import {
  addDays,
  dateAtNoon,
  formatMin,
  localDateStr,
  parseTime,
} from "./date-core";
import { DesignPanel } from "./DesignPanel";
import { ScenePicker } from "./ScenePicker";
import { SceneThumb } from "./SceneThumb";
import styles from "./PlannerPanel.module.css";

/** What the «Timelengde» row offers. A DESIGN list, not a protocol: the
 *  store accepts anything in LIMITS.LESSON_MINUTES_MIN..MAX, and a stored
 *  value outside this list (a future version's 90) simply renders with no
 *  pill ticked — the row is an offer, never a validator. */
const LESSON_MINUTE_OPTIONS: readonly number[] = [30, 45, 60];

const LESSON_WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** «mandag 31. august» — the key stays in a data attribute for tests
 *  (F-funn C4: the raw ISO key was shown to teachers). */
function humanDate(date: string): string {
  return new Intl.DateTimeFormat(localeTag(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateAtNoon(date));
}

/** The picture next to a lesson: small enough to sit in a header row without
 *  pushing the buttons onto a second line. */
const HEAD_THUMB_SIZE = { w: 64, h: 40 };

/** What screen a lesson points at, by NAME. `null` — and an id the library no
 *  longer holds, which the `ON DELETE SET NULL` in 0003 makes a transient
 *  state rather than a stored one — is the class's default screen, which is
 *  also what the resolver falls back to. */
function sceneLabel(sceneId: string | null): string {
  if (sceneId == null) return t("scene.default");
  return scenes.value.find((s) => s.id === sceneId)?.name ?? t("scene.default");
}

/**
 * The `Scene` object for a class's DEFAULT screen.
 *
 * Class defaults deliberately live outside `scene_list` (commands/scenes.rs),
 * so there is no row to look up and the design session's write key has to be
 * synthesised. Only `id` is load-bearing — it is the key every `layout_save`
 * in the session carries — and `name` reaches the panel header. `theme` is a
 * KNOWN LIE: the stored backdrop is not readable from here, so the little
 * board draws the standard one. It is never persisted (the session writes
 * widgets, never the scene row), and designing the screen that is already on
 * the projector takes the same-scene path in `enterDesign`, where the REAL
 * object is used instead of this one.
 */
function defaultSceneFor(classId: string): Scene | null {
  const cls = classes.peek().find((c) => c.id === classId);
  if (!cls) return null;
  return {
    id: defaultSceneId(classId),
    classId,
    name: cls.name,
    sortIndex: 0,
    createdAt: 0,
    theme: "standard",
  };
}

export function PlannerPanel() {
  if (!plannerPanelOpen.value) return null;
  const tab = plannerTab.value;
  const designing = designSession.value !== null;

  return (
    <div class={styles.scrim}>
      <section class={styles.panel} aria-label={t("planner.title")}>
        <header class={styles.header}>
          <h2 class={styles.title}>{t("planner.title")}</h2>
          {/* The tabs go away while a design session runs. Not decoration: a
              tab press unmounts the body the session's `<Surface/>` lives in,
              and the board would vanish from under the teacher's hands while
              the globals are still borrowed. The spacer keeps the close button
              where it has always been. */}
          {designing ? (
            <span class={styles.spacer} />
          ) : (
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
          )}
          <button
            class={styles.close}
            aria-label={t("manage.close")}
            /* THE one door out (state/planner.ts): it exits the design session
               — flushing the design scene and handing the board back — before
               the panel goes away. Async, so a bare call would close the panel
               with the borrow still standing. */
            onClick={() => void closePlanner()}
          >
            <Icon name="close" size="md" />
          </button>
        </header>

        {/* The design panel is rendered OUTSIDE the hydration gate. A planner
            read that fails mid-session (a `refreshPlanner` retry landing on a
            dead backend) would otherwise unmount the borrowed `<Surface/>`
            and leave the teacher looking at «redigering er sperret» with the
            projector's globals still lent out. */}
        {!plannerHydrated.value && !designing ? (
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
            {designing ? (
              <DesignPanel />
            ) : (
              <>
                {tab === "periods" && <PeriodsTab />}
                {tab === "week" && <WeekTab />}
                {tab === "day" && <DayTab />}
              </>
            )}
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

  /**
   * Append a row of `kind`. Both buttons run through here, and both rely on
   * behaviour that was ALREADY break-safe and is only verified here:
   *   - the chain takes the previous row's END whatever kind it was, so a
   *     break slots in between two lessons without a gap;
   *   - the lesson number counts LESSON rows only, so inserting a break
   *     never bumps «Time 3» to «Time 4».
   * No «suggest a normal school day» button: invented bell times that look
   * authoritative are worse than empty rows.
   */
  const addRow = (kind: PeriodKind) => {
    const last = rows[rows.length - 1];
    const start = last ? last.end : "08:30";
    const startMin = parseTime(start) ?? 510;
    // The SCHOOL's lesson length (settings.rs::lesson_minutes) — the whole
    // point of the «Timelengde» row below: pick 30/45/60 once and every
    // press of «Legg til time» spans it. Breaks stay 15; nobody schedules
    // a school around the length of a friminutt.
    const minutes = kind === "lesson" ? settings.peek().lessonMinutes : 15;
    setDrafts([
      ...rows,
      {
        id: null,
        label:
          kind === "lesson"
            ? tf("planner.defaultPeriodLabel", {
                n: String(rows.filter((r) => r.kind === "lesson").length + 1),
              })
            : t("planner.defaultBreakLabel"),
        start,
        end: formatMin(Math.min(startMin + minutes, 1439)),
        kind,
      },
    ]);
    setReceipt(false);
  };

  const save = async () => {
    setError(null);
    const specs = [];
    for (const r of rows) {
      const start = parseTime(r.start);
      const end = parseTime(r.end);
      // An empty label used to SKIP the row — and replace-all then deleted
      // the period with its whole week (F-funn F3). Refuse instead.
      if (r.label.trim() === "") {
        setError(t("planner.emptyLabel"));
        return;
      }
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
            maxLength={LIMITS.LABEL_MAX_CHARS}
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
      {/* The school's lesson length — a fact about the SCHOOL, so it lives
          in settings and survives restarts, not in this editing session.
          Three offered values because Norwegian schools run 30-, 45- or
          60-minute lessons; the store itself takes any sane number
          (LESSON_MINUTES_MIN..MAX), so a school with block lessons is a
          future option away, not a schema change. Applies to NEW rows only:
          re-fitting existing times under the teacher's hands would be the
          same shape as the seed overwriting her typing. */}
      <div class={styles.lengthRow}>
        <span class={styles.lengthLabel}>
          {t("planner.lessonMinutes")}
          {/* A stored value OUTSIDE the offered three (a clamped hand-edit,
              a future version's 90) ticks no pill — and a row that then
              says nothing about what «Legg til time» will do is a label
              posing a question it refuses to answer. The odd value moves
              into the label; the offered three never repeat there. */}
          {!LESSON_MINUTE_OPTIONS.includes(settings.value.lessonMinutes) &&
            ` — ${tf("planner.minutePill", {
              n: String(settings.value.lessonMinutes),
            })}`}
        </span>
        {LESSON_MINUTE_OPTIONS.map((m) => (
          <button
            key={m}
            class={styles.pill}
            data-current={settings.value.lessonMinutes === m || undefined}
            onClick={() => {
              const prev = settings.peek();
              settings.value = { ...prev, lessonMinutes: m };
              window.api
                .saveSettings({ ...prev, lessonMinutes: m })
                .then((stored) => {
                  // Adopt the CLAMPED answer, the settingsSetWindow rule:
                  // today {30,45,60} ⊂ [MIN,MAX] makes this a no-op, but
                  // nothing guards that containment, and a signal that keeps
                  // what it sent is how the pill and the disk drift apart.
                  settings.value = stored;
                })
                .catch((err) => {
                  console.warn("[planner] lesson-length save failed", err);
                  settings.value = prev;
                  toast("error", t("manage.actionFailed"));
                });
            }}
          >
            {tf("planner.minutePill", { n: String(m) })}
          </button>
        ))}
      </div>
      <div class={styles.actions}>
        <button class={styles.secondary} onClick={() => addRow("lesson")}>
          <Icon name="plus" size="sm" />
          {t("planner.addPeriod")}
        </button>
        <button class={styles.secondary} onClick={() => addRow("break")}>
          <Icon name="plus" size="sm" />
          {t("planner.addBreak")}
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

  /**
   * Which cell is the TAIL of a weekly double lesson, and whose tail it is.
   *
   * The same walk `apply_merges` does in schedule.rs, over the lesson periods
   * in order so a break between the halves is stepped over: a filled slot that
   * claims `mergedWithNext` hands the NEXT lesson period to itself. The grid
   * cannot see date overrides — this is the recurring week — so the answer
   * here is the weekly truth, which is exactly what this tab edits.
   */
  const continuationHead = (
    weekday: number,
    periodId: string,
  ): string | null => {
    const i = lessons.findIndex((p) => p.id === periodId);
    if (i <= 0) return null;
    const head = slotFor(weekday, lessons[i - 1].id);
    return head && head.mergedWithNext ? head.periodId : null;
  };

  /**
   * Is there a later lesson period to merge into at all?
   *
   * «Slå sammen med neste time» is only offered where the answer is yes: a
   * flag on the day's last lesson is dangling, and the resolver ignores it in
   * silence — an offer whose answer is nothing is worse than no offer. A
   * `findIndex` miss must not read as «there is a next one», hence the lower
   * bound.
   */
  const hasNextLesson = (periodId: string): boolean => {
    const i = lessons.findIndex((p) => p.id === periodId);
    return i >= 0 && i < lessons.length - 1;
  };

  return (
    <div class={styles.tabBody}>
      {lessons.length === 0 ? (
        <>
          <p class={styles.hint}>{t("planner.noPeriodsYet")}</p>
          {/* The way out, in the ONE place it is always true. The key is
           * shared with DayTab, which shows it on weekends too — a shared
           * button component would offer «Start i Timeoppsett» on a
           * Saturday, where the day simply has no lessons. */}
          <div class={styles.actions}>
            <button
              class={styles.secondary}
              onClick={() => {
                plannerTab.value = "periods";
              }}
            >
              {t("planner.goToPeriods")}
            </button>
          </div>
        </>
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
            <Fragment key={p.id}>
              <span class={styles.periodHead}>
                <b>{p.label}</b>
                <small>{formatMin(p.startMin)}</small>
              </span>
              {LESSON_WEEKDAYS.map((d) => {
                const slot = slotFor(d, p.id);
                const active = cell?.weekday === d && cell.periodId === p.id;
                const head = continuationHead(d, p.id);
                return (
                  <button
                    key={`${p.id}-${d}`}
                    class={styles.cell}
                    data-current={active || undefined}
                    /* Dimmed, and still a button: the second half of a double
                       lesson is where a teacher goes to take it apart again,
                       so the way in must not be the one thing the merge
                       removes. */
                    data-continuation={head != null || undefined}
                    onClick={() => setCell({ weekday: d, periodId: p.id })}
                  >
                    {head != null ? (
                      <span class={styles.cellEmpty}>
                        {t("planner.mergedContinuation")}
                      </span>
                    ) : slot ? (
                      <>
                        <b>
                          {classes.value.find((c) => c.id === slot.classId)
                            ?.name ?? ""}
                        </b>
                        <small>{slot.subject}</small>
                        {/* Which SCREEN this lesson lands on — the field that
                            has been stored since 0003 and shown nowhere. */}
                        <small class={styles.cellScene}>
                          {sceneLabel(slot.sceneId)}
                        </small>
                      </>
                    ) : (
                      <span class={styles.cellEmpty}>—</span>
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
      {cell && (
        <CellEditor
          key={`${cell.weekday}:${cell.periodId}`}
          weekday={cell.weekday}
          periodId={cell.periodId}
          continuationOf={continuationHead(cell.weekday, cell.periodId)}
          hasNextLesson={hasNextLesson(cell.periodId)}
          onDone={() => setCell(null)}
        />
      )}
    </div>
  );
}

function CellEditor(props: {
  weekday: number;
  periodId: string;
  /** The period whose double lesson SHADOWS this cell, or `null`. Set means
   *  the teacher is standing in the second half of a double lesson, and the
   *  action she needs here is «Del opp» — on the HEAD's slot, not this one. */
  continuationOf: string | null;
  /** Is there a later lesson period to merge into at all? */
  hasNextLesson: boolean;
  onDone: () => void;
}) {
  const existing = weekSlots.value.find(
    (s) => s.weekday === props.weekday && s.periodId === props.periodId,
  );
  const [classId, setClassId] = useState<string>(existing?.classId ?? "");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [sceneId, setSceneId] = useState<string>(existing?.sceneId ?? "");
  const [merged, setMerged] = useState(existing?.mergedWithNext ?? false);
  const [error, setError] = useState(false);

  /** The draft as a `SlotSpec`. One place, because «Lagre» and «Design» must
   *  write the SAME thing — a Design button that saved a different shape than
   *  the save button is a divergence nobody would look for. */
  const draft = () => ({
    classId: classId || null,
    subject,
    sceneId: sceneId || null,
    mergedWithNext: merged,
  });

  /** Write a slot and re-read. Returns whether it landed — «Design» must not
   *  borrow the board on top of a save that REJECTED. */
  const save = async (
    weekday: number,
    periodId: string,
    slot: {
      classId: string | null;
      subject: string;
      sceneId: string | null;
      mergedWithNext?: boolean;
    } | null,
  ): Promise<boolean> => {
    setError(false);
    try {
      await window.api.plannerSlotSet(weekday, periodId, slot);
      weekSlots.value = await window.api.plannerWeekGet();
      await plannerChanged();
      return true;
    } catch (e) {
      console.warn("[planner] slot save failed", e);
      setError(true);
      return false;
    }
  };

  const write = async (slot: ReturnType<typeof draft> | null) => {
    if (await save(props.weekday, props.periodId, slot)) props.onDone();
  };

  /**
   * «Design skjermen»: SAVE FIRST, then borrow the board.
   *
   * The design session unmounts this editor (the panel body becomes the little
   * board), so anything typed and not written would be gone when the teacher
   * came back — and the screen she is about to design would be one the lesson
   * does not point at yet. A rejected save stops here with the error standing;
   * entering the session anyway would be the fabricated success promise 4
   * forbids, one surface removed.
   */
  const design = async (scene: Scene | null) => {
    if (!(await save(props.weekday, props.periodId, draft()))) return;
    // `null` = «the class's default screen» — never a guess: ScenePicker
    // disables the button when there is no class to have a default.
    const target = scene ?? (classId ? defaultSceneFor(classId) : null);
    if (!target) return;
    await enterDesign(target);
  };

  /** Take the double lesson apart from its HEAD. This cell's own row is
   *  untouched: it was only shadowed, and it comes back the moment the flag
   *  above it goes down. */
  const split = async () => {
    const headId = props.continuationOf;
    if (headId == null) return;
    const head = weekSlots.value.find(
      (s) => s.weekday === props.weekday && s.periodId === headId,
    );
    if (!head) return;
    if (
      await save(props.weekday, headId, {
        classId: head.classId,
        subject: head.subject,
        sceneId: head.sceneId,
        mergedWithNext: false,
      })
    ) {
      props.onDone();
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
          {/* The cap the EXPORT enforces (`slotSubject` ≤ LABEL_MAX_CHARS in
              transfer.rs), so a subject typed past it here would make the
              teacher's own «Eksporter oppsett …» refuse the whole file later,
              naming a field she has long forgotten (E2-2). Stop it at the
              keyboard instead. */}
          <input
            value={subject}
            placeholder={t("planner.subjectPlaceholder")}
            maxLength={LIMITS.LABEL_MAX_CHARS}
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          />
        </label>
        <ScenePicker
          value={sceneId || null}
          onChange={(id) => setSceneId(id ?? "")}
          onDesign={(scene) => void design(scene)}
          classIdForDefault={classId || null}
        />
      </div>
      {props.hasNextLesson && (
        <label class={styles.checkRow}>
          <input
            type="checkbox"
            checked={merged}
            onChange={(e) => setMerged((e.target as HTMLInputElement).checked)}
          />
          {t("planner.doubleLesson")}
        </label>
      )}
      <div class={styles.actions}>
        <button class={styles.primary} onClick={() => void write(draft())}>
          {t("planner.save")}
        </button>
        <button class={styles.secondary} onClick={() => void write(null)}>
          {t("planner.clear")}
        </button>
        {props.continuationOf != null && (
          <button class={styles.secondary} onClick={() => void split()}>
            {t("planner.splitLesson")}
          </button>
        )}
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
          <Icon name="chevron-up" size="sm" class={styles.prevIcon} />
        </button>
        <b class={styles.dateLabel} data-date={date}>
          {humanDate(date)}
        </b>
        <button
          class={styles.rowAction}
          aria-label={t("planner.nextDay")}
          title={t("planner.nextDay")}
          onClick={() => void selectDate(addDays(date, 1))}
        >
          <Icon name="chevron-down" size="sm" class={styles.nextIcon} />
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
          .map((entry) =>
            // The tail of a double lesson is the SAME lesson, already drawn
            // above: a second full card would say the class has Norsk twice.
            // It collapses to a line that says where it went — and keeps its
            // own agenda rows visible if it has any, because rows typed under
            // this period's key before the merge are data, not noise.
            entry.continuation ? (
              <DayContinuation
                key={`${date}:${entry.period.id}`}
                date={date}
                entry={entry}
              />
            ) : (
              <DayLesson
                key={`${date}:${entry.period.id}`}
                date={date}
                entry={entry}
                plan={plan}
              />
            ),
          )
      )}

      {plan && <NotesEditor key={date} date={date} notes={plan.notes} />}
    </div>
  );
}

/**
 * The second half of a double lesson: one slim line, not a card.
 *
 * It carries the period's OWN clock times rather than the block's, because
 * that is what makes the line answer the question a teacher asks here — «what
 * happened to 10:15?» — instead of repeating the head's answer.
 */
function DayContinuation(props: { date: string; entry: DayEntry }) {
  const { period, agenda } = props.entry;
  return (
    <div class={styles.continuationCard}>
      <div class={styles.continuationRow}>
        <b>
          {period.label} · {formatMin(period.startMin)}–
          {formatMin(period.endMin)}
        </b>
        <span class={styles.cellEmpty}>{t("planner.mergedContinuation")}</span>
      </div>
      {/* Rows stored under THIS period's key — typed before the halves were
          joined — stay where the teacher typed them. The block's own list
          lives on the head (`agendaEntryForBlock`); hiding these would be
          data the app knows about and does not show. */}
      {agenda.length > 0 && (
        <AgendaEditor date={props.date} periodId={period.id} items={agenda} />
      )}
    </div>
  );
}

/** Is there a later LESSON period in this day at all — i.e. anything for a
 *  merge to reach? Mirrors the resolver's forward walk over lesson periods. */
function hasLaterLesson(plan: DayPlan, entry: DayEntry): boolean {
  const lessons = plan.entries.filter((e) => e.period.kind === "lesson");
  const i = lessons.findIndex((e) => e.period.id === entry.period.id);
  return i >= 0 && i < lessons.length - 1;
}

function DayLesson(props: { date: string; entry: DayEntry; plan: DayPlan }) {
  const { period, lesson, agenda } = props.entry;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const merged = props.entry.mergedWithNext === true;
  // The BLOCK's span: across a double lesson the head card has to say
  // 08:30–10:00, or the card names a lesson that is still running after the
  // time it prints. Collapses to the period's own times for a single lesson.
  const span = blockSpan(props.plan, props.entry);

  /**
   * «Slå sammen med neste i dag» / «Del opp i dag» — for THIS date only.
   *
   * Written as a FLAG CARRIER (schedule.rs `is_flag_carrier`): an override row
   * whose content fields are all empty, so the resolver still reads the
   * lesson's content from the weekly plan and `overridden` stays false. The
   * alternative — copying the week's content into the date — would fork the
   * lesson silently, and next week's change to the weekly plan would stop
   * reaching today.
   *
   * Unless a REAL override is already standing here: then the flag goes ON
   * THAT ROW, fields and all. Clearing its fields to make a carrier would
   * throw away the deviation the teacher typed.
   */
  const setMerge = async (flag: boolean) => {
    setError(false);
    const spec: OverrideSpec =
      lesson && lesson.overridden
        ? {
            kind: "lesson",
            classId: lesson.classId,
            subject: lesson.subject,
            sceneId: lesson.sceneId,
            title: lesson.title,
            mergedWithNext: flag,
          }
        : {
            kind: "lesson",
            classId: null,
            subject: "",
            sceneId: null,
            title: "",
            mergedWithNext: flag,
          };
    try {
      await window.api.plannerOverrideSet(props.date, period.id, spec);
      await plannerChanged();
    } catch (e) {
      console.warn("[planner] merge toggle failed", e);
      setError(true);
    }
  };

  return (
    <div class={styles.lessonCard}>
      <div class={styles.lessonHead}>
        <b>
          {period.label} · {formatMin(span.startMin)}–{formatMin(span.endMin)}
        </b>
        {merged && <span class={styles.badge}>{t("planner.mergedBadge")}</span>}
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
        {/* Which screen the class will be looking at — the name the resolver
            already joined in, plus the picture, because three screen names are
            three words. */}
        {lesson && (
          <span class={styles.lessonScene}>
            <SceneThumb
              sceneId={lesson.sceneId}
              classIdForDefault={lesson.classId}
              size={HEAD_THUMB_SIZE}
            />
            <small>{lesson.sceneName ?? t("scene.default")}</small>
          </span>
        )}
        {lesson && (merged || hasLaterLesson(props.plan, props.entry)) && (
          <button
            class={styles.secondary}
            onClick={() => void setMerge(!merged)}
          >
            {merged
              ? t("planner.splitLessonToday")
              : t("planner.mergeLessonToday")}
          </button>
        )}
        <button class={styles.secondary} onClick={() => setEditing(!editing)}>
          {lesson?.overridden
            ? t("planner.editOverride")
            : t("planner.override")}
        </button>
        {error && <span class={styles.error}>{t("manage.actionFailed")}</span>}
      </div>
      {editing && (
        <OverrideEditor
          date={props.date}
          periodId={period.id}
          existing={lesson?.overridden ? lesson : null}
          lessonClassId={lesson?.classId ?? null}
          storedMergedWithNext={props.entry.overrideMergedWithNext ?? null}
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
  /** The override already on this lesson, so editing REFINES it instead of
   *  silently replacing it with blanks (F-funn F12). */
  existing: LessonInfo | null;
  /**
   * The RESOLVED lesson's class — whose default screen «Standard» means here.
   * Read-only context for the picture and for «Design skjermen»: it is never
   * written. A fresh override starts with an empty class field on purpose (an
   * override the teacher did not ask for is not written by opening the form),
   * and without this the one screen she is most likely to want to design — the
   * one the class is on all week — would have no name to look up.
   */
  lessonClassId: string | null;
  /**
   * The override ROW's own stored tri-state (`DayEntry.overrideMergedWithNext`
   * — RAW, not the resolved answer). `planner_override_set` is a replace, so
   * this editor rewrites the WHOLE row — and a rewrite that cannot see the
   * stored merge decision rewrites it as «inherit», which is how saving a
   * title used to silently undo «Slå sammen med neste i dag» (F-R6-1).
   * Round-tripped verbatim below; the merge buttons on the day card remain
   * the only writers that CHANGE it.
   */
  storedMergedWithNext: boolean | null;
  onDone: () => void;
}) {
  const [cancelled, setCancelled] = useState(false);
  const [classId, setClassId] = useState(props.existing?.classId ?? "");
  const [subject, setSubject] = useState(props.existing?.subject ?? "");
  const [sceneId, setSceneId] = useState(props.existing?.sceneId ?? "");
  const [title, setTitle] = useState(props.existing?.title ?? "");
  const [error, setError] = useState(false);

  const save = async (clear: boolean): Promise<boolean> => {
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
              // Verbatim round-trip — see the prop's docstring.
              mergedWithNext: props.storedMergedWithNext,
            },
      );
      await plannerChanged();
      return true;
    } catch (e) {
      console.warn("[planner] override save failed", e);
      setError(true);
      return false;
    }
  };

  const write = async (clear: boolean) => {
    if (await save(clear)) props.onDone();
  };

  /** Whose default screen «Standard» is on this date: what the teacher typed
   *  into the form, else the lesson the day already resolves to. */
  const defaultOwner = classId || props.lessonClassId || null;

  /** Same rule as the week grid's: the deviation is WRITTEN before the board
   *  is borrowed, so the session cannot be the moment a half-typed override
   *  is lost — and a rejected write stops the session from opening at all. */
  const design = async (scene: Scene | null) => {
    if (!(await save(false))) return;
    const target =
      scene ?? (defaultOwner ? defaultSceneFor(defaultOwner) : null);
    if (!target) return;
    await enterDesign(target);
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
            {/* Same cap as the week grid's subject: one field, one limit,
                whichever tab it is typed in. */}
            <input
              value={subject}
              maxLength={LIMITS.LABEL_MAX_CHARS}
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
          <ScenePicker
            value={sceneId || null}
            onChange={(id) => setSceneId(id ?? "")}
            onDesign={(scene) => void design(scene)}
            classIdForDefault={defaultOwner}
          />
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
            maxLength={LIMITS.TEXT_MAX_CHARS}
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
        {/* The board's agenda widget stops at AGENDA_MAX_ITEMS and says so by
            going dead (F-funn F10). The PANEL let the teacher type line 31 and
            press save, and `planner_agenda_set` truncated it away without a
            word — the same lie, one surface further from the pupils (E2-16).
            Same limit, same disabled pattern. */}
        <button
          class={styles.secondary}
          disabled={rows.length >= LIMITS.AGENDA_MAX_ITEMS}
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
            maxLength={LIMITS.TEXT_MAX_CHARS}
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
        {/* `planner_notes_set` keeps the first NOTES_MAX and drops the rest,
            silently — so the button stops where the backend does (E2-16). */}
        <button
          class={styles.secondary}
          disabled={rows.length >= LIMITS.NOTES_MAX}
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
