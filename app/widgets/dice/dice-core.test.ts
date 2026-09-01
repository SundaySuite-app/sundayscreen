import { describe, expect, it } from "vitest";

import {
  ZERO_BASED_FACES,
  DIE_TYPE_OPTIONS,
  dieFromU32,
  FACE_OPTIONS,
  PIP_FACES,
  PIPS,
  randomDie,
  snapFaces,
  u32Limit,
} from "./dice-core";
import { solidFor } from "./die-solids-core";

describe("FACE_OPTIONS", () => {
  /** THE DRIFT PIN (TypeScript half) — see the doc on FACE_OPTIONS. Its twin
   *  is `dice_face_options_are_pinned` in
   *  `crates/sundayscreen-core/src/layout.rs`. Both must be edited together;
   *  editing one alone turns exactly one of them red, which is the point. */
  it("mirrors the Rust list DICE_FACE_OPTIONS, literally", () => {
    expect(FACE_OPTIONS).toEqual([4, 6, 8, 10, 12, 20]);
  });

  it("is ascending, and the pip face is one of them", () => {
    expect([...FACE_OPTIONS].sort((a, b) => a - b)).toEqual([...FACE_OPTIONS]);
    expect(FACE_OPTIONS).toContain(PIP_FACES);
  });

  it("every type offered has a body to draw", () => {
    // The offer and the geometry are two lists in two files, and a seventh
    // type added to one of them would otherwise render as nothing at all.
    // `solidFor` SNAPS rather than throwing, so the check is that the body it
    // hands back is the type that was asked for.
    for (const faces of FACE_OPTIONS) {
      expect(solidFor(faces).sides, `d${faces} has no body`).toBe(faces);
    }
  });
});

describe("snapFaces", () => {
  it("picks the nearest offered type, ties LOW — same rule as Rust", () => {
    const cases: [number, number][] = [
      [0, 4],
      [3, 4],
      [5, 4],
      [6, 6],
      [7, 6],
      [9, 8],
      [11, 10],
      [16, 12],
      [17, 20],
      [100, 20],
    ];
    for (const [raw, expected] of cases) {
      expect(snapFaces(raw), `snapping d${raw}`).toBe(expected);
    }
  });

  it("treats a non-number as the d6 everything was before this round", () => {
    expect(snapFaces(NaN)).toBe(6);
    expect(snapFaces(Infinity)).toBe(6);
  });
});

describe("the number", () => {
  it("rejects the biased tail rather than folding it", () => {
    const limit = u32Limit(20);
    expect(limit % 20).toBe(0);
    expect(dieFromU32(limit, 20)).toBeNull();
    expect(dieFromU32(limit - 1, 20)).toBe(20);
    expect(dieFromU32(0, 20)).toBe(1);
    expect(dieFromU32(19, 20)).toBe(20);
    // Anything that is not a u32 is not a draw.
    expect(dieFromU32(-1, 6)).toBeNull();
    expect(dieFromU32(2 ** 32, 6)).toBeNull();
    expect(dieFromU32(1.5, 6)).toBeNull();
  });

  it("stays inside 1..=faces for every type", () => {
    for (const faces of FACE_OPTIONS) {
      for (let raw = 0; raw < 64; raw++) {
        const value = dieFromU32(raw, faces);
        expect(value).not.toBeNull();
        expect(value!).toBeGreaterThanOrEqual(1);
        expect(value!).toBeLessThanOrEqual(faces);
      }
    }
  });

  it("retries past a rejected draw", () => {
    const limit = u32Limit(20);
    const draws = [limit + 1, limit + 2, 19];
    let i = 0;
    expect(randomDie(20, () => draws[i++])).toBe(20);
    expect(i).toBe(3);
  });

  it("gives up rather than hanging on a source that only rejects", () => {
    // Liveness beats a bias nobody can observe: a classroom die that never
    // lands is a worse failure than one that is imperceptibly unfair in a
    // case that does not happen with real OS entropy.
    const value = randomDie(6, () => u32Limit(6));
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
  });

  it("snaps an off-list type before rolling", () => {
    // Never a 17 on a die that has to be drawn as a d20.
    for (let raw = 0; raw < 40; raw++) {
      expect(randomDie(100, () => raw)).toBeLessThanOrEqual(20);
    }
  });

  it("uses OS entropy by default and covers the whole die", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(randomDie(6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("PIPS", () => {
  it("has one arrangement per d6 value, with that many pips", () => {
    for (let value = 1; value <= 6; value++) {
      expect(PIPS[value]).toHaveLength(value);
    }
  });
});

describe("the 0–9 type", () => {
  it("offers the pair list the picker draws — one zero-based entry, on the d10 alone", () => {
    // Every Rust-pinned body appears exactly once as a 1..n type…
    expect(
      DIE_TYPE_OPTIONS.filter((o) => !o.zeroBased).map((o) => o.faces),
    ).toEqual([...FACE_OPTIONS]);
    // …and the zero-based reading exists only where a real die has one.
    const zeroed = DIE_TYPE_OPTIONS.filter((o) => o.zeroBased);
    expect(zeroed).toEqual([{ faces: ZERO_BASED_FACES, zeroBased: true }]);
    expect(ZERO_BASED_FACES).toBe(10);
  });

  it("rolls 0..9 — fair shift of the fair draw, zero included", () => {
    const seen = new Set<number>();
    for (let raw = 0; raw < 40; raw++) {
      const v = randomDie(10, () => raw, true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(9);
      seen.add(v);
    }
    expect(seen.size).toBe(10);
    // The shift is the label's, not the sampler's: same draw, one apart.
    expect(randomDie(10, () => 7, true)).toBe(randomDie(10, () => 7) - 1);
  });

  it("ignores the flag off the d10 — the snap decides the body first", () => {
    expect(randomDie(6, () => 3, true)).toBe(randomDie(6, () => 3));
    // A d100 config snaps to the d20 body, which has no zero-based reading.
    expect(randomDie(100, () => 3, true)).toBe(randomDie(100, () => 3));
  });
});
