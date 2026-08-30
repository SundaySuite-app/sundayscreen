// The lesson-start suggestion — pure. The banner only RENDERS what this
// returns; pointers move only on the teacher's click or (opt-in) the
// auto-switch. One suggestion key per lesson-instance (`date:periodId`)
// makes both the «Ikke nå» dismissal and the auto-switch's fire-once guard
// structural.

import type { DayPlan } from "../bindings/DayPlan";
import { defaultSceneId } from "../lib/scene-ids";

/** Minutes before a lesson's start the suggestion window opens. */
export const SUGGEST_LEAD_MIN = 5;

export interface Suggestion {
  /** `date:periodId` — stable for the lesson-instance. */
  key: string;
  classId: string;
  /** `null` = the class's default scene. */
  sceneId: string | null;
  className: string;
  /** What to show after the class name: title > subject > period label. */
  label: string;
  startMin: number;
  /** Is the lesson already running (start crossed)? */
  running: boolean;
}

/**
 * The suggestion for `nowMin`, or null. Window: `start - LEAD` to `end` of
 * every lesson with a class. When windows overlap (the next lesson's lead
 * inside the current one's tail), the LATEST start wins — the teacher wants
 * the next lesson prepped. Suppressed when the active pointers already show
 * the target, or when the key was dismissed.
 */
export function suggest(
  plan: DayPlan | null,
  activeClassId: string | null,
  activeSceneId: string | null,
  nowMin: number,
  dismissedKey: string | null,
): Suggestion | null {
  const found = lessonInWindow(plan, nowMin);
  if (!found || found.key === dismissedKey) return null;
  return found.onTarget(activeClassId, activeSceneId) ? null : found.suggestion;
}

/** When the process booted, as the auto-switch needs it: a local DATE plus
 *  minutes since that day's midnight. */
export interface BootStamp {
  /** Local wall date (`YYYY-MM-DD`) the process booted on. */
  date: string;
  /** Minutes since local midnight at boot. */
  min: number;
}

/**
 * Should the "already running when we booted" guard silence the auto-switch
 * for a lesson starting at `startMin`?
 *
 * The guard protects the exactly-restored board (promise #2): a lesson that
 * was already under way when the process started keeps whatever the teacher
 * left on screen. It therefore only ever applies to the day we BOOTED on.
 *
 * The date is the whole point. Classroom machines sleep rather than shut
 * down — the same premise `rebasedDate` is built on — so a bare
 * minutes-since-midnight stamp outlives its day: started 12:40, asleep until
 * the next morning, and every lesson starting before 12:40 is settled
 * unswitched, silently, for the rest of the app's life (R4-funn 3.4).
 *
 * `planDate` is the date of the plan the lesson came from — NEVER the wall
 * clock. `refreshToday` is void-ed, so on the roll-over tick `todayPlan` is
 * still yesterday's plan for up to 30 s; comparing against the plan keeps
 * the guard ACTIVE through that window, leaving it exactly as harmless as
 * it is today.
 */
export function bootGuardApplies(
  boot: BootStamp | null,
  planDate: string,
  startMin: number,
): boolean {
  if (boot == null || boot.date !== planDate) return false;
  return startMin < boot.min;
}

/**
 * The lesson-instance key whose window covers `nowMin`, whatever the board
 * currently shows — the auto-switch needs this to CONSUME a lesson's key
 * even when the pointers already match, or a later manual switch inside the
 * same lesson gets yanked back (F-funn B3).
 */
export function lessonKeyInWindow(
  plan: DayPlan | null,
  nowMin: number,
): string | null {
  return lessonInWindow(plan, nowMin)?.key ?? null;
}

interface WindowHit {
  key: string;
  suggestion: Suggestion;
  onTarget: (classId: string | null, sceneId: string | null) => boolean;
}

function lessonInWindow(
  plan: DayPlan | null,
  nowMin: number,
): WindowHit | null {
  if (!plan) return null;
  const candidates = plan.entries.filter(
    (e) =>
      e.period.kind === "lesson" &&
      e.lesson?.classId != null &&
      nowMin >= e.period.startMin - SUGGEST_LEAD_MIN &&
      nowMin < e.period.endMin,
  );
  if (candidates.length === 0) return null;
  const entry = candidates.reduce((a, b) =>
    b.period.startMin > a.period.startMin ? b : a,
  );
  const lesson = entry.lesson!;
  const key = `${plan.date}:${entry.period.id}`;
  const targetScene = lesson.sceneId ?? null;

  return {
    key,
    suggestion: {
      key,
      classId: lesson.classId!,
      sceneId: targetScene,
      className: lesson.className ?? "",
      label: lesson.title || lesson.subject || entry.period.label,
      startMin: entry.period.startMin,
      running: nowMin >= entry.period.startMin,
    },
    onTarget: (classId, sceneId) =>
      classId === lesson.classId &&
      (targetScene == null
        ? sceneId === defaultSceneId(lesson.classId!)
        : sceneId === targetScene),
  };
}
