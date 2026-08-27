// The registry-shape gate: every kind is complete and internally consistent,
// and its label exists in EVERY catalogue — the table test that keeps
// `tDyn("widget.label", kind)` from rendering an empty label the day a new
// widget lands without its copy.

import { describe, expect, it } from "vitest";

import en from "../i18n/locales/en.json";
import no from "../i18n/locales/no.json";
import { WIDGET_KINDS, WIDGET_REGISTRY } from "./registry";

const lookup = (tree: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      tree,
    );

describe("WIDGET_REGISTRY", () => {
  it("has at least one kind", () => {
    expect(WIDGET_KINDS.length).toBeGreaterThan(0);
  });

  for (const kind of WIDGET_KINDS) {
    const def = WIDGET_REGISTRY[kind];

    it(`${kind}: key, def.kind and defaultConfig().kind all agree`, () => {
      expect(def.kind).toBe(kind);
      expect(def.defaultConfig().kind).toBe(kind);
    });

    it(`${kind}: label key resolves to a non-empty string in no AND en`, () => {
      expect(def.labelKey).toBe(`widget.label.${kind}`);
      for (const tree of [no, en]) {
        const label = lookup(tree, def.labelKey);
        expect(typeof label, def.labelKey).toBe("string");
        expect((label as string).trim()).not.toBe("");
      }
    });

    it(`${kind}: sizes are sane (min <= default, all positive)`, () => {
      expect(def.minSizePx.w).toBeGreaterThan(0);
      expect(def.minSizePx.h).toBeGreaterThan(0);
      expect(def.defaultSizePx.w).toBeGreaterThanOrEqual(def.minSizePx.w);
      expect(def.defaultSizePx.h).toBeGreaterThanOrEqual(def.minSizePx.h);
    });

    it(`${kind}: has a component`, () => {
      expect(typeof def.Component).toBe("function");
    });
  }
});
