// The look's vocabulary: complete, in step with Rust, and unique per card.

import { describe, expect, it } from "vitest";

import type { DieColor } from "../../bindings/DieColor";
import type { DieMaterial } from "../../bindings/DieMaterial";
import en from "../../i18n/locales/en.json";
import no from "../../i18n/locales/no.json";
import {
  DIE_COLORS,
  DIE_MATERIALS,
  dieDefId,
  MATERIAL_TRAITS,
} from "./die-materials-core";

/** Every variant the generated union carries, spelled out so a variant added
 *  in Rust and forgotten here is a TYPE error rather than a missing swatch.
 *  `satisfies` checks the direction a list cannot: no extras. */
const EVERY_COLOR = {
  classic: 1,
  red: 1,
  blue: 1,
  green: 1,
  gold: 1,
  slate: 1,
} satisfies Record<DieColor, number>;

const EVERY_MATERIAL = {
  ivory: 1,
  casino: 1,
  wood: 1,
  metal: 1,
  glass: 1,
} satisfies Record<DieMaterial, number>;

describe("the picker's vocabulary", () => {
  it("offers every colour the config can hold, once", () => {
    expect([...DIE_COLORS].sort()).toEqual(Object.keys(EVERY_COLOR).sort());
    expect(new Set(DIE_COLORS).size).toBe(DIE_COLORS.length);
  });

  it("offers every material the config can hold, once", () => {
    expect([...DIE_MATERIALS].sort()).toEqual(
      Object.keys(EVERY_MATERIAL).sort(),
    );
    expect(new Set(DIE_MATERIALS).size).toBe(DIE_MATERIALS.length);
  });

  it("starts where a die is born", () => {
    // `defaultConfig()` in index.ts and `DieColor::default()` in layout.rs
    // both say classic/ivory. The picker showing them FIRST is not a
    // coincidence to be maintained by hand: the default has to be the one a
    // teacher's eye lands on before she has chosen anything.
    expect(DIE_COLORS[0]).toBe("classic");
    expect(DIE_MATERIALS[0]).toBe("ivory");
  });

  it("has a name for every swatch, in both catalogues", () => {
    // The panel labels each swatch with `tDyn("dice.colorName", …)`, which
    // the i18n gate cannot follow. This is the half it cannot see.
    for (const tree of [no, en]) {
      for (const colour of DIE_COLORS) {
        const name = (tree.dice.colorName as Record<string, string>)[colour];
        expect(typeof name, `dice.colorName.${colour}`).toBe("string");
        expect(name.trim()).not.toBe("");
      }
      for (const material of DIE_MATERIALS) {
        const name = (tree.dice.materialName as Record<string, string>)[
          material
        ];
        expect(typeof name, `dice.materialName.${material}`).toBe("string");
        expect(name.trim()).not.toBe("");
      }
    }
  });
});

describe("MATERIAL_TRAITS", () => {
  it("describes every material", () => {
    expect(Object.keys(MATERIAL_TRAITS).sort()).toEqual(
      [...DIE_MATERIALS].sort(),
    );
  });

  it("glass is the only finish that draws what is turned away", () => {
    // The licence for `die-project-core`'s culling is that nothing behind is
    // ever drawn. Glass is the documented exception; a second one would mean
    // the renderer is painting faces in an order nobody has thought about.
    const drawsBack = DIE_MATERIALS.filter((m) => MATERIAL_TRAITS[m].backFaces);
    expect(drawsBack).toEqual(["glass"]);
  });

  it("the plate exists exactly where the back edges do", () => {
    // The plate is not a look — it is what keeps a numeral readable once the
    // far edges are drawn across it. One without the other is either an
    // unreadable die or a smudge under a numeral for no reason.
    for (const material of DIE_MATERIALS) {
      expect(MATERIAL_TRAITS[material].plate, material).toBe(
        MATERIAL_TRAITS[material].backFaces,
      );
    }
  });

  it("the plainest finish asks for nothing", () => {
    expect(MATERIAL_TRAITS.ivory).toEqual({
      backFaces: false,
      grain: false,
      gloss: false,
      plate: false,
    });
  });
});

describe("dieDefId", () => {
  it("is unique per card and per part", () => {
    const a = dieDefId("11111111-2222-3333-4444-555555555555", "grain0");
    const b = dieDefId("99999999-2222-3333-4444-555555555555", "grain0");
    const c = dieDefId("11111111-2222-3333-4444-555555555555", "grain1");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("never starts with a digit, whatever the widget id is", () => {
    // `crypto.randomUUID()` starts with a hex digit half the time.
    expect(dieDefId("7f3a", "gloss")).toMatch(/^[A-Za-z]/);
  });

  it("is safe to put inside url(#…)", () => {
    // Whitespace, quotes or a `#` in an id turn a fill reference into
    // silently nothing — a die that renders with no faces at all.
    expect(dieDefId("7f3a-91bd", "grain4")).toMatch(/^[A-Za-z][\w-]*$/);
  });
});
