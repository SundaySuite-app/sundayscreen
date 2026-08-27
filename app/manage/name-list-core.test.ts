import { describe, expect, it } from "vitest";

import {
  MEMBERS_MAX,
  NAME_MAX_CHARS,
  namesToText,
  parseNameList,
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
