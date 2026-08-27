// The timer's state machine — the EXECUTING half. The SPECIFICATION lives in
// `crates/sundayscreen-core/src/timer.rs`; the two are held together by the
// shared vectors in `fixtures/timer-vectors.json`, asserted by both cargo
// and vitest. If you change behaviour here, the vector gate will tell you
// which side you forgot.
//
// Time lives in the WALL CLOCK: `running` carries a target epoch and every
// frame DERIVES the remainder — sleep, throttling and minimized windows
// cannot drift a derivation.

import type { TimerAction } from "../../bindings/TimerAction";
import type { TimerMode } from "../../bindings/TimerMode";
import type { TimerState } from "../../bindings/TimerState";

/** How long after the zero-crossing a wake-up still plays the chime. */
export const SOUND_GRACE_MS = 60_000;

/** Apply a button press. Pure: `nowMs` is an argument, never read. */
export function transition(
  state: TimerState,
  action: TimerAction,
  mode: TimerMode,
  durationMs: number,
  nowMs: number,
): TimerState {
  switch (action.type) {
    case "reset":
      return { phase: "idle" };
    case "start":
      return mode === "countdown"
        ? { phase: "running", targetEpochMs: nowMs + durationMs }
        : { phase: "swRunning", startedEpochMs: nowMs, accumulatedMs: 0 };
    case "pause":
      if (state.phase === "running") {
        return {
          phase: "paused",
          remainingMs: Math.max(state.targetEpochMs - nowMs, 0),
        };
      }
      if (state.phase === "swRunning") {
        return {
          phase: "swPaused",
          accumulatedMs:
            state.accumulatedMs + Math.max(nowMs - state.startedEpochMs, 0),
        };
      }
      return state;
    case "resume":
      if (state.phase === "paused") {
        return { phase: "running", targetEpochMs: nowMs + state.remainingMs };
      }
      if (state.phase === "swPaused") {
        return {
          phase: "swRunning",
          startedEpochMs: nowMs,
          accumulatedMs: state.accumulatedMs,
        };
      }
      return state;
  }
}

/** The periodic check: has a running countdown crossed zero? Returns the
 *  SAME state object when nothing changed, so callers can compare by
 *  reference. */
export function tick(
  state: TimerState,
  nowMs: number,
): { state: TimerState; sound: boolean } {
  if (state.phase === "running" && nowMs >= state.targetEpochMs) {
    return {
      state: { phase: "finished", atEpochMs: state.targetEpochMs },
      sound: nowMs - state.targetEpochMs < SOUND_GRACE_MS,
    };
  }
  return { state, sound: false };
}

/** What the big digits should show, in ms — remaining for the countdown
 *  family, elapsed for the stopwatch family. */
export function displayMs(
  state: TimerState,
  mode: TimerMode,
  durationMs: number,
  nowMs: number,
): number {
  switch (state.phase) {
    case "idle":
      return mode === "countdown" ? durationMs : 0;
    case "running":
      return Math.max(state.targetEpochMs - nowMs, 0);
    case "paused":
      return state.remainingMs;
    case "finished":
      return 0;
    case "swRunning":
      return state.accumulatedMs + Math.max(nowMs - state.startedEpochMs, 0);
    case "swPaused":
      return state.accumulatedMs;
  }
}

/** Whether the state belongs to the countdown family (decides ceil vs floor
 *  when turning ms into whole display seconds). */
export function isCountdownFamily(state: TimerState, mode: TimerMode): boolean {
  switch (state.phase) {
    case "running":
    case "paused":
    case "finished":
      return true;
    case "swRunning":
    case "swPaused":
      return false;
    case "idle":
      return mode === "countdown";
  }
}

/** mm:ss, or h:mm:ss once an hour is on the board. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(Math.floor(totalSeconds), 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
