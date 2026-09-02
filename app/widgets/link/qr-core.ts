// The QR encoder — hand-rolled, byte mode only, versions 1–10, EC levels M
// (primary) and L (the one fallback). Pure: bytes in, a boolean matrix out.
// No DOM, no dependency, no network. `qr-core.test.ts` pins every table in
// here against the published ISO/IEC 18004 values.
//
// ── Why hand-rolled, and why THIS small ────────────────────────────────────
//
// ADR-015's precedent: an engine that fits in a `*-core.ts` and can be pinned
// against published vectors is worth more here than a dependency, because the
// app ships offline and every megabyte of node_modules is a supply chain the
// teacher's machine has to trust. The subset is chosen by what a CLASSROOM
// can actually use, not by what the standard allows:
//
//   - **Byte mode only.** Alphanumeric and numeric modes are pure size
//     optimisations. A URL is mostly lowercase, which alphanumeric mode
//     cannot even express, so the optimisation would rarely fire and every
//     mode is another table to get wrong.
//   - **Versions 1–10 (21×21 … 57×57).** Above v10 the modules get so small
//     that a card on a projector, photographed from the back row, stops
//     resolving them — a code nobody can scan is worse than the honest
//     «this link is too long for a QR code» the widget shows instead.
//   - **EC level M, falling back to L only at v10.** M survives a hand in
//     front of the projector; L is accepted for the last stretch of URL
//     length (214–271 bytes) because at that point the choice is a
//     lower-redundancy code or no code at all.
//
// ── The capacity constant lives in link-core.ts, not here ──────────────────
//
// `QR_MAX_URL_BYTES` is imported, never restated. The widget must answer «too
// long?» BEFORE this module is loaded (the encoder is a lazy chunk), so the
// number has to live on the eager side — and one number for one capacity is
// how this house stops the seam bug where two copies drift.

import { QR_MAX_URL_BYTES } from "./link-core";

/** The four error-correction levels. The encoder only ever CHOOSES `M` or
 *  `L` (see `chooseVersion`); `Q` and `H` exist because the format-information
 *  table below is a 32-entry published table and half a table is not a
 *  table — the test pins all 32 sequences. */
export type EcLevel = "L" | "M" | "Q" | "H";

/** The 2-bit level indicator that goes into the format information.
 *  Deliberately NOT in numeric order — the standard assigns M = 00. */
export const EC_FORMAT_BITS: Record<EcLevel, number> = {
  M: 0b00,
  L: 0b01,
  H: 0b10,
  Q: 0b11,
};

/** Lowest and highest version this encoder will emit. */
export const MIN_VERSION = 1;
export const MAX_VERSION = 10;

/**
 * Block structure per version, for the two levels this encoder uses.
 *
 * `[ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks,
 * group2DataCodewords]`, indexed by `version - 1`. Straight from the
 * standard's block table.
 *
 * Exported so the test can check it against `TOTAL_CODEWORDS`, which comes
 * from a different table entirely: data + error correction must exhaust the
 * symbol exactly, so a transposed digit in either table shows up as an
 * arithmetic failure rather than as a code that silently will not scan.
 */
export const BLOCK_SPEC: Record<"L" | "M", readonly (readonly number[])[]> = {
  L: [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
  ],
};

/** Total codewords (data + error correction) per version — the standard's
 *  table 1, versions 1–10. Only used as a cross-check in the test, which is
 *  the point: it is an INDEPENDENT number that the block table above must
 *  add up to. */
export const TOTAL_CODEWORDS: readonly number[] = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
];

/** Alignment-pattern centre coordinates per version (standard table E.1).
 *  v1 has none; the row-and-column product minus the three that collide with
 *  the finder patterns is what actually gets drawn. */
const ALIGNMENT_CENTRES: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** Version-information bit patterns, required from v7 up. FOUR pinned
 *  literals — this encoder stops at v10, so the generator polynomial that
 *  produces them (BCH(18,6), 0x1F25) would be four lines of code exercised
 *  four times. The literals ARE the table. */
export const VERSION_INFO: Readonly<Record<number, number>> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

// ── GF(256) — the field the Reed–Solomon coding lives in ────────────────────
//
// Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 = 0x11D, generator α = 2.
// Built once at module load: 512 entries is nothing, and a table beats a
// multiply-and-reduce loop in both speed and readability.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // The second half repeats the first so `GF_EXP[a + b]` needs no modulo.
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

/** Read-only views for the test to spot-check. */
export const gfExp: Readonly<Uint8Array> = GF_EXP;
export const gfLog: Readonly<Uint8Array> = GF_LOG;

/** Multiplication in GF(256). Zero is special-cased because it has no
 *  logarithm — `GF_LOG[0]` is a hole in the table, not a value. */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * The generator polynomial of degree `degree`, as coefficients in ordinary
 * (not logarithmic) form, highest power first and always leading with 1.
 *
 * g(x) = (x − α^0)(x − α^1) … (x − α^(degree−1)). The test pins degree 10
 * against the published coefficient list.
 */
export function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // Multiply by (x − α^i); subtraction is XOR here, so the sign is moot.
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/**
 * The `ecLength` error-correction codewords for one block of data codewords:
 * the remainder of the message polynomial divided by the generator.
 *
 * The defining property — and what makes this checkable without trusting the
 * implementation that produced the numbers — is that the FULL codeword
 * (data followed by these) evaluates to zero at every root of the generator,
 * which for QR is α^0 … α^(ecLength − 1) and NOT α^1 upward. The test checks
 * exactly that, next to the published «HELLO WORLD» vector.
 */
export function rsEcCodewords(
  data: readonly number[],
  ecLength: number,
): number[] {
  const gen = rsGeneratorPoly(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i++) {
      remainder[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return remainder;
}

// ── Format information ─────────────────────────────────────────────────────

/**
 * The 15-bit format-information sequence for one (level, mask) pair:
 * five data bits, ten BCH(15,5) parity bits, the whole thing XOR-ed with
 * 0b101010000010010 so the all-zero case cannot produce an all-zero pattern.
 *
 * All 32 outputs are pinned as a literal table in the test — the two-pins-one-
 * set shape this house uses for anything with a published answer.
 */
export function formatInfoBits(level: EcLevel, mask: number): number {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

// ── Capacity ───────────────────────────────────────────────────────────────

/** Data codewords available at this version and level. */
function dataCodewords(version: number, level: "L" | "M"): number {
  const [, g1, g1d, g2, g2d] = BLOCK_SPEC[level][version - 1];
  return g1 * g1d + g2 * g2d;
}

/**
 * How many UTF-8 bytes fit in byte mode at this version and level.
 *
 * The overhead is the 4-bit mode indicator plus the character-count
 * indicator, which is 8 bits up to v9 and 16 bits from v10 — that jump is
 * why v10-L holds 271 bytes and not 272, and it is exactly the kind of
 * off-by-one that a computed capacity gets right and a hand-typed table gets
 * wrong. Hence: computed here, pinned against the published byte-mode table
 * in the test.
 */
export function byteCapacity(version: number, level: "L" | "M"): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits) / 8);
}

/**
 * The smallest version that holds `byteLength`, at the best level available.
 *
 * M all the way up; only when the largest M code is full does it accept L —
 * at v10, where the alternative is no code at all. `null` means the widget
 * shows `link.qrTooLong` instead.
 *
 * The ceiling is `QR_MAX_URL_BYTES`, IMPORTED from `link-core.ts` and not
 * restated: the widget has already promised the teacher a code at that
 * length (it renders the «too long» hint from the same number, without ever
 * loading this module), so this is the same promise kept rather than a second
 * opinion about it. `qr-core.test.ts` pins the two together from both sides —
 * `byteCapacity(10, "L")` MUST equal that constant, or the eager half and the
 * lazy half disagree about which URLs get a code.
 */
export function chooseVersion(
  byteLength: number,
): { version: number; level: "L" | "M" } | null {
  if (byteLength > QR_MAX_URL_BYTES) return null;
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    if (byteCapacity(v, "M") >= byteLength) return { version: v, level: "M" };
  }
  // Past v10-M there is exactly one code left that can hold it, and the
  // ceiling above has already established that it does.
  return { version: MAX_VERSION, level: "L" };
}

// ── Bit assembly ───────────────────────────────────────────────────────────

/** The final, interleaved codeword stream for one message. */
function codewordStream(
  bytes: Uint8Array,
  version: number,
  level: "L" | "M",
): number[] {
  const [ecPerBlock, g1, g1d, g2, g2d] = BLOCK_SPEC[level][version - 1];
  const capacityBits = dataCodewords(version, level) * 8;

  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  // Terminator: up to four zero bits, fewer if the codeword capacity is
  // nearly full. Then zero-fill to a byte boundary.
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);

  // Pad bytes, alternating, as the standard specifies. Not arbitrary filler:
  // 0xEC/0x11 is what every decoder expects to find and ignore.
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
    push(pad, 8);
  }

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }

  // Split into blocks, error-correct each, then INTERLEAVE both halves — a
  // burst of damage then lands one codeword deep in many blocks rather than
  // wiping one block out entirely, which is the whole point of blocking.
  const blocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < g1; i++) blocks.push(data.slice(at, (at += g1d)));
  for (let i = 0; i < g2; i++) blocks.push(data.slice(at, (at += g2d)));
  const ecBlocks = blocks.map((b) => rsEcCodewords(b, ecPerBlock));

  const out: number[] = [];
  const longest = Math.max(g1d, g2d);
  for (let i = 0; i < longest; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const e of ecBlocks) out.push(e[i]);
  }
  return out;
}

// ── The symbol itself ──────────────────────────────────────────────────────

/** Working state while a symbol is being drawn: the modules, and which of
 *  them are FUNCTION patterns (never masked, never carry data). */
interface Canvas {
  size: number;
  modules: boolean[][];
  reserved: boolean[][];
}

function blankCanvas(version: number): Canvas {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
    reserved: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
  };
}

function setFunction(cv: Canvas, row: number, col: number, dark: boolean) {
  cv.modules[row][col] = dark;
  cv.reserved[row][col] = true;
}

/** A finder pattern plus its light separator, drawn as one 9×9 neighbourhood
 *  clipped to the symbol. Chebyshev distance from the centre says everything:
 *  0–1 dark (the 3×3 core), 2 light, 3 dark (the ring), 4 light (separator). */
function drawFinder(cv: Canvas, top: number, left: number) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = top + dr;
      const c = left + dc;
      if (r < 0 || r >= cv.size || c < 0 || c >= cv.size) continue;
      const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      setFunction(cv, r, c, dist <= 1 || dist === 3);
    }
  }
}

/** A 5×5 alignment pattern: dark ring, light ring, dark centre. */
function drawAlignment(cv: Canvas, row: number, col: number) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      setFunction(cv, row + dr, col + dc, dist !== 1);
    }
  }
}

function drawFunctionPatterns(cv: Canvas, version: number) {
  const size = cv.size;

  // ORDER IS LOAD-BEARING. The timing pattern is drawn across the FULL row 6
  // and column 6 first, and the finders then overwrite their own corners.
  // Do it the other way round and the timing line eats one row and one column
  // straight through each finder — which still round-trips through a decoder
  // that skips function modules, and still looks like a QR code at a glance,
  // but no scanner can LOCATE a finder that is not a solid ring. (It was
  // written the other way round first; the structural test below is what
  // says so out loud.) What survives is exactly the standard's picture: the
  // timing line runs only between the separators.
  for (let i = 0; i < size; i++) {
    setFunction(cv, 6, i, i % 2 === 0);
    setFunction(cv, i, 6, i % 2 === 0);
  }

  drawFinder(cv, 0, 0);
  drawFinder(cv, 0, size - 7);
  drawFinder(cv, size - 7, 0);

  // Alignment patterns at every pairing of the centre coordinates, minus the
  // three that would sit on top of a finder pattern.
  const centres = ALIGNMENT_CENTRES[version - 1];
  const last = centres.length - 1;
  for (let i = 0; i < centres.length; i++) {
    for (let j = 0; j < centres.length; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0);
      if (!corner) drawAlignment(cv, centres[i], centres[j]);
    }
  }

  // Reserve the format-information strips. The values are written later, once
  // a mask has been chosen; reserving now keeps data out of them.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunction(cv, 8, i, false);
      setFunction(cv, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunction(cv, 8, size - 1 - i, false);
    setFunction(cv, size - 1 - i, 8, false);
  }

  // The dark module — a single fixed black cell, always at (4·version + 9, 8).
  setFunction(cv, size - 8, 8, true);

  // Version information: two 6×3 blocks, from v7 up.
  if (version >= 7) {
    const bits = VERSION_INFO[version];
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(cv, b, a, dark);
      setFunction(cv, a, b, dark);
    }
  }
}

/** The zigzag: two-module-wide columns walked right to left, alternating
 *  upward and downward, skipping the vertical timing column. */
function drawCodewords(cv: Canvas, codewords: readonly number[]) {
  const totalBits = codewords.length * 8;
  let bit = 0;
  for (let right = cv.size - 1; right >= 1; right -= 2) {
    // Column 6 is the timing pattern; the pairing shifts left past it.
    if (right === 6) right = 5;
    for (let vert = 0; vert < cv.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? cv.size - 1 - vert : vert;
        if (!cv.reserved[row][col] && bit < totalBits) {
          const byte = codewords[bit >>> 3];
          cv.modules[row][col] = ((byte >>> (7 - (bit & 7))) & 1) !== 0;
          bit++;
        }
        // Anything left over is a REMAINDER bit: always zero, already false,
        // and still masked below — exactly as the standard requires.
      }
    }
  }
}

/** The eight data-mask conditions, by mask number. `row`/`col` are the
 *  module's coordinates; a true result inverts that module. */
function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(cv: Canvas, mask: number) {
  for (let row = 0; row < cv.size; row++) {
    for (let col = 0; col < cv.size; col++) {
      if (!cv.reserved[row][col] && maskCondition(mask, row, col)) {
        cv.modules[row][col] = !cv.modules[row][col];
      }
    }
  }
}

function drawFormatInfo(cv: Canvas, level: EcLevel, mask: number) {
  const bits = formatInfoBits(level, mask);
  const at = (i: number) => ((bits >>> i) & 1) !== 0;
  const size = cv.size;

  // First copy: up the left of the top-left finder, then along its underside.
  for (let i = 0; i <= 5; i++) setFunction(cv, i, 8, at(i));
  setFunction(cv, 7, 8, at(6));
  setFunction(cv, 8, 8, at(7));
  setFunction(cv, 8, 7, at(8));
  for (let i = 9; i < 15; i++) setFunction(cv, 8, 14 - i, at(i));

  // Second copy: along the top-right, then down the bottom-left.
  for (let i = 0; i < 8; i++) setFunction(cv, 8, size - 1 - i, at(i));
  for (let i = 8; i < 15; i++) setFunction(cv, size - 15 + i, 8, at(i));

  // The dark module is part of neither copy but shares their neighbourhood,
  // so it is re-asserted here rather than trusted to have survived.
  setFunction(cv, size - 8, 8, true);
}

// ── Penalty scoring — all four rules, spec-correct ──────────────────────────

const PENALTY_RUN = 3; // N1: a run of five, +1 per module beyond
const PENALTY_BLOCK = 3; // N2: per 2×2 block of one colour
const PENALTY_FINDER = 40; // N3: per finder-lookalike
const PENALTY_BALANCE = 10; // N4: per 5% of imbalance beyond 45–55

/**
 * Rule N3 is the fiddly one: it looks for the 1:1:3:1:1 ratio of the finder
 * pattern with four light modules on one side. Rather than pattern-matching a
 * bit string, the run LENGTHS are kept in a seven-deep history and the ratio
 * is checked against them — which is what makes the «four light modules»
 * clause expressible when those modules run off the edge of the symbol (the
 * quiet zone counts as light, so an initial or final run is padded by the
 * symbol size).
 */
function countFinderLookalikes(history: readonly number[]): number {
  const n = history[1];
  const core =
    n > 0 &&
    history[2] === n &&
    history[3] === n * 3 &&
    history[4] === n &&
    history[5] === n;
  return (
    (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  );
}

function pushRun(history: number[], length: number, size: number) {
  // An empty history means this is the first run of the line, and the quiet
  // zone in front of it is light.
  const padded = history[0] === 0 ? length + size : length;
  history.pop();
  history.unshift(padded);
}

/** N1 + N3 along one line (a row or a column), given its modules. */
function lineScore(line: readonly boolean[], size: number): number {
  let score = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  let runColor = false;
  let runLength = 0;

  for (const dark of line) {
    if (dark === runColor) {
      runLength++;
      if (runLength === 5) score += PENALTY_RUN;
      else if (runLength > 5) score++;
    } else {
      pushRun(history, runLength, size);
      if (!runColor) score += countFinderLookalikes(history) * PENALTY_FINDER;
      runColor = dark;
      runLength = 1;
    }
  }

  // Terminate: a trailing dark run has to be closed before the final light
  // run (the quiet zone) is pushed.
  let tail = runLength;
  if (runColor) {
    pushRun(history, tail, size);
    tail = 0;
  }
  pushRun(history, tail + size, size);
  score += countFinderLookalikes(history) * PENALTY_FINDER;
  return score;
}

/** The total penalty for a finished, masked symbol. Lower is better. */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;

  for (let row = 0; row < size; row++) score += lineScore(modules[row], size);
  for (let col = 0; col < size; col++) {
    const line = new Array<boolean>(size);
    for (let row = 0; row < size; row++) line[row] = modules[row][col];
    score += lineScore(line, size);
  }

  // N2: every 2×2 window of one colour.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const c = modules[row][col];
      if (
        c === modules[row][col + 1] &&
        c === modules[row + 1][col] &&
        c === modules[row + 1][col + 1]
      ) {
        score += PENALTY_BLOCK;
      }
    }
  }

  // N4: how far the dark proportion strays from half, in 5% steps.
  let dark = 0;
  for (const row of modules) for (const c of row) if (c) dark++;
  const total = size * size;
  const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += steps * PENALTY_BALANCE;

  return score;
}

// ── The two exported functions ─────────────────────────────────────────────

/**
 * Encode `text` as a QR symbol, or `null` if it does not fit in what this
 * encoder will draw (more than `QR_MAX_URL_BYTES` UTF-8 bytes).
 *
 * The returned matrix is `[row][col]`, `true` = dark, with NO quiet zone —
 * the caller adds it (the SVG does it with a negative viewBox origin, which
 * costs nothing and cannot be forgotten in one place and not another).
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return null;
  const choice = chooseVersion(bytes.length);
  if (!choice) return null;

  const { version, level } = choice;
  const cv = blankCanvas(version);
  drawFunctionPatterns(cv, version);
  drawCodewords(cv, codewordStream(bytes, version, level));

  // All eight masks, scored in full; the standard's own tie-break is «lowest
  // penalty», and on a tie the lowest mask number wins by walking in order.
  const unmasked = cv.modules.map((row) => row.slice());
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    cv.modules = unmasked.map((row) => row.slice());
    applyMask(cv, mask);
    drawFormatInfo(cv, level, mask);
    const score = penaltyScore(cv.modules);
    if (score < bestScore) {
      bestScore = score;
      best = cv.modules.map((row) => row.slice());
    }
  }
  return best;
}

/**
 * One SVG path covering every dark module: a 1×1 square per module, in a
 * coordinate system where one unit IS one module. The caller sets the
 * viewBox (and therefore the quiet zone) and the fill (a CSS class — the
 * colour gate only reads `.css`, and a `fill="#000"` here would slip past it
 * while breaking the very palette ownership the gate exists to hold).
 */
export function qrSvgPath(matrix: readonly (readonly boolean[])[]): string {
  let d = "";
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      if (matrix[row][col]) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return d;
}
