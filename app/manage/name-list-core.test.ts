import { describe, expect, it } from "vitest";

import {
  MEMBERS_MAX,
  NAME_MAX_CHARS,
  namesToText,
  parseNameList,
  rawNameCount,
} from "./name-list-core";

describe("parseNameList", () => {
  it("splits lines, trims, and drops empties", () => {
    expect(parseNameList("  Kari  \n\n   \nOla\r\nPer")).toEqual([
      "Kari",
      "Ola",
      "Per",
    ]);
  });

  it("keeps duplicates — identity is the row id, never the name", () => {
    expect(parseNameList("Ali\nAli")).toEqual(["Ali", "Ali"]);
  });

  it("caps each name on a CHARACTER boundary", () => {
    const long = "æ".repeat(NAME_MAX_CHARS + 50);
    const [name] = parseNameList(long);
    expect([...name]).toHaveLength(NAME_MAX_CHARS);
  });

  it("caps the list length", () => {
    const text = Array.from(
      { length: MEMBERS_MAX + 20 },
      (_, i) => `E${i}`,
    ).join("\n");
    expect(parseNameList(text)).toHaveLength(MEMBERS_MAX);
  });

  it("round-trips through namesToText", () => {
    const names = ["Kari", "Ola"];
    expect(parseNameList(namesToText(names))).toEqual(names);
  });
});

describe("rawNameCount", () => {
  it("counts what the teacher typed, past the cap the parse applies", () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `Elev ${i}`).join(
      "\n",
    );
    // The parse mirrors storage and caps; the raw count is the refusal's
    // truth. If these two ever agree above the cap, the guard is dead again.
    expect(parseNameList(lines).length).toBe(MEMBERS_MAX);
    expect(rawNameCount(lines)).toBe(1200);
  });

  it("ignores blank lines exactly like the parse does", () => {
    expect(rawNameCount("Kari\n\n  \nOla\n")).toBe(2);
  });
});
