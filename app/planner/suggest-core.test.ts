import { describe, expect, it } from "vitest";

import type { DayPlan } from "../bindings/DayPlan";
import { bootGuardApplies, lessonKeyInWindow, suggest } from "./suggest-core";

const plan: DayPlan = {
  date: "2026-08-31",
  weekday: 1,
  notes: [],
  entries: [
    {
      period: {
        id: "p1",
        label: "Time 1",
        startMin: 510,
        endMin: 555,
        kind: "lesson",
        sortIndex: 0,
      },
      lesson: {
        classId: "c1",
        className: "7B",
        subject: "Norsk",
        sceneId: null,
        sceneName: null,
        title: "",
        overridden: false,
      },
      agenda: [],
    },
    {
      period: {
        id: "p2",
        label: "Time 2",
        startMin: 565,
        endMin: 610,
        kind: "lesson",
        sortIndex: 1,
      },
      lesson: {
        classId: "c2",
        className: "8A",
        subject: "Matte",
        sceneId: "sc-prove",
        sceneName: "Prøve",
        title: "",
        overridden: false,
      },
      agenda: [],
    },
  ],
};

describe("suggest", () => {
  it("opens the window five minutes before start", () => {
    expect(suggest(plan, null, null, 504, null)).toBeNull();
    const s = suggest(plan, null, null, 505, null)!;
    expect(s.classId).toBe("c1");
    expect(s.running).toBe(false);
  });

  it("keeps suggesting through the lesson, marked running", () => {
    const s = suggest(plan, null, null, 530, null)!;
    expect(s.key).toBe("2026-08-31:p1");
    expect(s.running).toBe(true);
  });

  it("the next lesson's lead beats the current one's tail", () => {
    const s = suggest(plan, null, null, 561, null)!;
    expect(s.classId).toBe("c2");
    expect(s.sceneId).toBe("sc-prove");
  });

  it("suppressed when the pointers already show the target", () => {
    expect(suggest(plan, "c1", "default-c1", 530, null)).toBeNull();
    // Right class, wrong scene → still suggested.
    expect(suggest(plan, "c1", "sc-other", 530, null)).not.toBeNull();
    // Scene-bound lesson: the named scene must match.
    expect(suggest(plan, "c2", "sc-prove", 570, null)).toBeNull();
  });

  it("a dismissal silences exactly that lesson-instance", () => {
    expect(suggest(plan, null, null, 530, "2026-08-31:p1")).toBeNull();
    expect(suggest(plan, null, null, 570, "2026-08-31:p1")).not.toBeNull();
  });

  // F-funn B3: the auto-switch consumes a lesson's key even when the board
  // already shows it — otherwise a later manual switch inside that lesson
  // gets yanked back on the next tick.
  it("lessonKeyInWindow answers regardless of what is on screen", () => {
    expect(lessonKeyInWindow(plan, 504)).toBeNull();
    expect(lessonKeyInWindow(plan, 530)).toBe("2026-08-31:p1");
    // Same key while the pointers already match (suggest() stays silent).
    expect(suggest(plan, "c1", "default-c1", 530, null)).toBeNull();
    expect(lessonKeyInWindow(plan, 530)).toBe("2026-08-31:p1");
    // And while dismissed.
    expect(lessonKeyInWindow(plan, 530)).toBe("2026-08-31:p1");
    expect(lessonKeyInWindow(plan, 700)).toBeNull();
  });

  it("no plan, breaks, free periods: nothing", () => {
    expect(suggest(null, null, null, 530, null)).toBeNull();
    expect(suggest(plan, null, null, 700, null)).toBeNull();
  });
});

// The guard that keeps the auto-switch off a lesson that was already running
// when the app started. Booted 12:40 (760 minutes) on Monday.
describe("bootGuardApplies", () => {
  const boot = { date: "2026-08-31", min: 760 };

  const cases: {
    name: string;
    stamp: typeof boot | null;
    planDate: string;
    startMin: number;
    guarded: boolean;
  }[] = [
    // Boot day, lesson began before we did → the restored board stands.
    {
      name: "boot day, lesson started before boot",
      stamp: boot,
      planDate: "2026-08-31",
      startMin: 720,
      guarded: true,
    },
    // Boot day, lesson starts while we are up → the automation may act.
    {
      name: "boot day, lesson starts after boot",
      stamp: boot,
      planDate: "2026-08-31",
      startMin: 780,
      guarded: false,
    },
    // The bug (R4-funn 3.4): the machine slept, the stamp did not. Tuesday's
    // 08:30 lesson must never be settled by Monday's 12:40 start.
    {
      name: "another day is never guarded",
      stamp: boot,
      planDate: "2026-09-01",
      startMin: 510,
      guarded: false,
    },
    // No stamp yet (initPlanner has not run): nothing to guard against.
    {
      name: "no stamp, no guard",
      stamp: null,
      planDate: "2026-08-31",
      startMin: 60,
      guarded: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(bootGuardApplies(c.stamp, c.planDate, c.startMin)).toBe(c.guarded);
    });
  }

  it("the boot minute itself is not 'before boot'", () => {
    expect(bootGuardApplies(boot, "2026-08-31", 760)).toBe(false);
  });
});
