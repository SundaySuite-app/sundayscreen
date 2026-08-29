import { describe, expect, it } from "vitest";

import type { DayPlan } from "../../bindings/DayPlan";
import { shownLesson } from "./agenda-widget-core";

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

describe("shownLesson", () => {
  it("inside a lesson: that lesson, current", () => {
    const s = shownLesson(plan, 520)!;
    expect(s.entry.period.id).toBe("p1");
    expect(s.current).toBe(true);
  });

  it("in the break: the NEXT lesson, not current", () => {
    const s = shownLesson(plan, 558)!;
    expect(s.entry.period.id).toBe("p2");
    expect(s.current).toBe(false);
  });

  it("before school: the first lesson", () => {
    expect(shownLesson(plan, 400)!.entry.period.id).toBe("p1");
  });

  it("after school / empty plan: nothing", () => {
    expect(shownLesson(plan, 700)).toBeNull();
    expect(shownLesson(null, 520)).toBeNull();
  });
});
