import { describe, expect, it } from "vitest";

import {
  fixturesHonored,
  fixtureWins,
  lookupFixture,
  readFixture,
} from "./fixtures-core";

describe("fixturesHonored", () => {
  it("always honours outside Tauri — there is no backend to shadow", () => {
    expect(
      fixturesHonored({ inTauri: false, devBuild: false, requested: false }),
    ).toBe(true);
  });

  it("inside Tauri needs BOTH a dev build and the explicit query param", () => {
    expect(
      fixturesHonored({ inTauri: true, devBuild: true, requested: true }),
    ).toBe(true);
    expect(
      fixturesHonored({ inTauri: true, devBuild: true, requested: false }),
    ).toBe(false);
    expect(
      fixturesHonored({ inTauri: true, devBuild: false, requested: true }),
    ).toBe(false);
  });
});

describe("lookupFixture", () => {
  it("misses on no map and on unowned keys", () => {
    expect(lookupFixture(undefined, "x").hit).toBe(false);
    expect(lookupFixture({}, "x").hit).toBe(false);
  });

  it("an inherited Object.prototype key is NOT a fixture", () => {
    expect(lookupFixture({}, "toString").hit).toBe(false);
  });

  it("undefined is a legitimate canned answer", () => {
    const found = lookupFixture({ void_cmd: undefined }, "void_cmd");
    expect(found.hit).toBe(true);
    expect(found.value).toBeUndefined();
  });
});

describe("readFixture", () => {
  it("hands a value back as-is and calls a function with the args", () => {
    expect(readFixture(42)).toBe(42);
    expect(
      readFixture((args?: Record<string, unknown>) => args?.n, { n: 7 }),
    ).toBe(7);
  });

  it("lets a throwing fixture throw — that is how a test drives the failure path", () => {
    expect(() =>
      readFixture(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});

describe("fixtureWins", () => {
  it("a fixture only wins when it exists AND the gate honours it", () => {
    const browser = { inTauri: false, devBuild: true, requested: false };
    const shipped = { inTauri: true, devBuild: false, requested: true };
    expect(fixtureWins(browser, true)).toBe(true);
    expect(fixtureWins(browser, false)).toBe(false);
    expect(fixtureWins(shipped, true)).toBe(false);
  });
});
