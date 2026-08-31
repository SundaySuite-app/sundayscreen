// The die's VALUE domain: which types exist, how a face is DRAWN, and where a
// number comes from. Pure — no DOM, no timing. The throw itself is arithmetic
// too, and lives next door in `dice-physics-core.ts`.

/**
 * Every die type the widget offers, ASCENDING — the hand-kept mirror of
 * `DICE_FACE_OPTIONS` in `crates/sundayscreen-core/src/layout.rs`.
 *
 * ⚠️ Why by hand. Every other Rust limit reaches the frontend through
 * `app/lib/limits.generated.ts`, but `scripts/gen-limits.mjs` parses `pub
 * const` SCALARS and has no notion of an array — a public Rust array would
 * make it throw rather than generate. So this one set is spelled twice, and
 * BOTH spellings are pinned by a test (`dice_face_options_are_pinned` in
 * layout.rs, «FACE_OPTIONS speiler Rust-lista» in dice-core.test.ts). Change
 * the offer and both tests go red together; change one side alone and exactly
 * one does. That pair is the drift guard the generator cannot give us.
 */
export const FACE_OPTIONS: readonly number[] = [4, 6, 8, 10, 12, 20];

/** The one type drawn with PIPS instead of a numeral — the die everybody at
 *  the back of the room recognises without reading it. */
export const PIP_FACES = 6;

/** The next type in the ring. An off-list value (a newer version's d100 that
 *  this build has not yet had clamped) enters the ring at its NEAREST offered
 *  neighbour, ties low — the same rule as Rust's `snap_dice_faces`, so a
 *  press does the same thing before and after a save round-trip. */
export function nextFaces(faces: number): number {
  const at = FACE_OPTIONS.indexOf(faces);
  if (at >= 0) return FACE_OPTIONS[(at + 1) % FACE_OPTIONS.length];
  return snapFaces(faces);
}

/** The nearest offered type to `faces`; ties go to the LOWER one. */
export function snapFaces(faces: number): number {
  const n = Number.isFinite(faces) ? faces : PIP_FACES;
  let best = FACE_OPTIONS[0];
  // Strict `<` over an ASCENDING list is what resolves a tie downwards.
  for (const option of FACE_OPTIONS.slice(1)) {
    if (Math.abs(n - option) < Math.abs(n - best)) best = option;
  }
  return best;
}

// ── The number ──────────────────────────────────────────────────────────────

const U32 = 2 ** 32;

/**
 * The largest multiple of `faces` that fits in a u32. Draws at or above it
 * are REJECTED rather than folded, which is what keeps the low faces from
 * being very slightly likelier than the high ones.
 *
 * The bias is tiny (2³² is not a multiple of 20, so five of the twenty values
 * would be over-represented by about one part in 200 million) and no
 * classroom would ever see it. Rejection sampling is three lines; skipping it
 * to save them would be a shrug we would have to defend later.
 */
export function u32Limit(faces: number): number {
  return Math.floor(U32 / faces) * faces;
}

/** One draw → a die value, or `null` when the draw fell in the biased tail
 *  and has to be discarded. */
export function dieFromU32(raw: number, faces: number): number | null {
  if (!Number.isInteger(raw) || raw < 0 || raw >= U32) return null;
  if (raw >= u32Limit(faces)) return null;
  return 1 + (raw % faces);
}

/** OS entropy, as a u32. */
function cryptoU32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * A fair die value in 1..=faces.
 *
 * `draw` is injectable so the rejection path is testable; the app always uses
 * OS entropy. The retry is CAPPED: the rejection tail is under one draw in
 * ten million, so sixteen consecutive rejections means the source is not
 * behaving, and a classroom die that hangs is worse than one that is
 * imperceptibly biased in a case that does not happen.
 */
export function randomDie(
  faces: number,
  draw: () => number = cryptoU32,
): number {
  const sides = snapFaces(faces);
  for (let i = 0; i < 16; i++) {
    const value = dieFromU32(draw(), sides);
    if (value !== null) return value;
  }
  return 1 + (Math.abs(draw()) % sides);
}

// ── The face ────────────────────────────────────────────────────────────────

/** Pip coordinates per value, on the shared 100×100 face grid. */
export const PIPS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[50, 50]],
  2: [
    [30, 30],
    [70, 70],
  ],
  3: [
    [30, 30],
    [50, 50],
    [70, 70],
  ],
  4: [
    [30, 30],
    [70, 30],
    [30, 70],
    [70, 70],
  ],
  5: [
    [30, 30],
    [70, 30],
    [50, 50],
    [30, 70],
    [70, 70],
  ],
  6: [
    [30, 30],
    [70, 30],
    [30, 50],
    [70, 50],
    [30, 70],
    [70, 70],
  ],
};

/** How one non-d6 type is drawn: a silhouette plus a numeral. */
export interface FaceShape {
  /** `<polygon points>` on the same 100×100 grid the pips use. */
  points: string;
  /** Where the numeral sits, as a CENTRAL baseline — the polygon's OPTICAL
   *  centre, which is not the box's centre for the triangle or the kite. */
  labelY: number;
  /** A silhouette too narrow for the full-size numeral (the d4 triangle). */
  narrow: boolean;
}

/**
 * The silhouettes, keyed by face count. The shapes are the flat outline a
 * pupil recognises the polyhedron by — a triangle for the d4, a square on its
 * point for the d8, a kite for the d10, a pentagon for the d12, a hexagon for
 * the d20 — NOT an attempt at a 3-D render, which at 40 px on a projector
 * reads as mud.
 *
 * `PIP_FACES` is deliberately absent: the d6 keeps its pips.
 */
export const FACE_SHAPES: Record<number, FaceShape> = {
  // The triangle is the only silhouette that runs out of width where a
  // numeral wants to be: at y = 66 it is 72 units across, which fits a
  // narrowed «20» but not the full-size one the others carry.
  4: { points: "50,8 95,88 5,88", labelY: 66, narrow: true },
  8: { points: "50,5 95,50 50,95 5,50", labelY: 50, narrow: false },
  10: { points: "50,4 92,40 50,96 8,40", labelY: 48, narrow: false },
  12: { points: "50,5 95,40 77,94 23,94 5,40", labelY: 55, narrow: false },
  20: { points: "50,4 91,27 91,73 50,96 9,73 9,27", labelY: 50, narrow: false },
};
