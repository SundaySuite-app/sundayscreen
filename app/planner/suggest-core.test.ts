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

// ── Double lessons (Runde 6) ───────────────────────────────────────────────
//
// A block is ONE lesson-instance: one candidate, one key, one window that
// reaches to the tail's end. The inputs mirror what `resolve_day` produces
// (`schedule.rs::the_double_lesson_matrix`) — the tail carries a CLONE of the
// head's lesson, class and scene included, which is precisely why leaving it
// in the candidate list would mint a second key for the same lesson.

/** A 08:30–09:15 runs on into B 09:25–10:10 over a break; C is a separate
 *  lesson for another class right after. */
const doubleDay: DayPlan = {
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
        sceneId: "sc-norsk",
        sceneName: "Norsk",
        title: "",
        overridden: false,
      },
      agenda: [],
      mergedWithNext: true,
    },
    {
      period: {
        id: "b1",
        label: "Friminutt",
        startMin: 555,
        endMin: 565,
        kind: "break",
        sortIndex: 1,
      },
      lesson: null,
      agenda: [],
    },
    {
      // The tail: `lesson` is A's, cloned by the resolver.
      period: {
        id: "p2",
        label: "Time 2",
        startMin: 565,
        endMin: 610,
        kind: "lesson",
        sortIndex: 2,
      },
      lesson: {
        classId: "c1",
        className: "7B",
        subject: "Norsk",
        sceneId: "sc-norsk",
        sceneName: "Norsk",
        title: "",
        overridden: false,
      },
      agenda: [],
      continuation: true,
    },
    {
      period: {
        id: "p3",
        label: "Time 3",
        startMin: 612,
        endMin: 660,
        kind: "lesson",
        sortIndex: 3,
      },
      lesson: {
        classId: "c2",
        className: "8A",
        subject: "Matte",
        sceneId: null,
        sceneName: null,
        title: "",
        overridden: false,
      },
      agenda: [],
    },
  ],
};

/** The same day with the merge SPLIT (the flags simply absent) — the control
 *  that shows which answers the block changed and which it did not. */
const splitDay: DayPlan = {
  ...doubleDay,
  entries: doubleDay.entries.map((e) => ({
    period: e.period,
    lesson:
      e.period.id === "p2"
        ? {
            classId: "c1",
            className: "7B",
            subject: "KRLE",
            sceneId: null,
            sceneName: null,
            title: "",
            overridden: false,
          }
        : e.lesson,
    agenda: [],
  })),
};

describe("suggest across a double lesson", () => {
  const cases: {
    name: string;
    plan: DayPlan;
    nowMin: number;
    key: string | null;
    running?: boolean;
    sceneId?: string | null;
  }[] = [
    {
      name: "the head suggests as usual in its lead",
      plan: doubleDay,
      nowMin: 505,
      key: "2026-08-31:p1",
      running: false,
      sceneId: "sc-norsk",
    },
    // Mid-block the banner is still offerable, and it is still A's key: the
    // window reaches blockEnd instead of stopping at A's own period end.
    {
      name: "inside the tail: still the HEAD's key, running",
      plan: doubleDay,
      nowMin: 570,
      key: "2026-08-31:p1",
      running: true,
      sceneId: "sc-norsk",
    },
    {
      name: "in the break inside the block: the head's key",
      plan: doubleDay,
      nowMin: 558,
      key: "2026-08-31:p1",
      running: true,
    },
    {
      name: "the tail's own start is NOT a new window",
      plan: doubleDay,
      nowMin: 565,
      key: "2026-08-31:p1",
      running: true,
    },
    {
      name: "at blockEnd the block's window closes",
      plan: doubleDay,
      nowMin: 610,
      key: "2026-08-31:p3",
      running: false,
    },
    // The un-merged control at the same minutes: B is its own lesson-instance
    // again, with its own key and its own lead.
    {
      name: "split: B's lead opens on its own",
      plan: splitDay,
      nowMin: 560,
      key: "2026-08-31:p2",
      running: false,
    },
    {
      name: "split: A's window ends with A's period",
      plan: splitDay,
      nowMin: 556,
      key: null,
    },
    {
      name: "split: inside B it is B that suggests",
      plan: splitDay,
      nowMin: 570,
      key: "2026-08-31:p2",
      running: true,
    },
    {
      name: "the block's last minute still belongs to the head",
      plan: doubleDay,
      nowMin: 606,
      key: "2026-08-31:p1",
      running: true,
    },
    // The next lesson's LEAD still beats the block's tail — the block extends
    // the window, it does not win the overlap. (C's lead opens at 607, five
    // minutes before its 10:12 start, while the block runs to 610.)
    {
      name: "the next lesson's lead beats the block's tail",
      plan: doubleDay,
      nowMin: 607,
      key: "2026-08-31:p3",
      running: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const s = suggest(c.plan, null, null, c.nowMin, null);
      if (c.key == null) {
        expect(s).toBeNull();
        expect(lessonKeyInWindow(c.plan, c.nowMin)).toBeNull();
        return;
      }
      expect(s!.key).toBe(c.key);
      expect(s!.running).toBe(c.running);
      if (c.sceneId !== undefined) expect(s!.sceneId).toBe(c.sceneId);
      // The key the auto-switch consumes is the same one, always.
      expect(lessonKeyInWindow(c.plan, c.nowMin)).toBe(c.key);
    });
  }

  // The double-lesson shape of F-funn B3: the automation fires once, at A's
  // start. A teacher who then switches the board by hand must not be yanked
  // back when B begins — and she cannot be, because B never mints a key.
  it("no key is ever minted for the tail", () => {
    for (let nowMin = 500; nowMin <= 612; nowMin += 1) {
      expect(lessonKeyInWindow(doubleDay, nowMin)).not.toBe("2026-08-31:p2");
    }
    // …while the split day mints exactly that key at B's lead.
    expect(lessonKeyInWindow(splitDay, 560)).toBe("2026-08-31:p2");
  });

  // «Ikke nå» is answered per lesson-instance, and the block IS the instance:
  // one dismissal silences both halves.
  it("a dismissal on the head silences the whole block", () => {
    const key = "2026-08-31:p1";
    for (const nowMin of [505, 520, 558, 570, 606]) {
      expect(suggest(doubleDay, null, null, nowMin, key)).toBeNull();
    }
    // And releases at the next lesson (whose own lead opens at 607).
    expect(suggest(doubleDay, null, null, 607, key)!.key).toBe("2026-08-31:p3");
  });

  it("the on-target suppression follows the head's class and scene", () => {
    // Mid-tail, board already on A's class and scene → silent.
    expect(suggest(doubleDay, "c1", "sc-norsk", 570, null)).toBeNull();
    // Same minute, board moved elsewhere → offered again.
    expect(suggest(doubleDay, "c1", "sc-other", 570, null)!.key).toBe(
      "2026-08-31:p1",
    );
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
