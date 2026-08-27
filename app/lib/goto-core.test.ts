import { describe, expect, it } from "vitest";

import { parseGoto } from "./goto-core";

describe("parseGoto", () => {
  it("no param, or an EMPTY param, means nothing to do", () => {
    expect(parseGoto("")).toBeNull();
    expect(parseGoto("?other=1")).toBeNull();
    expect(parseGoto("?goto=")).toBeNull();
  });

  it("a bare page", () => {
    expect(parseGoto("?goto=manage")).toEqual({ page: "manage" });
  });

  it("qualifies a bare tab with the page prefix", () => {
    expect(parseGoto("?goto=manage:classes")).toEqual({
      page: "manage",
      tab: "manage-classes",
    });
  });

  it("passes an already-qualified tab through rather than doubling it", () => {
    expect(parseGoto("?goto=manage:manage-classes")).toEqual({
      page: "manage",
      tab: "manage-classes",
    });
  });

  it("decodes percent-encoding via URLSearchParams", () => {
    expect(parseGoto(`?goto=${encodeURIComponent("manage:classes")}`)).toEqual({
      page: "manage",
      tab: "manage-classes",
    });
  });

  it("ignores anything after a second colon", () => {
    expect(parseGoto("?goto=manage:classes:extra")).toEqual({
      page: "manage",
      tab: "manage-classes",
    });
  });
});
