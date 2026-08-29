// The deadline's math — pure, nowMs as an argument (the timer discipline:
// every paint DERIVES, so sleep or throttling can never drift it).

/** Urgency bands drive the widget's colour: calm > 72 h, warn ≤ 72 h,
 *  critical ≤ 24 h, overdue past zero. */
export type Urgency = "calm" | "warn" | "critical" | "overdue";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface Breakdown {
  days: number;
  hours: number;
  minutes: number;
  overdue: boolean;
}

export function breakdown(targetEpochMs: number, nowMs: number): Breakdown {
  const diff = targetEpochMs - nowMs;
  const abs = Math.abs(diff);
  return {
    days: Math.floor(abs / DAY_MS),
    hours: Math.floor((abs % DAY_MS) / HOUR_MS),
    minutes: Math.floor((abs % HOUR_MS) / 60_000),
    overdue: diff < 0,
  };
}

export function urgency(targetEpochMs: number, nowMs: number): Urgency {
  const diff = targetEpochMs - nowMs;
  if (diff < 0) return "overdue";
  if (diff <= 24 * HOUR_MS) return "critical";
  if (diff <= 72 * HOUR_MS) return "warn";
  return "calm";
}
