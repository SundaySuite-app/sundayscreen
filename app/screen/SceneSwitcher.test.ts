import { describe, expect, it } from "vitest";

import { CONFIRM_ARM_MS, confirmArmed } from "./SceneSwitcher";

// The two-step delete of a LIBRARY screen. `.confirmDelete` renders exactly
// where the pencil and trash stood, and `deleteScene` has no undo — so the
// confirmation ignores a click that arrives faster than a human means it.

describe("confirmArmed", () => {
  it("refuses the second half of a double-click", () => {
    expect(confirmArmed(1_000, 1_000)).toBe(false);
    // A browser double-click is ~100–300 ms apart.
    expect(confirmArmed(1_000, 1_250)).toBe(false);
  });

  it("accepts a click a human had time to aim", () => {
    expect(confirmArmed(1_000, 1_000 + CONFIRM_ARM_MS)).toBe(true);
    expect(confirmArmed(1_000, 3_000)).toBe(true);
  });

  it("is a threshold, never a window — the confirm stays clickable", () => {
    expect(confirmArmed(1_000, 1_000 + 60_000)).toBe(true);
  });

  it("keeps the threshold on the tame side of a deliberate click", () => {
    expect(CONFIRM_ARM_MS).toBeGreaterThanOrEqual(300);
    expect(CONFIRM_ARM_MS).toBeLessThanOrEqual(600);
  });
});
