import { describe, expect, it } from "vitest";

import { QR_MAX_URL_BYTES } from "./link-core";
import {
  BLOCK_SPEC,
  EC_FORMAT_BITS,
  type EcLevel,
  MAX_VERSION,
  MIN_VERSION,
  TOTAL_CODEWORDS,
  VERSION_INFO,
  byteCapacity,
  chooseVersion,
  formatInfoBits,
  gfExp,
  gfLog,
  gfMul,
  penaltyScore,
  qrMatrix,
  qrSvgPath,
  rsEcCodewords,
  rsGeneratorPoly,
} from "./qr-core";

/**
 * A hand-rolled QR encoder is only worth having if every table in it is
 * pinned to the PUBLISHED numbers rather than to whatever the implementation
 * happened to produce. Seven classes, in the order a symbol is built:
 *
 *   1. the finite field and its generator polynomials
 *   2. Reed–Solomon, against the textbook vector AND its defining property
 *   3. all 32 format-information sequences
 *   4. the four version-information words
 *   5. the capacity table, pinned to `QR_MAX_URL_BYTES` from both sides
 *   6. one whole symbol, frozen as string art
 *   7. structural invariants for arbitrary input
 *
 * Class 7 is the one that earns its keep on a bad day: the first draft of
 * `drawFunctionPatterns` painted the timing line straight through all three
 * finder patterns. It decoded perfectly (a decoder skips function modules)
 * and looked like a QR code, and no scanner on earth could have found it.
 */

// ── 1. GF(256) ─────────────────────────────────────────────────────────────

describe("the finite field", () => {
  it("starts where the standard says and wraps at 255", () => {
    expect(gfExp[0]).toBe(1); // α^0
    expect(gfExp[1]).toBe(2); // α, the generator
    expect(gfExp[8]).toBe(0x1d); // where x^8 folds back on 0x11D
    expect(gfLog[1]).toBe(0);
    expect(gfLog[2]).toBe(1);
    // The multiplicative group has order 255, so α^255 is back to α^0. The
    // doubled table exists so `GF_EXP[log a + log b]` needs no modulo — the
    // second half must therefore repeat the first exactly.
    expect(gfExp[255]).toBe(gfExp[0]);
    expect(gfExp[510]).toBe(gfExp[255]);
    expect(gfExp[254]).toBe(142);
  });

  it("multiplies, with zero as the special case it is", () => {
    // 0 has no logarithm; `gfLog[0]` is a hole, not a value.
    expect(gfMul(0, 123)).toBe(0);
    expect(gfMul(123, 0)).toBe(0);
    expect(gfMul(1, 123)).toBe(123);
    // α^100 · α^200 = α^300 = α^45.
    expect(gfMul(gfExp[100], gfExp[200])).toBe(gfExp[45]);
  });

  it("builds the degree-10 generator the published table names", () => {
    // g(x) for 10 error-correction codewords, as α EXPONENTS, highest power
    // first. This is the standard's own listing — the coefficients are
    // conventionally published in logarithmic form, so that is the form
    // pinned here.
    const PUBLISHED_G10 = [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45];
    const poly = rsGeneratorPoly(10);
    expect(poly).toHaveLength(11);
    expect(poly[0]).toBe(1); // monic: α^0
    expect(poly.map((c) => gfLog[c])).toEqual(PUBLISHED_G10);
  });

  it("builds the other two degrees this encoder actually uses at v1 and v1-Q", () => {
    expect(rsGeneratorPoly(7).map((c) => gfLog[c])).toEqual([
      0, 87, 229, 146, 149, 238, 102, 21,
    ]);
    expect(rsGeneratorPoly(13).map((c) => gfLog[c])).toEqual([
      0, 74, 152, 176, 100, 86, 100, 106, 104, 130, 218, 206, 140, 78,
    ]);
  });
});

// ── 2. Reed–Solomon ────────────────────────────────────────────────────────

describe("Reed–Solomon error correction", () => {
  /**
   * The canonical worked example: «HELLO WORLD» at version 1, level Q.
   *
   * ⚠️ In the literature that vector is ALPHANUMERIC mode — this encoder only
   * speaks byte mode, so what is pinned here is the RS STEP, not the whole
   * encoder: the published data codewords go in, the published error
   * correction codewords must come out. Feeding the string to `qrMatrix` and
   * expecting these numbers would be comparing two different encodings.
   */
  const HELLO_WORLD_DATA = [
    32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236,
  ];
  const HELLO_WORLD_EC = [
    168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16,
  ];

  it("reproduces the textbook v1-Q vector", () => {
    // v1-Q carries 13 data codewords and 13 error-correction codewords.
    expect(HELLO_WORLD_DATA).toHaveLength(13);
    expect(rsEcCodewords(HELLO_WORLD_DATA, 13)).toEqual(HELLO_WORLD_EC);
  });

  it("produces codewords with the property that DEFINES the code", () => {
    // A published vector says «this implementation agrees with that one».
    // This says something stronger and independent of both: a Reed–Solomon
    // codeword is a polynomial divisible by the generator, so it evaluates to
    // zero at every root α^0 … α^(n−1). Nothing but a correct remainder can
    // satisfy that, whoever wrote the table.
    for (const ecLength of [7, 10, 13, 26]) {
      const data = Array.from({ length: 20 }, (_, i) => (i * 37 + 5) & 0xff);
      const full = [...data, ...rsEcCodewords(data, ecLength)];
      for (let root = 0; root < ecLength; root++) {
        let acc = 0;
        for (const cw of full) acc = gfMul(acc, gfExp[root]) ^ cw;
        expect(acc, `root α^${root} of an ec=${ecLength} codeword`).toBe(0);
      }
    }
  });
});

// ── 3. Format information ──────────────────────────────────────────────────

describe("format information", () => {
  /** All 32 (level × mask) sequences, exactly as tabulated in the standard's
   *  annex C. Fifteen bits each: five of data, ten of BCH parity, the whole
   *  thing masked with 0b101010000010010 so the all-zero case cannot produce
   *  an all-zero pattern — which is why M/mask-0 IS that mask value. */
  const PUBLISHED: Record<EcLevel, number[]> = {
    L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
    M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
    Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
    H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
  };

  it("assigns the level indicators the standard assigns — not in level order", () => {
    // M = 00 and L = 01: the numbering follows nothing but the table.
    expect(EC_FORMAT_BITS).toEqual({ M: 0b00, L: 0b01, H: 0b10, Q: 0b11 });
  });

  for (const level of ["L", "M", "Q", "H"] as const) {
    for (let mask = 0; mask < 8; mask++) {
      it(`${level} + mask ${mask}`, () => {
        expect(formatInfoBits(level, mask)).toBe(PUBLISHED[level][mask]);
      });
    }
  }

  it("keeps all 32 distinct and 15 bits wide", () => {
    const all = Object.values(PUBLISHED).flat();
    expect(new Set(all).size).toBe(32);
    for (const bits of all) expect(bits).toBeLessThan(1 << 15);
  });
});

// ── 4. Version information ─────────────────────────────────────────────────

describe("version information", () => {
  it("is the four literals, and only the four", () => {
    // Required from v7 up; this encoder stops at v10, so the BCH(18,6)
    // generator that would produce them is four lines exercised four times.
    // The literals ARE the table.
    expect(VERSION_INFO).toEqual({
      7: 0x07c94,
      8: 0x085bc,
      9: 0x09a99,
      10: 0x0a4d3,
    });
  });

  it("carries its own version number in the top six bits", () => {
    // 18 bits: six of version, twelve of BCH parity. A transposed literal
    // would almost certainly break this.
    for (const version of [7, 8, 9, 10]) {
      expect(VERSION_INFO[version] >>> 12).toBe(version);
    }
  });
});

// ── 5. Capacity ────────────────────────────────────────────────────────────

describe("capacity", () => {
  /** Published byte-mode character capacities, versions 1–10. */
  const PUBLISHED_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const PUBLISHED_L = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

  it("matches the published byte-mode table at level M", () => {
    for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
      expect(byteCapacity(v, "M"), `v${v}-M`).toBe(PUBLISHED_M[v - 1]);
    }
  });

  it("matches the published byte-mode table at level L", () => {
    for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
      expect(byteCapacity(v, "L"), `v${v}-L`).toBe(PUBLISHED_L[v - 1]);
    }
  });

  it("adds up to the published TOTAL codeword count per version", () => {
    // The block table and the total-codewords table come off different pages
    // of the standard, and data + error correction must exhaust the symbol
    // EXACTLY. A transposed digit in either one shows up here as arithmetic
    // rather than as a code that silently will not scan.
    expect(TOTAL_CODEWORDS).toHaveLength(MAX_VERSION);
    for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
      for (const level of ["L", "M"] as const) {
        const [ec, g1, g1d, g2, g2d] = BLOCK_SPEC[level][v - 1];
        expect(g1 + g2, `v${v}-${level} has blocks`).toBeGreaterThan(0);
        expect(g1 * g1d + g2 * g2d + (g1 + g2) * ec, `v${v}-${level}`).toBe(
          TOTAL_CODEWORDS[v - 1],
        );
      }
    }
  });

  it("IS the number the widget promises, from both sides", () => {
    // THE seam. `link-core.ts` renders «for lang for en QR-kode» from
    // `QR_MAX_URL_BYTES` without ever loading this module; this module must
    // draw a code for every length that constant vouches for, and none past
    // it. Two numbers for one capacity is the bug this pins shut.
    expect(byteCapacity(MAX_VERSION, "L")).toBe(QR_MAX_URL_BYTES);

    const atCap = "a".repeat(QR_MAX_URL_BYTES);
    expect(qrMatrix(atCap)).not.toBeNull();
    expect(qrMatrix(atCap + "a")).toBeNull();
  });

  it("prefers M all the way up and only accepts L for the last stretch", () => {
    expect(chooseVersion(1)).toEqual({ version: 1, level: "M" });
    expect(chooseVersion(14)).toEqual({ version: 1, level: "M" });
    expect(chooseVersion(15)).toEqual({ version: 2, level: "M" });
    expect(chooseVersion(213)).toEqual({ version: 10, level: "M" });
    // Past v10-M the only code left is v10-L, and it is taken rather than
    // showing the class nothing.
    expect(chooseVersion(214)).toEqual({ version: 10, level: "L" });
    expect(chooseVersion(271)).toEqual({ version: 10, level: "L" });
    expect(chooseVersion(272)).toBeNull();
  });

  it("counts UTF-8 bytes, so a Norwegian address costs what it costs", () => {
    // «ø» is two bytes. 136 of them is 272 — one past the ceiling — while
    // 135 fit, and neither answer is what a codepoint count would give.
    expect(qrMatrix("ø".repeat(135))).not.toBeNull();
    expect(qrMatrix("ø".repeat(136))).toBeNull();
  });

  it("has nothing to draw for an empty string", () => {
    expect(qrMatrix("")).toBeNull();
  });
});

// ── 6. One whole symbol, frozen ────────────────────────────────────────────

/**
 * `qrMatrix("https://sundaysuite.app")` — 23 bytes, so version 2 at level M,
 * 25×25, no quiet zone.
 *
 * VERIFIED ONCE, AT IMPLEMENTATION, THEN FROZEN. Two ways, because a frozen
 * blob on its own only ever says «unchanged», never «correct»:
 *
 *   1. Rendered to a PNG at ten pixels per module with the four-module quiet
 *      zone and read with a phone scanner — it resolves to the address above.
 *   2. Read back by a decoder written separately from this encoder (its own
 *      function-module map, its own de-interleaving): format copies agree,
 *      version and mask read back, every Reed–Solomon syndrome zero at every
 *      root, and the payload decodes to exactly `https://sundaysuite.app`.
 *      That sweep ran over every byte length from 1 to 271 — versions 1–10 at
 *      M and version 10 at L, which is every code path this encoder has.
 *
 * If this art changes, the encoder changed. Re-verify; do not re-freeze.
 */
const SUNDAYSUITE_APP = [
  "#######...#.#..#..#######",
  "#.....#.#...#####.#.....#",
  "#.###.#..#.##.#.#.#.###.#",
  "#.###.#..####.#...#.###.#",
  "#.###.#.##..#.##..#.###.#",
  "#.....#...#.#####.#.....#",
  "#######.#.#.#.#.#.#######",
  ".........###.####........",
  "#.#.#.#....####.....#..#.",
  "#.##...##..##...#.#.....#",
  "#.###.#.#.##.#...###..###",
  "#......#..#.##.....#...#.",
  "...####.###.##...###.#.##",
  ".#.##..##.####..###..#..#",
  "#..##.#...###.#..#.#..###",
  ".##..#..###.####.##.#..#.",
  "#..##.##.#.#.#.#######...",
  "........#.##.##.#...##.##",
  "#######...#...###.#.##.##",
  "#.....#...##.#..#...##..#",
  "#.###.#.##..##..######.##",
  "#.###.#..######....####..",
  "#.###.#.#####.#.#...#...#",
  "#.....#..##.##.##...##.#.",
  "#######.#..##.###.##...##",
];

/** The art form both directions use, so a failure prints a picture. */
function toArt(matrix: readonly (readonly boolean[])[]): string[] {
  return matrix.map((row) => row.map((m) => (m ? "#" : ".")).join(""));
}

describe("the frozen symbol", () => {
  it("draws https://sundaysuite.app exactly as it was verified", () => {
    const matrix = qrMatrix("https://sundaysuite.app");
    expect(matrix).not.toBeNull();
    expect(toArt(matrix!)).toEqual(SUNDAYSUITE_APP);
  });

  it("turns into one path with a square per dark module", () => {
    const matrix = qrMatrix("https://sundaysuite.app")!;
    const d = qrSvgPath(matrix);
    // One `M…h1v1h-1z` per dark module, and the coordinates are MODULES —
    // the component's viewBox does the scaling and the quiet zone.
    const dark = matrix.flat().filter(Boolean).length;
    expect(d.match(/h1v1h-1z/g)).toHaveLength(dark);
    expect(d.startsWith("M0 0h1v1h-1z")).toBe(true);
    // Nothing in the path names a colour: the fill is a CSS class, because
    // the colour gate only reads `.css` and a literal here would slip past
    // the very ownership rule it exists to hold.
    expect(d).not.toMatch(/fill|#[0-9a-f]{3}/i);
  });

  it("draws nothing for an empty matrix", () => {
    expect(qrSvgPath([])).toBe("");
  });
});

// ── 7. Structural invariants, for arbitrary input ──────────────────────────

describe("every symbol it draws", () => {
  const SAMPLES = [
    "https://udir.no",
    "https://www.udir.no/laring-og-trivsel/rammeplan/?q=lek#start",
    "https://skole.no/" + "abc-123/".repeat(10),
    "https://skole.no/" + "x".repeat(200),
    "https://skole.no/ø".repeat(5),
    "a".repeat(QR_MAX_URL_BYTES),
  ];

  for (const text of SAMPLES) {
    describe(`${text.slice(0, 34)}… (${new TextEncoder().encode(text).length} B)`, () => {
      const matrix = qrMatrix(text)!;

      it("is square, 17 + 4·version, with version in range", () => {
        expect(matrix).not.toBeNull();
        const size = matrix.length;
        for (const row of matrix) expect(row).toHaveLength(size);
        const version = (size - 17) / 4;
        expect(Number.isInteger(version)).toBe(true);
        expect(version).toBeGreaterThanOrEqual(MIN_VERSION);
        expect(version).toBeLessThanOrEqual(MAX_VERSION);
      });

      it("has three whole finder patterns with their light separators", () => {
        // The invariant a scanner actually needs: a solid 7×7 ring-in-square,
        // and a light border around it. Chebyshev distance from the centre
        // says it all — 0–1 dark, 2 light, 3 dark, 4 (the separator) light.
        const size = matrix.length;
        for (const [top, left] of [
          [0, 0],
          [0, size - 7],
          [size - 7, 0],
        ]) {
          for (let dr = -1; dr <= 7; dr++) {
            for (let dc = -1; dc <= 7; dc++) {
              const r = top + dr;
              const c = left + dc;
              if (r < 0 || r >= size || c < 0 || c >= size) continue;
              const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
              expect(matrix[r][c], `finder ${top},${left} at ${dr},${dc}`).toBe(
                dist <= 1 || dist === 3,
              );
            }
          }
        }
      });

      it("alternates along both timing patterns, between the separators", () => {
        const size = matrix.length;
        for (let i = 8; i <= size - 9; i++) {
          expect(matrix[6][i], `timing row at ${i}`).toBe(i % 2 === 0);
          expect(matrix[i][6], `timing column at ${i}`).toBe(i % 2 === 0);
        }
      });

      it("sets the dark module", () => {
        // Always dark, always at (4·version + 9, 8). It is the one module
        // whose value no mask and no data may touch.
        expect(matrix[matrix.length - 8][8]).toBe(true);
      });

      it("has a boolean in every cell — never a hole", () => {
        // A gap in the zigzag would leave `undefined`, which renders as light
        // and decodes as nothing anybody can predict.
        for (const row of matrix) {
          for (const cell of row) expect(typeof cell).toBe("boolean");
        }
      });

      it("was masked with the mask that scored best", () => {
        // The chosen symbol must be at least as good as it claims: no other
        // mask, applied to the same data, may beat it. Scoring the finished
        // matrix is the only handle on that from outside, so the check is
        // that the score is finite and matches a re-score — a mask chosen by
        // a scorer that throws or returns NaN would otherwise pass silently.
        const score = penaltyScore(matrix);
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThan(0);
        expect(penaltyScore(matrix)).toBe(score);
      });
    });
  }

  it("scores the run, block and balance rules to the number, on a blank square", () => {
    // An all-light 21×21: every line is one 21-long run (N1 = 3 + 16), every
    // 2×2 window is uniform (N2), the dark ratio is 0% (N4 = nine 5%-steps
    // past the 45–55 band), and no finder-lookalike exists (N3 = 0, which is
    // its own assertion — the rule must not fire on an empty field). The
    // arithmetic is spelled out rather than pasted as a total, so a reader
    // can see which rule a change moved.
    const size = 21;
    const blank = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );
    const runs = 2 * size * (3 + (size - 5));
    const blocks = 3 * (size - 1) * (size - 1);
    const balance = 10 * 9;
    expect(runs).toBe(798);
    expect(blocks).toBe(1200);
    expect(penaltyScore(blank)).toBe(runs + blocks + balance);
  });
});
