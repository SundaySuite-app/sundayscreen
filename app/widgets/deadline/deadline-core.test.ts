import { describe, expect, it } from "vitest";

import { breakdown, urgency } from "./deadline-core";

const H = 3_600_000;
const D = 24 * H;

describe("breakdown", () => {
  it("splits days/hours/minutes", () => {
    const b = breakdown(5 * D + 3 * H + 12 * 60_000, 0);
    expect(b).toEqual({ days: 5, hours: 3, minutes: 12, overdue: false });
  });

  it("overdue counts the other way", () => {
    const b = breakdown(0, 2 * D + H);
    expect(b.days).toBe(2);
    expect(b.hours).toBe(1);
    expect(b.overdue).toBe(true);
  });
});

describe("urgency", () => {
  it("bands: calm > 72h, warn ≤ 72h, critical ≤ 24h, overdue < 0", () => {
    expect(urgency(80 * H, 0)).toBe("calm");
    expect(urgency(72 * H, 0)).toBe("warn");
    expect(urgency(24 * H, 0)).toBe("critical");
    expect(urgency(0, 1)).toBe("overdue");
  });
});
