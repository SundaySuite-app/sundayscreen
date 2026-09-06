// The planner's TIME and READ guards — the four decisions in `planner.ts`
// that nobody can see from the outside and every one of which is a sentence a
// classroom lives with.
//
//   1. Auto-switch never acts on a plan that is not TODAY's (R7 robusthet M4).
//   2. The banner is silent for the same plan, for the same reason.
//   3. The 30 s ticker REPAIRS a failed first read (R7 robusthet M5).
//   4. A failed day read is remembered as failed, and `plannerChanged` reads
//      the panel's day only when the panel is open (R7 skjøt #3 / ytelse #3).
//
// Written in `design-guards.test.ts`'s style, and for its reasons: stubbed
// `window.api`, an ordered call log, node environment (never jsdom).
//
// ## Module state that outlives a test
//
// `maybeAutoSwitch`'s `autoSettledKeys` is private, permanent and keyed on
// `date:periodId`, so every test below builds its plan on its OWN date. A
// shared date would let the first test that fires settle the key for the rest
// of the file, and the guards would look like they were working while nothing
// was being tested at all.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Class } from "../bindings/Class";
import type { ClassSnapshot } from "../bindings/ClassSnapshot";
import type { DayPlan } from "../bindings/DayPlan";
import type { Scene } from "../bindings/Scene";
import { adoptSnapshot, flushPending } from "./layout";
import {
  currentSuggestion,
  dayReadFailed,
  initPlanner,
  maybeAutoSwitch,
  plannerChanged,
  plannerNowMs,
  plannerPanelOpen,
  selectDate,
  selectedDayPlan,
  todayPlan,
  todayReadFailed,
} from "./planner";
import { settings } from "./settings";

const CLASS: Class = { id: "c1", name: "7B", sortIndex: 0, createdAt: 0 };
const LESSON: Scene = {
  id: "default-c1",
  classId: "c1",
  name: "7B",
  sortIndex: 0,
  createdAt: 0,
  theme: "standard",
};
/** Where the automation would land if it were allowed to run. */
const NEXT_SCENE: Scene = {
  id: "s-next",
  classId: null,
  name: "Stasjoner",
  sortIndex: 1,
  createdAt: 0,
  theme: "papir",
};

/** One 08:30–09:15 lesson for class `c2` on `date`. The active pointers are
 *  `c1`/`default-c1`, so the automation always WANTS to move. */
function planFor(date: string): DayPlan {
  return {
    date,
    weekday: 1,
    entries: [
      {
        period: {
          id: "p1",
          label: "1. time",
          startMin: 510,
          endMin: 555,
          kind: "lesson",
          sortIndex: 0,
        },
        lesson: {
          classId: "c2",
          className: "8A",
          subject: "Norsk",
          sceneId: NEXT_SCENE.id,
          sceneName: NEXT_SCENE.name,
          title: "",
          overridden: false,
        },
        agenda: [],
      },
    ],
    notes: [],
  };
}

const switches: { classId: string; sceneId: string | null }[] = [];

const plannerDayGet = vi.fn(
  async (date: string, _weekday: number): Promise<DayPlan> => planFor(date),
);
const lessonSwitch = vi.fn(
  async (classId: string, sceneId: string | null): Promise<ClassSnapshot> => {
    switches.push({ classId, sceneId });
    return {
      class: { ...CLASS, id: classId },
      scene: NEXT_SCENE,
      members: [],
      widgets: [],
    };
  },
);

vi.stubGlobal("window", {
  api: {
    plannerDayGet,
    lessonSwitch,
    layoutLoad: vi.fn(async () => []),
    layoutSave: vi.fn(async () => undefined),
    settingsSave: vi.fn(async () => undefined),
    settingsSetWindow: vi.fn(async () => undefined),
  },
});

beforeEach(() => {
  // `Date` only — `setTimeout` belongs to the persister's debounce, and
  // freezing it deadlocks the drains. The one test that needs the INTERVAL
  // opts into full fake timers itself.
  vi.useFakeTimers({ toFake: ["Date"] });
  switches.length = 0;
  plannerDayGet.mockClear();
  lessonSwitch.mockClear();
  plannerPanelOpen.value = false;
  todayPlan.value = null;
  todayReadFailed.value = false;
  dayReadFailed.value = false;
  adoptSnapshot({ class: CLASS, scene: LESSON, members: [], widgets: [] });
  settings.value = {
    ...settings.peek(),
    activeClassId: CLASS.id,
    activeSceneId: LESSON.id,
    autoSwitchScenes: true,
  };
});

afterEach(async () => {
  vi.useRealTimers();
  await flushPending();
  todayPlan.value = null;
  plannerPanelOpen.value = false;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Let every queued promise settle — the automation is `void`-ed (a timer
 *  tick has nobody to report to), so its work is only observable after the
 *  microtask queue has drained. */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── 1. The automation only ever acts on TODAY's plan ────────────────────────

describe("maybeAutoSwitch across a date rollover", () => {
  it("ignores yesterday's plan — and still fires once today's lands", async () => {
    // Tuesday 08:35. The machine slept through the night, so the first tick
    // of the day still holds MONDAY's plan: `refreshToday` is void-ed and the
    // refetch has not landed when `maybeAutoSwitch` runs, synchronously, on
    // that same tick.
    vi.setSystemTime(new Date("2026-09-01T08:35:00"));
    todayPlan.value = planFor("2026-08-31");
    plannerNowMs.value = Date.now();

    maybeAutoSwitch();
    maybeAutoSwitch();
    await drain();
    // Monday's 08:30 lesson belongs to another class. Switching the board to
    // it in front of Tuesday's class is precisely what the automation
    // promises not to do.
    expect(switches).toEqual([]);

    // …and the key was NOT settled: the guard returns before the key is even
    // computed, so today's lesson still gets the one say the rule gives it.
    todayPlan.value = planFor("2026-09-01");
    maybeAutoSwitch();
    await drain();
    expect(switches).toEqual([{ classId: "c2", sceneId: NEXT_SCENE.id }]);
  });

  it("fires on the very first tick when the plan IS today's", async () => {
    // The control: same clock, same lesson, right date. Without it the test
    // above passes just as well on a plan the automation never wanted.
    vi.setSystemTime(new Date("2026-09-02T08:35:00"));
    todayPlan.value = planFor("2026-09-02");
    plannerNowMs.value = Date.now();
    maybeAutoSwitch();
    await drain();
    expect(switches).toEqual([{ classId: "c2", sceneId: NEXT_SCENE.id }]);
  });
});

// ── 2. The banner keeps the same silence ────────────────────────────────────

describe("currentSuggestion across a date rollover", () => {
  it("offers nothing from a plan that is not today's", () => {
    vi.setSystemTime(new Date("2026-09-03T08:35:00"));
    todayPlan.value = planFor("2026-09-02");
    plannerNowMs.value = Date.now();
    expect(currentSuggestion.value).toBeNull();

    // The same tick with the right plan DOES offer — the suppression is about
    // the date, not about the window.
    todayPlan.value = planFor("2026-09-03");
    expect(currentSuggestion.value?.classId).toBe("c2");
  });
});

// ── 3. The ticker repairs a failed FIRST read ───────────────────────────────

describe("the 30 s ticker", () => {
  it("re-reads after a failed first read, and stops once it lands", async () => {
    // Full fake timers here, and only here: the INTERVAL is what is under
    // test. No layout write happens in this test, so the persister's debounce
    // is not in the way.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T08:35:00"));
    // Not while the automation is armed: the repair is what is being
    // measured, not what it enables.
    settings.value = { ...settings.peek(), autoSwitchScenes: false };
    plannerDayGet.mockRejectedValueOnce(new Error("database is locked"));

    await initPlanner();
    // A transient rejection at boot. Before the repair this state lasted the
    // WHOLE DAY: «Dagens time», the banner and the auto-switch were dead on a
    // machine nobody touches, and only a planner write could heal it.
    expect(todayPlan.value).toBeNull();
    expect(todayReadFailed.value).toBe(true);
    expect(plannerDayGet).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(plannerDayGet).toHaveBeenCalledTimes(2);
    expect(todayPlan.value?.date).toBe("2026-09-04");
    expect(todayReadFailed.value).toBe(false);

    // One read per tick, and it STOPS: the date has not rolled, the plan is
    // there and the last read succeeded, so the next tick asks for nothing.
    // This is the line between a repair and R2-F20's retry hammer.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(plannerDayGet).toHaveBeenCalledTimes(2);
  });
});

// ── 4. A failed day read is a failed day read ───────────────────────────────

describe("dayReadFailed", () => {
  it("is set by a rejected read and cleared by the next good one", async () => {
    vi.setSystemTime(new Date("2026-09-07T09:00:00"));
    plannerDayGet.mockRejectedValueOnce(new Error("database is locked"));

    await selectDate("2026-09-08");
    // `selectedDayPlan = null` is ALSO what an unplanned day looks like —
    // which is why the day tab used to answer a hiccup with «Ingen timer
    // definert ennå». The flag is the difference.
    expect(selectedDayPlan.value).toBeNull();
    expect(dayReadFailed.value).toBe(true);

    await selectDate("2026-09-08");
    expect(selectedDayPlan.value?.date).toBe("2026-09-08");
    expect(dayReadFailed.value).toBe(false);
  });

  it("is set even when `plannerChanged` swallows the rejection", async () => {
    vi.setSystemTime(new Date("2026-09-09T09:00:00"));
    plannerPanelOpen.value = true;
    // The panel's re-read fails after a write that LANDED: silence there left
    // the panel showing pre-write state without a word.
    plannerDayGet.mockRejectedValueOnce(new Error("database is locked"));
    await plannerChanged();
    expect(dayReadFailed.value).toBe(true);
  });
});

// ── 5. The panel's day is only re-read when the panel is open ───────────────

describe("plannerChanged", () => {
  it("reads the day twice with the panel open and once with it closed", async () => {
    vi.setSystemTime(new Date("2026-09-10T09:00:00"));

    plannerPanelOpen.value = true;
    plannerDayGet.mockClear();
    await plannerChanged();
    expect(plannerDayGet).toHaveBeenCalledTimes(2);

    // Closed, the panel's half is pure waste: every `planner_day_get`
    // resolves a whole day in Rust, and a check-off in the «Dagens time»
    // widget spent two of them where one was read. Nothing is lost —
    // `openPlanner` reads fresh on the way in.
    plannerPanelOpen.value = false;
    plannerDayGet.mockClear();
    await plannerChanged();
    expect(plannerDayGet).toHaveBeenCalledTimes(1);
  });
});
