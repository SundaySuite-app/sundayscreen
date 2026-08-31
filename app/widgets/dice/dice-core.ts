// The die's VALUE domain: which types exist, where a number comes from, and
// the one drawing convention that is not a consequence of the geometry — the
// d6's pip arrangements. Pure — no DOM, no timing. The bodies live in
// `die-solids-core.ts` and the throw in `dice-physics-core.ts`.

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

/**
 * The nearest offered type to `faces`; ties go to the LOWER one — the same
 * rule as Rust's `snap_dice_faces`, so the appearance panel ticks the same
 * pill before and after a save round-trip.
 *
 * ⚠️ Reachable in normal use: a newer version's d100 arriving in a config
 * this build has not yet had clamped is exactly the downgrade promise 3
 * protects, and the panel has to tick SOMETHING for it.
 */
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

/*
 * ⚠️ What USED to be here: `FACE_SHAPES`, a table of flat silhouettes with
 * hand-drawn facets and a `labelY` per type, plus `DEPTH_DX/DY` — the whole-
 * die drop that gave each one its thickness.
 *
 * All of it is superseded by real geometry (R5). The bodies are constructed
 * in `die-solids-core.ts`, turned in `die-orient-core.ts` and projected in
 * `die-project-core.ts`, so a face's outline, its shading and where its
 * numeral sits are now consequences of the shape rather than three drawings
 * that had to be kept in agreement by hand. `PIPS` above SURVIVES, and is
 * read straight by the projection as face-local coordinates: where the six
 * pips sit on a face is a convention, not a consequence, and the convention
 * did not change.
 */
