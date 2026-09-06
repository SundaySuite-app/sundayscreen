import { describe, expect, it } from "vitest";

import {
  chooseLayout,
  COLUMN_GAP_UNITS,
  estimateEm,
  FIT_MARGIN,
  gridShape,
  gridStyle,
  HEADING_UNITS,
  LINE_UNITS,
  longestGroup,
  longestNameEm,
  NAME_EM_FALLBACK,
  NAME_EM_MAX,
  NAME_EM_MIN,
  sizeFor,
} from "./groups-fit-core";

// The panels a 25-pupil board gets on the two projector sizes the classroom
// round measures against, as content boxes (what `cqw`/`cqh` resolve to).
// Read off the rendered app with Playwright, 2026-09-06; the readability
// journeys measure the same boxes live.
const CARD_1024_2 = { w: 188.9, h: 170.9 };
const BIG_1024_2 = { w: 431.5, h: 512.7 };
const CARD_1280_2 = { w: 240.3, h: 243.9 };
const BIG_1280_2 = { w: 557.6, h: 543.4 };
const CARD_1024_3 = { w: 118.9, h: 170.9 };
const BIG_1024_3 = { w: 272.3, h: 512.7 };

// Measured widths at 1em, Inter 600 (canvas measureText). «Andreas» is the
// widest of the twenty first names; «Anne-Sofie Kristiansen» the widest of
// the full-name list.
const ANDREAS = 4.06;
const ANNE_SOFIE = 11.24;

/** The measured font sizes are exact for a fixture; the pins below allow the
 *  reader to see them as such. */
const px = (n: number) => Math.round(n * 10) / 10;

describe("sizeFor — the stylesheet's formula, in pixels", () => {
  it("is the smaller of the height term and the width term", () => {
    const box = { w: 1000, h: 1000 };
    // 10 lines: height term 1000 / (10 × 1.42 + 1.1) = 65,4; width term for
    // a 4 em name in one column 1000 / (4 × 1.04) = 240 → height binds.
    expect(px(sizeFor(box, { lines: 10, cols: 1, nameEm: 4 }))).toBe(65.4);
    // A 40 em name: width term 1000 / 41,6 = 24 → width binds.
    expect(px(sizeFor(box, { lines: 10, cols: 1, nameEm: 40 }))).toBe(24);
  });

  it("charges a second column the gap AND the second name, in name units", () => {
    // The whole finding: (189 − gap) / 2 is the column, not 189 / 2. At
    // 20,8 px (the old height-bound size for five lines) a two-column row
    // of «Andreas» is 2 × 4,06 × 1,04 + 1 = 9,44 names wide = 196 px, and
    // the panel is 189 — so the width term now says 20,0, not 20,8.
    expect(
      px(sizeFor(CARD_1024_2, { lines: 5, cols: 2, nameEm: ANDREAS })),
    ).toBe(20);
    // The divisor really is the sum — no hidden `- 1em` anywhere.
    const s = sizeFor({ w: 100, h: 10_000 }, { lines: 1, cols: 2, nameEm: 3 });
    expect(s).toBeCloseTo(100 / (2 * 3 * FIT_MARGIN + COLUMN_GAP_UNITS), 10);
  });

  it("uses the exported constants, which are the stylesheet's literals", () => {
    // groups.module.css `.group > *`: 1.42, 1.1, 1.04 and the gap's 1. The
    // e2e tier pins the rendered size against this function; this pins the
    // function against the numbers a reader sees in the CSS.
    expect(LINE_UNITS).toBe(1.42);
    expect(HEADING_UNITS).toBe(1.1);
    expect(FIT_MARGIN).toBe(1.04);
    expect(COLUMN_GAP_UNITS).toBe(1);
  });
});

describe("chooseLayout — one column or two, by result", () => {
  it("splits ten first names on every classroom box (height binds)", () => {
    // 20 pupils in 2 groups: 10 to a panel, widest «Andreas».
    for (const box of [CARD_1024_2, BIG_1024_2, CARD_1280_2, BIG_1280_2]) {
      const fit = chooseLayout(box, 10, ANDREAS);
      expect(fit.cols, `${box.w}×${box.h}`).toBe(2);
      expect(fit.lines).toBe(5);
    }
    // …and the sizes are what the classroom round promised: ≥ 15 px on the
    // card, ≥ 40 px enlarged, for REAL names.
    expect(
      px(sizeFor(CARD_1024_2, chooseLayout(CARD_1024_2, 10, ANDREAS))),
    ).toBe(20);
    expect(px(sizeFor(BIG_1024_2, chooseLayout(BIG_1024_2, 10, ANDREAS)))).toBe(
      45.7,
    );
    expect(
      px(sizeFor(CARD_1280_2, chooseLayout(CARD_1280_2, 10, ANDREAS))),
    ).toBe(25.4);
    expect(px(sizeFor(BIG_1280_2, chooseLayout(BIG_1280_2, 10, ANDREAS)))).toBe(
      59,
    );
  });

  it("keeps thirteen full names in one column (width binds) — S2-2", () => {
    // 25 pupils in 2 groups, widest «Anne-Sofie Kristiansen». Split, the
    // width term halves to 7,7 px on the card and 17,7 enlarged; one column
    // is 8,7 and 26,2. The old rule split from eight names up regardless.
    for (const box of [CARD_1024_2, BIG_1024_2, CARD_1280_2, BIG_1280_2]) {
      expect(chooseLayout(box, 13, ANNE_SOFIE).cols, `${box.w}×${box.h}`).toBe(
        1,
      );
    }
    expect(
      px(sizeFor(CARD_1024_2, chooseLayout(CARD_1024_2, 13, ANNE_SOFIE))),
    ).toBe(8.7);
    expect(
      px(sizeFor(BIG_1024_2, chooseLayout(BIG_1024_2, 13, ANNE_SOFIE))),
    ).toBe(26.2);
    // And the split it no longer takes would have been smaller — the
    // comparison, spelled out.
    expect(
      sizeFor(BIG_1024_2, { lines: 7, cols: 2, nameEm: ANNE_SOFIE }),
    ).toBeLessThan(
      sizeFor(BIG_1024_2, { lines: 13, cols: 1, nameEm: ANNE_SOFIE }),
    );
  });

  it("three groups of nine full names: one column on the narrow panel", () => {
    expect(chooseLayout(CARD_1024_3, 9, ANNE_SOFIE).cols).toBe(1);
    expect(chooseLayout(BIG_1024_3, 9, ANNE_SOFIE).cols).toBe(1);
    expect(
      px(sizeFor(CARD_1024_3, chooseLayout(CARD_1024_3, 9, ANNE_SOFIE))),
    ).toBe(10.2);
  });

  it("never splits a single name, and not before the panel is measured", () => {
    expect(chooseLayout(BIG_1280_2, 1, ANDREAS).cols).toBe(1);
    expect(chooseLayout(null, 10, ANDREAS)).toEqual({
      lines: 10,
      cols: 1,
      nameEm: ANDREAS,
    });
  });

  it("splits only for a gain past rounding, never on a tie", () => {
    // A box where the two candidates land on the same number: for ten names
    // the one-column size is the height term, and the two-column size is
    // its width term — choose the width so the two are equal.
    const h = 1000;
    const one = h / (10 * LINE_UNITS + HEADING_UNITS);
    const w = one * (2 * ANDREAS * FIT_MARGIN + COLUMN_GAP_UNITS);
    expect(
      sizeFor({ w, h }, { lines: 10, cols: 1, nameEm: ANDREAS }),
    ).toBeCloseTo(one, 9);
    expect(
      sizeFor({ w, h }, { lines: 5, cols: 2, nameEm: ANDREAS }),
    ).toBeCloseTo(one, 9);
    expect(chooseLayout({ w, h }, 10, ANDREAS).cols).toBe(1);
    // A hair wider, and the split is worth it.
    expect(chooseLayout({ w: w * 1.02, h }, 10, ANDREAS).cols).toBe(2);
  });
});

describe("longestNameEm — measured, clamped, never zero", () => {
  const byLength = (n: string) => n.length * 0.5;

  it("is the widest name by the injected measure, not by character count", () => {
    // «Amanda» is six characters and 4,01 em; «Kristin» seven and 3,14. A
    // measure that knows that picks Amanda.
    const measure = (n: string) => (n === "Amanda" ? 4.01 : 3.14);
    expect(longestNameEm([["Kristin", "Amanda"]], measure)).toBe(4.01);
  });

  it("clamps to the floor and the ceiling", () => {
    expect(longestNameEm([["Bo", "Li"]], byLength)).toBe(NAME_EM_MIN);
    expect(longestNameEm([["x".repeat(80)]], byLength)).toBe(NAME_EM_MAX);
    expect(longestNameEm([], byLength)).toBe(NAME_EM_MIN);
  });

  it("keeps a 25-character real name under the ceiling", () => {
    // «Mohammed Abdullahi Hassan» measures 14,4 em in Inter 600 — the
    // ceiling exists for the outlier, not for a long surname.
    expect(NAME_EM_MAX).toBeGreaterThan(14.4);
  });

  it("estimates on the wide side when nothing can measure", () => {
    // Inter 600 runs 0,40–0,67 em per character across the twenty first
    // names; the fallback sits above the median so it errs towards small
    // type, never towards an ellipsis.
    expect(NAME_EM_FALLBACK).toBeGreaterThanOrEqual(0.58);
    expect(estimateEm("Andreas")).toBeCloseTo(7 * NAME_EM_FALLBACK, 10);
  });
});

describe("gridShape and gridStyle", () => {
  it("lays groups out near-square", () => {
    expect(gridShape(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(3)).toEqual({ cols: 3, rows: 1 });
    expect(gridShape(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridShape(10)).toEqual({ cols: 4, rows: 3 });
  });

  it("hands the stylesheet exactly the three inputs, per column", () => {
    const style = gridStyle(2, { lines: 5, cols: 2, nameEm: 4.0625 });
    expect(style).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(style).toContain("grid-template-rows: repeat(1, minmax(0, 1fr))");
    expect(style).toContain("--lines: 5");
    expect(style).toContain("--chip-cols: 2");
    expect(style).toContain("--name-em: 4.063");
    expect(style).not.toContain("--name-chars");
    expect(gridStyle(0, { lines: 1, cols: 1, nameEm: 4 })).toBe("");
  });

  it("longestGroup is the panel with the most names", () => {
    expect(longestGroup([["a"], ["b", "c", "d"], ["e", "f"]])).toBe(3);
    expect(longestGroup([])).toBe(0);
  });
});
