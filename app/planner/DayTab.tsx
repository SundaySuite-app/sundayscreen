// «I dag» — one date's resolved lessons, its deviations, its agendas and its
// messages. Split out of PlannerPanel.tsx verbatim (R7 kodehelse #2).

import { useState } from "preact/hooks";

import type { DayEntry } from "../bindings/DayEntry";
import type { DayPlan } from "../bindings/DayPlan";
import type { LessonInfo } from "../bindings/LessonInfo";
import type { OverrideSpec } from "../bindings/OverrideSpec";
import type { Scene } from "../bindings/Scene";
import { t, tf } from "../i18n";
import { classes } from "../state/classes";
import { enterDesign } from "../state/design-session";
import {
  dayReadFailed,
  plannerChanged,
  selectDate,
  selectedDate,
  selectedDayPlan,
} from "../state/planner";
import { blockSpan } from "../widgets/agenda/agenda-widget-core";
import { Icon } from "../ui/Icon";
import { LIMITS } from "@lib/limits.generated";
import { addDays, formatMin, localDateStr } from "./date-core";
import { HEAD_THUMB_SIZE, designTarget, humanDate } from "./planner-shared";
import { ScenePicker } from "./ScenePicker";
import { SceneThumb } from "./SceneThumb";
import styles from "./PlannerPanel.module.css";

export function DayTab() {
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

      {/* A FAILED read is not an empty day. `selectedDayPlan` goes null both
          ways, so this tab used to answer a transient IPC hiccup with «Ingen
          økter definert ennå — start i Timeoppsett-fanen» and send the
          teacher to a tab where her template already stands (R7 skjøt #3 —
          the F13 lie, one surface up). The read's own flag separates them,
          and the way out of a hiccup is to read again. */}
      {dayReadFailed.value ? (
        <>
          <p class={styles.hint}>{t("planner.readFailed")}</p>
          <div class={styles.actions}>
            <button
              class={styles.secondary}
              onClick={() => void selectDate(selectedDate.peek())}
            >
              {t("planner.retry")}
            </button>
          </div>
        </>
      ) : !plan || plan.entries.length === 0 ? (
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
  /**
   * Is this period CANCELLED today?
   *
   * `lesson` is `null` for a cancelled period and for a free one alike, so the
   * card had no way to say «Utgår» and said «Ingen time» for both (R7 skjøt
   * #1). The RAW row kind is the difference, and it decides three things
   * below: the badge, the button's wording, and what the editor opens with.
   */
  const cancelled = props.entry.overrideKind === "cancelled";
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
            <>
              <span class={styles.cellEmpty}>{t("planner.free")}</span>
              {/* «Ingen time» is what a FREE period says too. The badge is
                  the whole difference between «nobody planned anything here»
                  and «the teacher cancelled this» — and it is what tells her
                  the row already carries a decision before she opens the
                  editor and presses Lagre on it. */}
              {cancelled && (
                <span class={styles.badge}>{t("planner.cancelledBadge")}</span>
              )}
            </>
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
        {/* A cancelled period has a deviation standing on it just as much as
            an overridden one does — «Overstyr» invited the teacher to create
            what was already there. */}
        <button class={styles.secondary} onClick={() => setEditing(!editing)}>
          {lesson?.overridden || cancelled
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
          storedCancelled={cancelled}
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
  /**
   * Is the row this form rewrites a CANCELLED one? (`DayEntry.overrideKind`,
   * RAW — the sister of `storedMergedWithNext` above, and the same failure
   * mode: `planner_override_set` is a replace, so a form that opens with the
   * box unticked writes `kind = Lesson` back the moment Lagre is pressed, and
   * the cancellation is gone without a word. R7 skjøt #1.)
   */
  storedCancelled: boolean;
  onDone: () => void;
}) {
  const [cancelled, setCancelled] = useState(props.storedCancelled);
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
    const target = await designTarget(scene, defaultOwner);
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
            {/* The last free-text field on this surface without a ceiling
                (R7 skjøt #5). It becomes the day card's heading, the banner's
                text and the «Dagens time» label, so a pasted lesson plan here
                is persisted and restored at every boot. `override_set_for`
                clamps it too — the input is the courtesy, the store is the
                rule. */}
            <input
              value={title}
              placeholder={t("planner.overrideTitlePlaceholder")}
              maxLength={LIMITS.LABEL_MAX_CHARS}
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
          {/* Named, like every other row control in the app (R7 a11y #8) —
              «Slett, Slett, Slett» down an activity list says nothing about
              which activity. An untyped row keeps the bare word. */}
          <button
            class={styles.rowAction}
            aria-label={
              r.text.trim() === ""
                ? t("manage.delete")
                : tf("planner.removeActivityNamed", { name: r.text })
            }
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
        {/* Mounted empty: a live region announces only what changes INSIDE
            it, so one that appears with its text already in place says
            nothing (ManagePanel keeps its receipt the same way). */}
        <span class={styles.receipt} role="status">
          {receipt ? t("manage.savedReceipt") : ""}
        </span>
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
          {/* Same rule for the day's messages (R7 a11y #8). */}
          <button
            class={styles.rowAction}
            aria-label={
              r.body.trim() === ""
                ? t("manage.delete")
                : tf("planner.removeNoteNamed", { name: r.body })
            }
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
        {/* Mounted empty: a live region announces only what changes INSIDE
            it, so one that appears with its text already in place says
            nothing (ManagePanel keeps its receipt the same way). */}
        <span class={styles.receipt} role="status">
          {receipt ? t("manage.savedReceipt") : ""}
        </span>
        {error && <span class={styles.error}>{t("manage.actionFailed")}</span>}
      </div>
    </div>
  );
}
