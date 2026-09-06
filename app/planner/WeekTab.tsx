// «Ukeplan» — the recurring weekday × period grid, and the editor one cell
// opens. Split out of PlannerPanel.tsx verbatim (R7 kodehelse #2).

import { Fragment } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type { Scene } from "../bindings/Scene";
import { t, tDyn, tf } from "../i18n";
import { classes } from "../state/classes";
import { enterDesign } from "../state/design-session";
import {
  periods,
  plannerChanged,
  plannerTab,
  weekSlots,
} from "../state/planner";
import { LIMITS } from "@lib/limits.generated";
import { formatMin } from "./date-core";
import { LESSON_WEEKDAYS, designTarget, sceneLabel } from "./planner-shared";
import { ScenePicker } from "./ScenePicker";
import styles from "./PlannerPanel.module.css";

export function WeekTab() {
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
   * Does a slot hold a lesson at all?
   *
   * The mirror of `effective_lesson` in schedule.rs:428 — «an empty slot is no
   * lesson», and empty there means BOTH fields blank, not either. A row with a
   * class and no subject is a lesson; so is one with a subject and no class.
   * `classId != null` rather than a truthiness test, because Rust's `Some("")`
   * is falsy in JS and the two halves must not disagree about a row nobody
   * would look at twice.
   */
  const slotHasLesson = (slot: { classId: string | null; subject: string }) =>
    slot.classId != null || slot.subject !== "";

  /**
   * Which cell is the TAIL of a weekly double lesson, and whose tail it is.
   *
   * The same walk `apply_merges` does in schedule.rs, over the lesson periods
   * in order so a break between the halves is stepped over: a filled slot that
   * claims `mergedWithNext` hands the NEXT lesson period to itself. The grid
   * cannot see date overrides — this is the recurring week — so the answer
   * here is the weekly truth, which is exactly what this tab edits.
   *
   * FILLED is half the rule, and the half this walk used to be missing (R6-F2).
   * `apply_merges` skips a merge whose head resolves to no lesson
   * (schedule.rs:389, «a cancelled or free A has nothing to run on: a flag left
   * on it is dangling, and dangling flags are ignored in silence») — and a flag
   * survives on an emptied row easily enough: the teacher clears the head's
   * fields and presses «Lagre» instead of «Tøm», and the checkbox is still
   * ticked because it was initialised from the row. The resolver then showed
   * the tail's own lesson while this grid drew it as a dimmed «fortsettelse»
   * of nothing — the grid lying about a lesson the day tab showed correctly.
   */
  const continuationHead = (
    weekday: number,
    periodId: string,
  ): string | null => {
    const i = lessons.findIndex((p) => p.id === periodId);
    if (i <= 0) return null;
    const head = slotFor(weekday, lessons[i - 1].id);
    if (!head || !head.mergedWithNext) return null;
    return slotHasLesson(head) ? head.periodId : null;
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

  /**
   * What one cell IS, said in one sentence (R7 a11y #6).
   *
   * Measured before: the filled cells announced «7B Norsk Standard» and the
   * other thirty-nine announced «—», which is not a word — no weekday, no
   * period, no clock. In a 5 × 8 grid that is the whole context gone. The form
   * is the editor's own heading plus what the cell holds, so the name a
   * screen reader hears when the cell is chosen and the heading it lands on
   * are the same sentence.
   */
  const cellLabel = (
    weekday: number,
    period: { id: string; label: string; startMin: number },
    head: string | null,
  ): string => {
    const slot = slotFor(weekday, period.id);
    const content =
      head != null
        ? tf("planner.continuationOf", {
            label: periods.value.find((p) => p.id === head)?.label ?? "",
          })
        : slot && slotHasLesson(slot)
          ? `${classes.value.find((c) => c.id === slot.classId)?.name ?? ""} ${
              slot.subject
            } · ${sceneLabel(slot.sceneId)}`.trim()
          : // «—» is unpronounceable; the day tab's own word for the same
            // state is not.
            t("planner.free");
    return tf("planner.cellLabel", {
      day: tDyn("planner.weekday", String(weekday)),
      period: period.label,
      time: formatMin(period.startMin),
      content,
    });
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
                    aria-label={cellLabel(d, p, head)}
                    data-current={active || undefined}
                    /* Dimmed, and still a button: the second half of a double
                       lesson is where a teacher goes to take it apart again,
                       so the way in must not be the one thing the merge
                       removes. */
                    data-continuation={head != null || undefined}
                    onClick={() => setCell({ weekday: d, periodId: p.id })}
                  >
                    {head != null ? (
                      /* Standalone, so it says fortsettelse OF WHAT: this is a
                         5 × 8 grid, and «fortsettelse» alone made the teacher
                         look up the row above to find out. The day tab's line
                         keeps the bare word — there it stands next to the
                         period's own times, as an apposition. */
                      <span class={styles.cellEmpty}>
                        {tf("planner.continuationOf", {
                          label:
                            periods.value.find((p) => p.id === head)?.label ??
                            "",
                        })}
                      </span>
                    ) : /* A saved row with both fields blank is NOT a lesson —
                          `effective_lesson` says so (schedule.rs:428), and a
                          cell that renders it as an empty card while the day
                          tab shows nothing there is the same divergence
                          `continuationHead` above just stopped telling. */
                    slot && slotHasLesson(slot) ? (
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

  /**
   * The keyboard follows the choice into the editor (R7 a11y #6, second half).
   *
   * The editor is mounted AFTER all forty cells, so Tab from Monday's cell
   * used to walk the whole week before reaching the form the click just
   * opened. `DieLookMenu`'s pattern, deliberately: focus the first field on
   * mount, `preventScroll` so the grid does not jump under the mouse user who
   * will never notice this ran. The `key` on the element is `weekday:periodId`,
   * so picking ANOTHER cell remounts this component and the effect runs again
   * — which is why a mount-only effect is enough.
   *
   * No focus RETURN on unmount, unlike the menu: leaving the editor is
   * «Lagre»/«Avbryt», the cell behind may have been re-rendered into a
   * different label, and yanking the keyboard back to the grid after a save
   * would undo the very thing this fixes.
   */
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  useLayoutEffect(() => {
    firstFieldRef.current?.focus({ preventScroll: true });
  }, []);

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
    // `null` = «the class's default screen» — never a guess about WHICH one:
    // ScenePicker disables the button when there is no class to have a default.
    const target = await designTarget(scene, classId || null);
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
            ref={firstFieldRef}
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
