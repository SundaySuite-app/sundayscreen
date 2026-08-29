// Agenda timing — pure, nowMs-as-argument (the timer discipline: every
// paint DERIVES from the clock, so sleep/throttle can never drift it).

import type { AgendaItem } from "../bindings/AgendaItem";

/** A manual agenda line (the widget's planner-free mode) shares the shape
 *  the math needs. */
export interface TimedItem {
  durationMin: number | null;
  done: boolean;
}

/**
 * Start offset (minutes from lesson start) for each item: a running prefix
 * sum over the TIMED items; untimed items inherit the running position and
 * consume nothing.
 */
export function startOffsets(items: TimedItem[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const item of items) {
    out.push(acc);
    acc += item.durationMin ?? 0;
  }
  return out;
}

/**
 * Which item is "now"? Clock-driven: the last timed item whose window
 * contains `minutesIntoLesson`. Before the lesson → -1; past the last timed
 * window → the final index (the lesson's tail belongs to the last activity).
 * With NO timed items the clock has nothing to say → -1 (manual only).
 */
export function nowIndex(
  items: TimedItem[],
  minutesIntoLesson: number,
): number {
  if (minutesIntoLesson < 0) return -1;
  if (!items.some((i) => (i.durationMin ?? 0) > 0)) return -1;
  const offsets = startOffsets(items);
  let current = -1;
  for (let i = 0; i < items.length; i++) {
    const dur = items[i].durationMin ?? 0;
    if (minutesIntoLesson >= offsets[i] && (dur > 0 || current === -1)) {
      current = i;
    }
  }
  return current;
}

/** The index the widget should MARK, honoring a manual pin: a pinned id
 *  wins over the clock; a stale pin (deleted item) falls back to the clock. */
export function markedIndex(
  items: AgendaItem[],
  pinnedItemId: string | null,
  minutesIntoLesson: number,
): number {
  if (pinnedItemId != null) {
    const pinned = items.findIndex((i) => i.id === pinnedItemId);
    if (pinned >= 0) return pinned;
  }
  return nowIndex(
    items.map((i) => ({ durationMin: i.durationMin, done: i.done })),
    minutesIntoLesson,
  );
}
