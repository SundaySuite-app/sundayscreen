import { describe, expect, it } from "vitest";

import type { DayEntry } from "../../bindings/DayEntry";
import type { DayPlan } from "../../bindings/DayPlan";
import {
  agendaEntryForBlock,
  blockEnd,
  blockHead,
  blockSpan,
  shownLesson,
} from "./agenda-widget-core";

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

// ── Double lessons (Runde 6) ───────────────────────────────────────────────
//
// The plans below are hand-built in the shape `resolve_day` produces, and the
// cases mirror `schedule.rs::the_double_lesson_matrix` one for one — the Rust
// matrix owns the merge SEMANTICS (which flag wins, what breaks a merge);
// these tests own only what the frontend does with the two booleans it is
// handed. Where a case name quotes the matrix, the Rust case is the source of
// truth for the input, never the other way round.

interface EntrySpec {
  id: string;
  startMin: number;
  endMin: number;
  kind?: "lesson" | "break";
  /** `null` = a break, a free period or a cancelled lesson. */
  subject?: string | null;
  classId?: string | null;
  sceneId?: string | null;
  merged?: boolean;
  continuation?: boolean;
}

function makePlan(specs: EntrySpec[], date = "2026-08-31"): DayPlan {
  return {
    date,
    weekday: 1,
    notes: [],
    entries: specs.map((s, i): DayEntry => {
      const kind = s.kind ?? "lesson";
      const subject = s.subject === undefined ? "Norsk" : s.subject;
      return {
        period: {
          id: s.id,
          label: s.id,
          startMin: s.startMin,
          endMin: s.endMin,
          kind,
          sortIndex: i,
        },
        lesson:
          subject == null
            ? null
            : {
                classId: s.classId === undefined ? "c1" : s.classId,
                className: "7B",
                subject,
                sceneId: s.sceneId ?? null,
                sceneName: null,
                title: "",
                overridden: false,
              },
        agenda: [],
        // Written exactly as the binding allows: absent IS false, and half the
        // fixtures below leave the fields off on purpose so the `undefined`
        // path is the one under test.
        ...(s.merged ? { mergedWithNext: true } : {}),
        ...(s.continuation ? { continuation: true } : {}),
      };
    }),
  };
}

const entryOf = (p: DayPlan, id: string): DayEntry =>
  p.entries.find((e) => e.period.id === id)!;

/** «a WEEKLY double lesson merges»: A 08:30–09:15 runs on into B 09:25–10:10,
 *  the break between them surviving as itself. */
const merged = makePlan([
  { id: "p1", startMin: 510, endMin: 555, merged: true },
  { id: "b1", startMin: 555, endMin: 565, kind: "break", subject: null },
  { id: "p2", startMin: 565, endMin: 610, continuation: true },
]);

/** «chains: B flags onward, so the block spans A→B→C» — the middle entry is
 *  BOTH a continuation and a head. */
const chained = makePlan([
  { id: "p1", startMin: 510, endMin: 555, merged: true },
  { id: "p2", startMin: 560, endMin: 605, merged: true, continuation: true },
  { id: "p3", startMin: 610, endMin: 655, continuation: true },
]);

/** «a carrier with Some(false) SPLITS a weekly double»: two ordinary lessons,
 *  no flags anywhere — the un-merged control. */
const split = makePlan([
  { id: "p1", startMin: 510, endMin: 555 },
  { id: "b1", startMin: 555, endMin: 565, kind: "break", subject: null },
  { id: "p2", startMin: 565, endMin: 610 },
]);

/** «a flag on the day's LAST lesson period is ignored in silence» — the
 *  resolver never sets `continuation` on anything, so the flag reaches the
 *  frontend with nowhere to point. */
const dangling = makePlan([
  { id: "p1", startMin: 510, endMin: 555, merged: true },
  { id: "b1", startMin: 555, endMin: 565, kind: "break", subject: null },
]);

/** Not reachable from `resolve_day`: a tail whose head does not claim it. */
const orphanTail = makePlan([
  { id: "p1", startMin: 510, endMin: 555 },
  { id: "p2", startMin: 565, endMin: 610, continuation: true },
]);

describe("block helpers", () => {
  const cases: {
    name: string;
    plan: DayPlan;
    id: string;
    head: string;
    span: [number, number];
  }[] = [
    {
      name: "no flags: a lesson is its own block",
      plan: split,
      id: "p2",
      head: "p2",
      span: [565, 610],
    },
    {
      name: "the head of a double answers for the whole block",
      plan: merged,
      id: "p1",
      head: "p1",
      span: [510, 610],
    },
    {
      name: "the tail resolves BACK to the head, same span",
      plan: merged,
      id: "p2",
      head: "p1",
      span: [510, 610],
    },
    {
      name: "a break inside a block is nobody's tail — it is its own entry",
      plan: merged,
      id: "b1",
      head: "b1",
      span: [555, 565],
    },
    {
      name: "a chain: the middle tail points at the FIRST head",
      plan: chained,
      id: "p2",
      head: "p1",
      span: [510, 655],
    },
    {
      name: "a chain: the last tail reaches back past the middle too",
      plan: chained,
      id: "p3",
      head: "p1",
      span: [510, 655],
    },
    {
      name: "a dangling flag makes a one-period block",
      plan: dangling,
      id: "p1",
      head: "p1",
      span: [510, 555],
    },
    {
      name: "an unclaimed tail is its own head rather than invisible",
      plan: orphanTail,
      id: "p2",
      head: "p2",
      span: [565, 610],
    },
    {
      name: "a lesson before an unclaimed tail does not absorb it",
      plan: orphanTail,
      id: "p1",
      head: "p1",
      span: [510, 555],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const entry = entryOf(c.plan, c.id);
      expect(blockHead(c.plan, entry).period.id).toBe(c.head);
      expect(blockEnd(c.plan, entry)).toBe(c.span[1]);
      expect(blockSpan(c.plan, entry)).toEqual({
        startMin: c.span[0],
        endMin: c.span[1],
      });
    });
  }

  it("without a plan an entry answers for itself", () => {
    const tail = entryOf(merged, "p2");
    expect(blockHead(null, tail).period.id).toBe("p2");
    expect(blockEnd(null, tail)).toBe(610);
    expect(blockSpan(null, tail)).toEqual({ startMin: 565, endMin: 610 });
  });

  it("an entry from ANOTHER day answers for itself", () => {
    const foreign = entryOf(
      makePlan([{ id: "zz", startMin: 0, endMin: 10 }]),
      "zz",
    );
    expect(blockHead(merged, foreign).period.id).toBe("zz");
    expect(blockEnd(merged, foreign)).toBe(10);
  });

  // The lookup is by period id, not by object identity: a consumer holding an
  // entry from an earlier render of the same day must still get its block.
  it("a COPY of the tail resolves to the head", () => {
    const orig = entryOf(merged, "p2");
    const copy: DayEntry = { ...orig, period: { ...orig.period } };
    expect(blockHead(merged, copy).period.id).toBe("p1");
    expect(blockEnd(merged, copy)).toBe(610);
  });
});

describe("agendaEntryForBlock", () => {
  // Owner choice: ONE agenda list per double lesson, kept on the head.
  it("both halves of a double share the head's list", () => {
    expect(agendaEntryForBlock(merged, entryOf(merged, "p1")).period.id).toBe(
      "p1",
    );
    expect(agendaEntryForBlock(merged, entryOf(merged, "p2")).period.id).toBe(
      "p1",
    );
  });

  it("an ordinary lesson keeps its own list", () => {
    expect(agendaEntryForBlock(split, entryOf(split, "p2")).period.id).toBe(
      "p2",
    );
  });

  // Rows already stored under the TAIL's key are NOT folded in — the widget
  // draws the head's list only. They are not hidden: the planner panel lists
  // every period's own rows.
  it("the tail's own rows are left where they are, untouched", () => {
    const tail = entryOf(merged, "p2");
    expect(tail.agenda).toEqual([]);
    expect(agendaEntryForBlock(merged, tail)).not.toBe(tail);
  });
});

describe("shownLesson across a block", () => {
  const cases: {
    name: string;
    plan: DayPlan;
    nowMin: number;
    entry: string | null;
    current?: boolean;
  }[] = [
    {
      name: "inside A: the head, current",
      plan: merged,
      nowMin: 520,
      entry: "p1",
      current: true,
    },
    // The point of the whole exercise: mid-block the widget must stay bound
    // to the HEAD's periodId, or the agenda list and the suggestion key would
    // change under the teacher halfway through one lesson.
    {
      name: "inside B: still the HEAD, current",
      plan: merged,
      nowMin: 570,
      entry: "p1",
      current: true,
    },
    // The block SPAN is [head.start, blockEnd) — the same definition the
    // resolver merged on. A break inside a double lesson is still a break in
    // the day's list, but the lesson that is RUNNING is A, the whole time.
    {
      name: "in the break INSIDE the block: the head, still current",
      plan: merged,
      nowMin: 558,
      entry: "p1",
      current: true,
    },
    {
      name: "at the block's last minute: still current",
      plan: merged,
      nowMin: 609,
      entry: "p1",
      current: true,
    },
    {
      name: "at blockEnd exactly: the block is over",
      plan: merged,
      nowMin: 610,
      entry: null,
    },
    // The un-merged control: the SAME clock reading, the old answer.
    {
      name: "the same minute in an UNMERGED day: the next lesson, not current",
      plan: split,
      nowMin: 558,
      entry: "p2",
      current: false,
    },
    {
      name: "before a double: the head is next, not the tail",
      plan: merged,
      nowMin: 500,
      entry: "p1",
      current: false,
    },
    {
      name: "a chain holds all three periods together",
      plan: chained,
      nowMin: 620,
      entry: "p1",
      current: true,
    },
    {
      name: "in a chain's second gap: still the head",
      plan: chained,
      nowMin: 607,
      entry: "p1",
      current: true,
    },
    {
      name: "a dangling flag does not extend anything",
      plan: dangling,
      nowMin: 556,
      entry: null,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const s = shownLesson(c.plan, c.nowMin);
      if (c.entry == null) {
        expect(s).toBeNull();
        return;
      }
      expect(s!.entry.period.id).toBe(c.entry);
      expect(s!.current).toBe(c.current);
    });
  }

  // A tail is never the answer while its head claims it — not as `current`
  // (the head owns the span) and not as `next` (it is filtered out of the
  // candidates). An UNCLAIMED tail is visible, per `blockHead`'s fallback.
  it("never lands on a claimed continuation, but never hides an orphan", () => {
    for (let nowMin = 500; nowMin <= 620; nowMin += 1) {
      expect(shownLesson(merged, nowMin)?.entry.period.id).not.toBe("p2");
    }
    expect(shownLesson(orphanTail, 570)!.entry.period.id).toBe("p2");
    expect(shownLesson(orphanTail, 560)!.entry.period.id).toBe("p2");
  });
});
