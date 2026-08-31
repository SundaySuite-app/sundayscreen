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

/** How one non-d6 type is drawn: a silhouette, its facets, and a numeral. */
export interface FaceShape {
  /** `<polygon points>` on the same 100×100 grid the pips use. */
  points: string;
  /** Where the numeral sits, as a CENTRAL baseline — the numeral belongs on
   *  the FRONT facet now, which is not the box's centre for any of them. */
  labelY: number;
  /** A silhouette too narrow for the full-size numeral. */
  narrow: boolean;
  /** The facets that catch the shade — the die's other visible faces,
   *  drawn as tinted polygons OVER the base face. */
  shaded: string[];
  /** The interior edges between facets, each a `<polyline points>`. */
  edges: string[];
}

/**
 * The silhouettes, keyed by face count. The outline is still the flat shape
 * a pupil recognises the polyhedron by — but each die now also shows its
 * OTHER visible faces (owner request 08-31: «litt mer 3d, lettere å telle
 * fysisk»): the facets a real die presents when it lies on the desk, drawn
 * as tinted polygons with thin edges. The tint is one flat tone and the
 * edges are 2 units wide on the 100-grid, which is what keeps this legible
 * at 40 px on a projector — gradients and thin hairlines are what read as
 * mud there, not facets.
 *
 * The numeral moved onto the FRONT facet where the edge lines would
 * otherwise cross it (d8, d10), which also cost the d10 and d12 the
 * full-size numeral — the front facet is smaller than the silhouette.
 *
 * `PIP_FACES` is deliberately absent: the d6 keeps its pips (with dimples).
 */
export const FACE_SHAPES: Record<number, FaceShape> = {
  // Corner-on: three facets meeting at the apex point (50,61); the numeral
  // keeps the bottom facet. The triangle is still too narrow for a
  // full-size numeral at that height.
  4: {
    points: "50,8 95,88 5,88",
    labelY: 71,
    narrow: true,
    shaded: ["50,8 95,88 50,61", "50,8 5,88 50,61"],
    edges: ["50,8 50,61", "95,88 50,61", "5,88 50,61"],
  },
  // Edge-on: the equator between the two visible faces; the numeral moves
  // onto the lower one.
  8: {
    points: "50,5 95,50 50,95 5,50",
    labelY: 66,
    narrow: true,
    shaded: ["50,5 95,50 5,50"],
    edges: ["5,50 95,50"],
  },
  // The kite's shoulder line; the top cap is the shaded face. The lower
  // facet is narrow, so the numeral is too.
  10: {
    points: "50,4 92,40 50,96 8,40",
    labelY: 56,
    narrow: true,
    shaded: ["50,4 92,40 8,40"],
    edges: ["8,40 92,40"],
  },
  // Face-on: the front pentagon (outer scaled 0.6 toward the centroid at
  // (50, 54.6)) ringed by five shaded rim facets.
  12: {
    points: "50,5 95,40 77,94 23,94 5,40",
    labelY: 54,
    narrow: true,
    shaded: [
      "50,5 95,40 77,46 50,25",
      "95,40 77,94 66,78 77,46",
      "77,94 23,94 34,78 66,78",
      "23,94 5,40 23,46 34,78",
      "5,40 50,5 50,25 23,46",
    ],
    edges: [
      "50,5 50,25",
      "95,40 77,46",
      "77,94 66,78",
      "23,94 34,78",
      "5,40 23,46",
      "50,25 77,46 66,78 34,78 23,46 50,25",
    ],
  },
  // Face-on: the classic front triangle spanning three alternating corners,
  // with the three corner facets shaded. Wide enough for the full numeral.
  20: {
    points: "50,4 91,27 91,73 50,96 9,73 9,27",
    labelY: 50,
    narrow: false,
    shaded: ["9,27 50,4 91,27", "91,27 91,73 50,96", "9,27 9,73 50,96"],
    edges: ["9,27 91,27 50,96 9,27"],
  },
};

/** The whole-die drop that gives every silhouette its thickness — one flat
 *  darker copy behind the face, offset down-right like a die on a desk. */
export const DEPTH_DX = 3.5;
export const DEPTH_DY = 4.5;
