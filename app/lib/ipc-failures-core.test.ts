import { describe, expect, it } from "vitest";

import {
  createIpcFailureState,
  recentFailures,
  recordFailure,
  RING_MAX,
  TOASTS_PER_MINUTE,
} from "./ipc-failures-core";

describe("recordFailure", () => {
  it("the first failure of a command surfaces; a repeat within the window does not", () => {
    const s = createIpcFailureState();
    expect(recordFailure(s, "settings_get", "boom", 1_000)).toBe(true);
    expect(recordFailure(s, "settings_get", "boom", 2_000)).toBe(false);
    // …but after the per-command window it may surface again.
    expect(recordFailure(s, "settings_get", "boom", 70_000)).toBe(true);
  });

  it("caps the overall toast rate per rolling minute", () => {
    const s = createIpcFailureState();
    let surfaced = 0;
    for (let i = 0; i < TOASTS_PER_MINUTE + 3; i++) {
      if (recordFailure(s, `cmd_${i}`, "x", 1_000 + i)) surfaced++;
    }
    expect(surfaced).toBe(TOASTS_PER_MINUTE);
  });

  it("fills the ring unconditionally, surfaced or not", () => {
    const s = createIpcFailureState();
    for (let i = 0; i < 10; i++)
      recordFailure(s, "poll_cmd", "down", 1_000 + i);
    expect(recentFailures(s)).toHaveLength(10);
  });

  it("the ring is bounded and keeps the newest", () => {
    const s = createIpcFailureState();
    for (let i = 0; i < RING_MAX + 20; i++) recordFailure(s, "c", "m", i);
    const ring = recentFailures(s);
    expect(ring).toHaveLength(RING_MAX);
    expect(ring[ring.length - 1].at).toBe(RING_MAX + 19);
    expect(ring[0].at).toBe(20);
  });

  it("recentFailures returns a copy, not the live ring", () => {
    const s = createIpcFailureState();
    recordFailure(s, "a", "m", 1);
    const copy = recentFailures(s);
    copy.pop();
    expect(recentFailures(s)).toHaveLength(1);
  });
});
