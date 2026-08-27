// The catalogue-parity gate: `en.json` mirrors `no.json` key for key, so
// activating English later is ONE line in app/i18n/index.ts — never a hunt for
// silently missing strings. A plural group counts as one logical key.

import { describe, expect, it } from "vitest";

import no from "./no.json";
import en from "./en.json";

const CLDR = new Set(["zero", "one", "two", "few", "many", "other"]);

function isPluralGroup(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return (
    keys.length > 0 &&
    keys.every((k) => CLDR.has(k)) &&
    typeof (v as Record<string, unknown>).other === "string"
  );
}

function flattenKeys(tree: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) && !isPluralGroup(v)
      ? flattenKeys(v as Record<string, unknown>, prefix + k + ".")
      : [prefix + k],
  );
}

describe("locale parity", () => {
  it("en has exactly the keys no has", () => {
    const noKeys = flattenKeys(no).sort();
    const enKeys = flattenKeys(en).sort();
    expect(enKeys).toEqual(noKeys);
  });

  it("no value is an empty string", () => {
    for (const tree of [no, en]) {
      const walk = (node: unknown, path: string) => {
        if (typeof node === "string") {
          expect(node.trim(), path).not.toBe("");
        } else if (node && typeof node === "object" && !Array.isArray(node)) {
          for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
        }
      };
      walk(tree, "");
    }
  });
});
