import { describe, expect, it } from "vitest";

import {
  addDays,
  formatMin,
  isoWeekday,
  localDateStr,
  minutesOfDay,
  parseTime,
  weekdayOf,
} from "./date-core";

describe("date-core", () => {
  it("formats a local date key", () => {
    expect(localDateStr(new Date(2026, 7, 31, 0, 5))).toBe("2026-08-31");
  });

  it("iso weekday: Sunday is 7", () => {
    expect(isoWeekday(new Date(2026, 7, 30, 12))).toBe(7); // a Sunday
    expect(isoWeekday(new Date(2026, 7, 31, 12))).toBe(1); // a Monday
  });

  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("weekdayOf reads the key", () => {
    expect(weekdayOf("2026-08-31")).toBe(1);
    expect(weekdayOf("2026-09-04")).toBe(5);
  });

  it("time parse/format round-trips and rejects garbage", () => {
    expect(parseTime("08:30")).toBe(510);
    expect(parseTime("8:30")).toBe(510);
    expect(formatMin(510)).toBe("08:30");
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("08:65")).toBeNull();
    expect(parseTime("banan")).toBeNull();
  });

  it("minutesOfDay", () => {
    expect(minutesOfDay(new Date(2026, 7, 31, 10, 5))).toBe(605);
  });
});
