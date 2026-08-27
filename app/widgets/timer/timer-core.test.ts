// The TS half of the shared-vector gate (see timer-core.ts's header). The
// SAME fixtures/timer-vectors.json is asserted by cargo against the Rust
// specification — a divergence fails exactly one side and names the case.

import { describe, expect, it } from "vitest";

import vectors from "../../../fixtures/timer-vectors.json";
import type { TimerAction } from "../../bindings/TimerAction";
import type { TimerMode } from "../../bindings/TimerMode";
import type { TimerState } from "../../bindings/TimerState";
import {
  displayMs,
  formatClock,
  isCountdownFamily,
  tick,
  transition,
} from "./timer-core";

interface VectorCase {
  name: string;
  mode?: TimerMode;
  durationMs?: number;
  nowMs: number;
  state: TimerState;
  action?: TimerAction;
  tick?: boolean;
  expect: TimerState;
  expectSound?: boolean;
}

describe("shared vectors", () => {
  const cases = (vectors as { cases: VectorCase[] }).cases;

  it("the vector suite stays substantial", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of cases) {
    it(c.name, () => {
      if (c.tick) {
        const { state, sound } = tick(c.state, c.nowMs);
        expect(state).toEqual(c.expect);
        expect(sound).toBe(c.expectSound ?? false);
      } else {
        const next = transition(
          c.state,
          c.action!,
          c.mode ?? "countdown",
          c.durationMs ?? 0,
          c.nowMs,
        );
        expect(next).toEqual(c.expect);
      }
    });
  }
});

describe("tick identity", () => {
  it("returns the SAME object when nothing changed — callers compare by reference", () => {
    const state: TimerState = { phase: "running", targetEpochMs: 10_000 };
    expect(tick(state, 5_000).state).toBe(state);
  });
});

describe("displayMs", () => {
  it("derives the remainder for the countdown family", () => {
    expect(
      displayMs(
        { phase: "running", targetEpochMs: 10_000 },
        "countdown",
        0,
        7_500,
      ),
    ).toBe(2_500);
    expect(displayMs({ phase: "idle" }, "countdown", 300_000, 0)).toBe(300_000);
    expect(
      displayMs({ phase: "finished", atEpochMs: 1 }, "countdown", 5, 99),
    ).toBe(0);
  });

  it("derives the elapsed for the stopwatch family", () => {
    expect(
      displayMs(
        { phase: "swRunning", startedEpochMs: 1_000, accumulatedMs: 500 },
        "stopwatch",
        0,
        3_000,
      ),
    ).toBe(2_500);
    expect(displayMs({ phase: "idle" }, "stopwatch", 300_000, 0)).toBe(0);
  });
});

describe("formatClock", () => {
  it("mm:ss under an hour, h:mm:ss over", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3_600)).toBe("1:00:00");
    expect(formatClock(3_725)).toBe("1:02:05");
  });

  it("never shows a negative", () => {
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("isCountdownFamily", () => {
  it("keys off the STATE, with mode deciding only idle", () => {
    expect(
      isCountdownFamily({ phase: "running", targetEpochMs: 0 }, "stopwatch"),
    ).toBe(true);
    expect(
      isCountdownFamily({ phase: "swPaused", accumulatedMs: 0 }, "countdown"),
    ).toBe(false);
    expect(isCountdownFamily({ phase: "idle" }, "countdown")).toBe(true);
    expect(isCountdownFamily({ phase: "idle" }, "stopwatch")).toBe(false);
  });
});
