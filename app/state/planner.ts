// Planner state, two halves:
//
//   PANEL — the selected date's plan + the template/week the editor edits.
//   Editor reads REJECT (S#4): a panel that replace-alls over a silently
//   empty read would wipe the plan, so `plannerHydrated` blocks edits until
//   the reads landed.
//
//   TODAY — the plan the widgets and (later) the suggestion banner live off.
//   Fetch on EVENTS (boot + after every planner write), never poll: this is
//   a single-writer offline app. A 30 s ticker only re-derives clock-driven
//   state from Date.now() (sleep-proof, the timer discipline) and re-fetches
//   ONLY when the local date rolled over.

import { signal } from "@preact/signals";

import type { DayPlan } from "../bindings/DayPlan";
import type { Period } from "../bindings/Period";
import type { WeekSlot } from "../bindings/WeekSlot";
import { localDateStr, weekdayOf } from "../planner/date-core";

export const plannerPanelOpen = signal(false);
export type PlannerTab = "periods" | "week" | "day";
export const plannerTab = signal<PlannerTab>("week");

// ── Panel state ─────────────────────────────────────────────────────────────

export const periods = signal<Period[]>([]);
export const weekSlots = signal<WeekSlot[]>([]);
export const selectedDate = signal<string>(localDateStr(new Date()));
export const selectedDayPlan = signal<DayPlan | null>(null);
/** Did the panel's reads land? While false the editors are blocked. */
export const plannerHydrated = signal(false);

export async function refreshPlanner(): Promise<void> {
  try {
    const [p, w] = await Promise.all([
      window.api.plannerPeriodsGet(),
      window.api.plannerWeekGet(),
    ]);
    periods.value = p;
    weekSlots.value = w;
    await refreshSelectedDay();
    plannerHydrated.value = true;
  } catch (e) {
    console.warn("[planner] reads failed — editing is blocked", e);
    plannerHydrated.value = false;
  }
}

export async function refreshSelectedDay(): Promise<void> {
  const date = selectedDate.peek();
  selectedDayPlan.value = await window.api.plannerDayGet(date, weekdayOf(date));
}

export async function selectDate(date: string): Promise<void> {
  selectedDate.value = date;
  try {
    await refreshSelectedDay();
  } catch (e) {
    console.warn("[planner] day read failed", e);
    selectedDayPlan.value = null;
  }
}

// ── Today (widgets + banner) ────────────────────────────────────────────────

export const todayPlan = signal<DayPlan | null>(null);
/** Ticks every 30 s so clock-derived UI re-renders; the VALUE is the epoch
 *  ms of the tick. Widgets needing 1 s resolution tick locally. */
export const plannerNowMs = signal(Date.now());

export async function refreshToday(): Promise<void> {
  const date = localDateStr(new Date());
  try {
    todayPlan.value = await window.api.plannerDayGet(date, weekdayOf(date));
  } catch (e) {
    // The widgets degrade to their empty states; the panel is the surface
    // that reports read failures loudly.
    console.warn("[planner] today read failed", e);
    todayPlan.value = null;
  }
}

/** After ANY planner write: the panel's day and the widgets' today both
 *  reflect the store again. */
export async function plannerChanged(): Promise<void> {
  await Promise.all([
    refreshSelectedDay().catch(() => undefined),
    refreshToday(),
  ]);
}

let ticker: ReturnType<typeof setInterval> | undefined;

/** Boot: one fetch + the 30 s derive-tick (with date-rollover refetch). */
export async function initPlanner(): Promise<void> {
  await refreshToday();
  if (ticker !== undefined) clearInterval(ticker);
  ticker = setInterval(() => {
    plannerNowMs.value = Date.now();
    const current = todayPlan.peek();
    if (current && current.date !== localDateStr(new Date())) {
      void refreshToday();
    }
  }, 30_000);
}
