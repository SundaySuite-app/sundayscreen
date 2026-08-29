// Shape tests for the icon vocabulary: every path parses as plain SVG path
// data on the 24-grid, so a typo in a hand-drawn `d` string fails here and
// not as an invisible glyph on the projector.

import { describe, expect, it } from "vitest";

import { ICON_NAMES, ICON_PATHS, ICON_STROKE_WIDTH } from "./icon-paths";

// Commands used by this vocabulary; a new command letter is fine, add it here.
const PATH_SYNTAX = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.-]+$/;

describe("ICON_PATHS", () => {
  it("has a sane stroke width for the 24-grid", () => {
    expect(ICON_STROKE_WIDTH).toBeGreaterThan(1);
    expect(ICON_STROKE_WIDTH).toBeLessThan(3);
  });

  for (const name of ICON_NAMES) {
    it(`${name}: every path is non-empty, starts with a moveto and parses`, () => {
      const paths = ICON_PATHS[name] as readonly string[];
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d.trim()).not.toBe("");
        expect(d[0]).toBe("M");
        expect(d, `bad path syntax in ${name}: ${d}`).toMatch(PATH_SYNTAX);
      }
    });

    it(`${name}: coordinates stay on the 24-grid`, () => {
      const paths = ICON_PATHS[name] as readonly string[];
      for (const d of paths) {
        const nums = d.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
        for (const n of nums) {
          const v = Number(n);
          // Relative arcs/curves use small deltas; absolute coords must be
          // inside the box with a little breathing room for curve handles.
          expect(v, `${name}: ${d}`).toBeGreaterThanOrEqual(-24);
          expect(v, `${name}: ${d}`).toBeLessThanOrEqual(24.5);
        }
      }
    });
  }
});
