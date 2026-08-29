// Which lesson does «Dagens time» show? Pure over the resolved day plan and
// the clock — the CURRENT lesson when inside one, else the NEXT one today.

import type { DayEntry } from "../../bindings/DayEntry";
import type { DayPlan } from "../../bindings/DayPlan";

export interface ShownLesson {
  entry: DayEntry;
  /** Is the clock inside this lesson right now? */
  current: boolean;
}

export function shownLesson(
  plan: DayPlan | null,
  nowMin: number,
): ShownLesson | null {
  if (!plan) return null;
  const lessons = plan.entries.filter(
    (e) => e.period.kind === "lesson" && e.lesson != null,
  );
  const current = lessons.find(
    (e) => nowMin >= e.period.startMin && nowMin < e.period.endMin,
  );
  if (current) return { entry: current, current: true };
  const next = lessons.find((e) => e.period.startMin > nowMin);
  if (next) return { entry: next, current: false };
  return null;
}
