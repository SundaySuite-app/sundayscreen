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

import { computed, signal } from "@preact/signals";

import type { DayPlan } from "../bindings/DayPlan";
import type { Period } from "../bindings/Period";
import type { WeekSlot } from "../bindings/WeekSlot";
import {
  localDateStr,
  minutesOfDay,
  rebasedDate,
  weekdayOf,
} from "../planner/date-core";
import type { BootStamp } from "../planner/suggest-core";
import {
  bootGuardApplies,
  lessonKeyInWindow,
  suggest,
} from "../planner/suggest-core";
import { loadScenes, switchLesson } from "./scenes";
import { settings } from "./settings";
import { t } from "../i18n";
import { toast } from "../ui/toast";

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

/**
 * The ONE way to open the planner.
 *
 * `plannerPanelOpen = true` on its own opens a panel with
 * `plannerHydrated === false` — every editor blocked, for a teacher who did
 * nothing wrong. The reads are part of opening, not something the caller is
 * trusted to remember; `loadScenes` comes along because the day editor's
 * scene picker is empty without it.
 */
export function openPlanner(): void {
  plannerPanelOpen.value = true;
  void refreshPlanner();
  void loadScenes();
}

export async function refreshPlanner(): Promise<void> {
  try {
    const [p, w] = await Promise.all([
      window.api.plannerPeriodsGet(),
      window.api.plannerWeekGet(),
    ]);
    periods.value = p;
    weekSlots.value = w;
    // BEFORE the day read, or the panel opens on yesterday's plan and the
    // first read is already of the wrong date.
    selectedDate.value = rebasedDate(
      selectedDate.peek(),
      localDateStr(new Date()),
    );
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

/** Did the last today-read FAIL? The widgets say so instead of rendering a
 *  free day that nobody planned (F-funn F13). */
export const todayReadFailed = signal(false);
/** Ticks every 30 s so clock-derived UI re-renders; the VALUE is the epoch
 *  ms of the tick. Widgets needing 1 s resolution tick locally. */
export const plannerNowMs = signal(Date.now());

export async function refreshToday(): Promise<void> {
  const date = localDateStr(new Date());
  try {
    todayPlan.value = await window.api.plannerDayGet(date, weekdayOf(date));
    todayReadFailed.value = false;
  } catch (e) {
    // A silent null read as "no lessons today" is a LIE on the board
    // (F-funn F13): keep the last good plan and say the read failed.
    console.warn("[planner] today read failed", e);
    todayReadFailed.value = true;
  }
}

/** After ANY planner write — from the panel OR a widget's check-off: the
 *  panel's day and the widgets' today both reflect the store again, so
 *  neither can save a stale copy over the other (F-funn F11). */
export async function plannerChanged(): Promise<void> {
  await Promise.all([
    refreshSelectedDay().catch(() => undefined),
    refreshToday(),
  ]);
}

// ── The lesson-start suggestion + opt-in auto-switch ───────────────────────

/** «Ikke nå» silences exactly one lesson-instance (in-memory: a restart may
 *  re-suggest, which is fine — the banner is chrome, the board restores
 *  exactly regardless). */
export const dismissedSuggestionKey = signal<string | null>(null);

/** What the banner shows. Reads the 30 s tick so the window re-evaluates. */
export const currentSuggestion = computed(() => {
  const nowMin = minutesOfDay(new Date(plannerNowMs.value));
  const s = settings.value;
  return suggest(
    todayPlan.value,
    s.activeClassId,
    s.activeSceneId,
    nowMin,
    dismissedSuggestionKey.value,
  );
});

/** Lesson-instances the automation has already had its one say about. */
const autoSettledKeys = new Set<string>();

/**
 * When this process booted — DATED, not just clock-time. Auto-switching a
 * lesson that was already running at boot would override the exactly-restored
 * board (promise #2), so the automation only acts on lessons that START while
 * we are up. The date is what keeps that guard from outliving its day on a
 * machine that sleeps instead of shutting down (R4-funn 3.4); the decision
 * itself is `bootGuardApplies`, in suggest-core, where it can be tested.
 */
let bootStamp: BootStamp | null = null;

/**
 * Opt-in automation. Two guards, both learned the hard way (F-funn B3/B4):
 *   - a lesson whose window we are inside is SETTLED even when the board
 *     already shows it, so a later manual switch is not yanked back;
 *   - a lesson that was already running at boot, ON BOOT DAY, is left alone.
 */
export function maybeAutoSwitch(): void {
  if (!settings.peek().autoSwitchScenes) return;
  // The plan, not just its key: the boot guard is decided against the DATE
  // the lesson was planned for, never the wall clock.
  const plan = todayPlan.peek();
  if (plan == null) return;
  const nowMin = minutesOfDay(new Date());
  const key = lessonKeyInWindow(plan, nowMin);
  if (key == null || autoSettledKeys.has(key)) return;

  const s = currentSuggestion.peek();
  // On target already (or dismissed): nothing to do — but the lesson has
  // had its turn, so a manual switch later in it stands.
  if (!s || s.key !== key || !s.running) {
    if (s == null || s.running) autoSettledKeys.add(key);
    return;
  }
  // A lesson that was already under way when we booted keeps the restored
  // screen; the banner still offers the switch. Only on boot day: tomorrow's
  // 08:30 lesson has nothing to do with a 12:40 start yesterday.
  if (bootGuardApplies(bootStamp, plan.date, s.startMin)) {
    autoSettledKeys.add(key);
    return;
  }
  autoSettledKeys.add(key);
  void switchLesson(s.classId, s.sceneId).catch((e) => {
    console.warn("[planner] auto-switch failed", e);
    toast("error", t("manage.actionFailed"));
  });
}

let ticker: ReturnType<typeof setInterval> | undefined;

/** Boot: one fetch + the 30 s derive-tick (with date-rollover refetch). */
export async function initPlanner(): Promise<void> {
  const bootedAt = new Date();
  bootStamp = { date: localDateStr(bootedAt), min: minutesOfDay(bootedAt) };
  await refreshToday();
  if (ticker !== undefined) clearInterval(ticker);
  ticker = setInterval(() => {
    plannerNowMs.value = Date.now();
    const today = localDateStr(new Date());
    const current = todayPlan.peek();
    if (current && current.date !== today) {
      void refreshToday();
    }
    // Its OWN statement, deliberately not nested in the branch above: that
    // one dies silently when `todayPlan` is null (a failed first read), and
    // a machine that has been asleep is exactly where a stale
    // `selectedDate` outlives a failed read. Not while the panel is open —
    // moving the date under the teacher's hands would be worse than stale.
    if (!plannerPanelOpen.peek()) {
      selectedDate.value = rebasedDate(selectedDate.peek(), today);
    }
    maybeAutoSwitch();
  }, 30_000);
  maybeAutoSwitch();
}
