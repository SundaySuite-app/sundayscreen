// The lesson-start suggestion — pure. The banner only RENDERS what this
// returns; pointers move only on the teacher's click or (opt-in) the
// auto-switch. One suggestion key per lesson-instance (`date:periodId`)
// makes both the «Ikke nå» dismissal and the auto-switch's fire-once guard
// structural.

import type { DayPlan } from "../bindings/DayPlan";

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
  if (dismissedKey === key) return null;

  const targetScene = lesson.sceneId ?? null;
  const onTargetClass = activeClassId === lesson.classId;
  const onTargetScene =
    targetScene == null
      ? activeSceneId === `default-${lesson.classId}`
      : activeSceneId === targetScene;
  if (onTargetClass && onTargetScene) return null;

  return {
    key,
    classId: lesson.classId!,
    sceneId: targetScene,
    className: lesson.className ?? "",
    label: lesson.title || lesson.subject || entry.period.label,
    startMin: entry.period.startMin,
    running: nowMin >= entry.period.startMin,
  };
}
