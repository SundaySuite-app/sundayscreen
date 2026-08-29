import { describe, expect, it } from "vitest";

import type { DayPlan } from "../bindings/DayPlan";
import { suggest } from "./suggest-core";

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

  it("no plan, breaks, free periods: nothing", () => {
    expect(suggest(null, null, null, 530, null)).toBeNull();
    expect(suggest(plan, null, null, 700, null)).toBeNull();
  });
});
