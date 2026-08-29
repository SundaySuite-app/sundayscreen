import { describe, expect, it } from "vitest";

import type { AgendaItem } from "../bindings/AgendaItem";
import { markedIndex, nowIndex, startOffsets } from "./agenda-core";

const timed = (
  durationMin: number | null,
): { durationMin: number | null; done: boolean } => ({
  durationMin,
  done: false,
});

describe("startOffsets", () => {
  it("prefix-sums timed items; untimed consume nothing", () => {
    expect(startOffsets([timed(10), timed(null), timed(20), timed(5)])).toEqual(
      [0, 10, 10, 30],
    );
  });
});

describe("nowIndex", () => {
  const items = [timed(10), timed(20), timed(null), timed(15)];

  it("before the lesson: nothing is current", () => {
    expect(nowIndex(items, -5)).toBe(-1);
  });

  it("walks the windows with the clock", () => {
    expect(nowIndex(items, 0)).toBe(0);
    expect(nowIndex(items, 9)).toBe(0);
    expect(nowIndex(items, 10)).toBe(1);
    expect(nowIndex(items, 29)).toBe(1);
    expect(nowIndex(items, 30)).toBe(3);
  });

  it("past the last window the tail belongs to the last activity", () => {
    expect(nowIndex(items, 500)).toBe(3);
  });

  it("with no timed items the clock stays silent", () => {
    expect(nowIndex([timed(null), timed(null)], 10)).toBe(-1);
  });
});

describe("markedIndex", () => {
  const item = (id: string, dur: number | null): AgendaItem => ({
    id,
    date: "d",
    periodId: "p",
    text: id,
    durationMin: dur,
    done: false,
    sortIndex: 0,
  });
  const items = [item("a", 10), item("b", 20)];

  it("a pin wins over the clock", () => {
    expect(markedIndex(items, "b", 0)).toBe(1);
  });

  it("a stale pin falls back to the clock", () => {
    expect(markedIndex(items, "ghost", 12)).toBe(1);
    expect(markedIndex(items, "ghost", 2)).toBe(0);
  });

  it("no pin: pure clock", () => {
    expect(markedIndex(items, null, 2)).toBe(0);
  });
});
