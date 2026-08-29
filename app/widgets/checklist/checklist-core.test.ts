import { describe, expect, it } from "vitest";

import { addItem, removeItem, renameItem, toggleItem } from "./checklist-core";

const items = [
  { id: "a", text: "Matpakke-lapp", done: false },
  { id: "b", text: "Innlevering", done: true },
];

describe("checklist-core", () => {
  it("toggles by id, leaves the rest", () => {
    const out = toggleItem(items, "a");
    expect(out[0].done).toBe(true);
    expect(out[1]).toEqual(items[1]);
  });

  it("adds trimmed text with the given id; empty is a no-op", () => {
    expect(addItem(items, "  Gym i morgen  ", "c")[2]).toEqual({
      id: "c",
      text: "Gym i morgen",
      done: false,
    });
    expect(addItem(items, "   ", "c")).toHaveLength(2);
  });

  it("removes and renames by id", () => {
    expect(removeItem(items, "a")).toHaveLength(1);
    expect(renameItem(items, "b", "Levert!")[1].text).toBe("Levert!");
  });
});
