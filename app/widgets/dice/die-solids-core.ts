// THE BODIES, as geometry.
//
// Five Platonic solids and one trapezohedron, each with a number on every
// face. Pure — no DOM, no timing, no colour. The orientation lives next door
// in `die-orient-core.ts` and the camera in `die-project-core.ts`; this file
// answers one question: WHAT IS THE SHAPE, in numbers.
//
// ## Constructed, never transcribed
//
// Every vertex comes out of a φ/√5 expression and is normalised here. A table
// of decimal literals would be shorter to read and impossible to check: the
// icosahedron's coordinates are only correct to as many digits as whoever
// typed them was patient, and a face that is 1e-7 out of plane is a face that
// renders with a hairline crack at projector size. Constructing them costs
// about forty lines and buys `planhet < 1e-12` as a TEST rather than a hope.
//
// The FACE TABLES are derived too — a plane search over vertex triples, keyed
// by the exact set of vertices that lie on the plane, then sorted CCW seen
// from outside. So the tests test the derivation, not a transcription of it:
// change a vertex expression and the faces follow, and Euler's χ = 2 catches
// the case where they do not.
//
// ## The one thing that is a literal table: the numbers
//
// `FACE_VALUES` is 60 hand-placed integers, because "which number goes on
// which face" is a CONVENTION (opposite faces sum to n+1; a western d6 reads
// 1-2-3 counterclockwise) and not something geometry can derive. The tests
// re-derive the CONVENTION from the geometry and check the table against it,
// which is the honest split: the data is authored, the rules are proven.
//
// ## Why convexity is tested for all six
//
// `die-project-core` culls back faces on the normal alone and never sorts by
// depth. That is only sound because these bodies are convex: on a convex
// solid no front face can occlude another. The convexity test is the licence
// for the missing z-sort, not a nicety.

// ── Vectors ─────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vLen(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** `a` scaled to unit length; the zero vector is returned unchanged rather
 *  than as NaN — a degenerate input must not poison a whole frame. */
export function vUnit(a: Vec3): Vec3 {
  const len = vLen(a);
  return len > 0 ? vScale(a, 1 / len) : a;
}

// ── The shape ───────────────────────────────────────────────────────────────

/**
 * One face of a die.
 *
 * `u` and `w` are the face's own 2D frame: `u` points RIGHT and `w` points
 * DOWN as seen from outside, so a numeral drawn at `(x, y)` in the face's
 * 100-grid needs no sign flips anywhere downstream. `w = u × n` — which makes
 * `(u, w, n)` a LEFT-handed triple on purpose, exactly matching the
 * left-handed screen frame (x right, y down, z toward the viewer) that SVG
 * hands us. Two negations saved, and the afternoon spent finding out why the
 * numerals came out upside down never happens.
 */
export interface Face {
  /** Vertex indices, counterclockwise seen from OUTSIDE the solid. */
  v: readonly number[];
  /** Outward unit normal. */
  n: Vec3;
  /** Face centre — the mean of its vertices, which lies in its plane. */
  c: Vec3;
  /** In-face unit axis pointing RIGHT (as seen from outside). */
  u: Vec3;
  /** In-face unit axis pointing DOWN (as seen from outside). `u × n`. */
  w: Vec3;
  /** The face's inradius: the distance from `c` to its nearest edge. Half the
   *  width of the 100-grid that pips and numerals are laid out on. */
  inr: number;
  /** The number printed on this face. */
  value: number;
}

/** `[vertexA, vertexB, faceA, faceB]` — the two vertices the edge joins and
 *  the two faces that meet along it. The silhouette is the set of edges whose
 *  two faces disagree about facing the camera, so it is derived from this
 *  table rather than from a second pass over the geometry. */
export type Edge = readonly [number, number, number, number];

export interface Solid {
  /** How many faces — 4, 6, 8, 10, 12 or 20. The die's TYPE. */
  sides: number;
  /** Every vertex, on (or inside) the unit sphere. */
  v: readonly Vec3[];
  f: readonly Face[];
  e: readonly Edge[];
}

/**
 * The types with a body, ASCENDING — the mirror of `FACE_OPTIONS` in
 * `dice-core.ts` (which is itself the mirror of the Rust list). A test pins
 * the two together: a seventh die type added to the offer without a body here
 * goes red rather than rendering as nothing.
 */
export const SOLID_SIDES: readonly number[] = [4, 6, 8, 10, 12, 20];

/** The golden ratio — the d12 and d20 are built out of it. */
const PHI = (1 + Math.sqrt(5)) / 2;

/** Coplanarity/containment tolerance for the plane search. Vertices are unit
 *  length and built from a handful of square roots, so the true error is
 *  ~1e-16; 1e-9 is far above the noise and far below any real gap. */
const PLANE_EPS = 1e-9;

/** Two normals whose z differs by less than this are on the same "ring" for
 *  the purpose of the canonical face ORDER. The real rings are separated by
 *  at least 0.3, so this only ever collapses floating-point dust. */
const LEVEL_EPS = 1e-9;

/** A face has a distinguished axis only when ONE vertex is farthest from its
 *  centre. Regular faces miss this by 0, the d10's kite by 0.34. */
const AXIS_EPS = 1e-9;

// ── The vertices ────────────────────────────────────────────────────────────

/** Every sign combination of `(a, b, c)` whose entry is non-zero. */
function signs(a: number, b: number, c: number): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of a === 0 ? [1] : [1, -1])
    for (const sy of b === 0 ? [1] : [1, -1])
      for (const sz of c === 0 ? [1] : [1, -1])
        out.push(v3(a * sx, b * sy, c * sz));
  return out;
}

/** `(a, b, c)` and its two cyclic rotations, in every sign combination. */
function cyclic(a: number, b: number, c: number): Vec3[] {
  return [...signs(a, b, c), ...signs(c, a, b), ...signs(b, c, a)];
}

function unitAll(vs: Vec3[]): Vec3[] {
  return vs.map(vUnit);
}

/**
 * The d10 — a pentagonal trapezohedron, the one body here that is not
 * Platonic. Two counter-rotated rings of five plus two poles; the ten faces
 * are congruent kites.
 *
 * The shape has ONE free parameter once you demand planar faces, and the
 * arithmetic is worth spelling out because it is the only place a decimal
 * could sneak in. Write the poles at `(0, 0, ±p)` and the rings at radius `c`
 * and height `±h`, offset 36° from each other. A kite is planar exactly when
 *
 *     h / p = (1 − cos 36°) / (1 + cos 36°) = (2 − φ) / (2 + φ) = 1 − 2/√5
 *
 * — note `c` cancels, so planarity alone does not fix the body. What fixes it
 * is putting all twelve vertices on ONE circumscribed sphere: with `p = 1`
 * that gives `h = 1 − 2/√5` and `c = √(1 − h²)`. The proportion
 *
 *     p / h = 1 / (1 − 2/√5) = 5 + 2√5
 *
 * is the number to check the construction against, and the test does, to
 * 1e-15, reading it back OUT of the constructed vertices.
 *
 * The same criterion reproduces the CUBE at n = 3 (h/p = 1/3, c = √(8)/3 —
 * the cube seen down a body diagonal), which is the cheapest possible sanity
 * check that "common circumsphere" is the right way to spend the parameter.
 */
function trapezohedron10(): Vec3[] {
  const h = 1 - 2 / Math.sqrt(5);
  const c = Math.sqrt(1 - h * h);
  const ring = (twist: number, z: number): Vec3[] =>
    Array.from({ length: 5 }, (_, k) => {
      const a = ((2 * k) / 5 + twist) * Math.PI;
      return v3(c * Math.cos(a), c * Math.sin(a), z);
    });
  return [v3(0, 0, 1), ...ring(0, h), ...ring(1 / 5, -h), v3(0, 0, -1)];
}

function verticesFor(sides: number): Vec3[] {
  switch (sides) {
    case 4:
      // The four alternating corners of a cube.
      return unitAll([
        v3(1, 1, 1),
        v3(1, -1, -1),
        v3(-1, 1, -1),
        v3(-1, -1, 1),
      ]);
    case 6:
      return unitAll(signs(1, 1, 1));
    case 8:
      return unitAll(cyclic(1, 0, 0));
    case 10:
      return trapezohedron10();
    case 12:
      // A cube with three golden rectangles pushed through it.
      return unitAll([...signs(1, 1, 1), ...cyclic(0, 1 / PHI, PHI)]);
    default:
      return unitAll(cyclic(0, 1, PHI));
  }
}

// ── The faces, derived ──────────────────────────────────────────────────────

interface Plane {
  n: Vec3;
  members: number[];
}

/**
 * Every face plane of the convex hull, found by brute force: a vertex triple
 * spans a face exactly when no vertex lies strictly outside its plane.
 *
 * Deduplicated by the SET OF VERTICES on the plane — an exact integer key, so
 * two triples of the same face can never disagree about being the same face
 * the way a rounded float key would. The cost is C(20,3) = 1140 triples for
 * the d12; it runs once per type, ever.
 */
function derivePlanes(vs: readonly Vec3[]): Plane[] {
  const out: Plane[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      for (let k = j + 1; k < vs.length; k++) {
        const cross = vCross(vSub(vs[j], vs[i]), vSub(vs[k], vs[i]));
        const len = vLen(cross);
        if (len < PLANE_EPS) continue; // collinear triple
        let n = vScale(cross, 1 / len);
        let d = vDot(n, vs[i]);
        if (d < 0) {
          n = vScale(n, -1);
          d = -d;
        }
        if (d < PLANE_EPS) continue; // a plane through the centre is no face
        const members: number[] = [];
        let outside = false;
        for (let m = 0; m < vs.length; m++) {
          const t = vDot(n, vs[m]) - d;
          if (t > PLANE_EPS) {
            outside = true;
            break;
          }
          if (t > -PLANE_EPS) members.push(m);
        }
        if (outside || members.length < 3) continue;
        const key = members.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ n, members });
      }
    }
  }
  return out;
}

function meanOf(vs: readonly Vec3[], members: readonly number[]): Vec3 {
  let sum = v3(0, 0, 0);
  for (const m of members) sum = vAdd(sum, vs[m]);
  return vScale(sum, 1 / members.length);
}

/** Newell's normal for a closed polygon — the area-weighted average of every
 *  corner's cross product, so a vertex that is a hair out of plane blunts the
 *  result instead of tilting it the way one arbitrary triple would. */
function newellNormal(vs: readonly Vec3[], ring: readonly number[]): Vec3 {
  let n = v3(0, 0, 0);
  for (let i = 0; i < ring.length; i++) {
    const a = vs[ring[i]];
    const b = vs[ring[(i + 1) % ring.length]];
    n = vAdd(
      n,
      v3(
        (a.y - b.y) * (a.z + b.z),
        (a.z - b.z) * (a.x + b.x),
        (a.x - b.x) * (a.y + b.y),
      ),
    );
  }
  return vUnit(n);
}

/** The plane's vertices in counterclockwise order seen from OUTSIDE, starting
 *  at the lowest vertex index so the ordering is canonical. */
function sortCcw(vs: readonly Vec3[], plane: Plane): number[] {
  const c = meanOf(vs, plane.members);
  const e1 = vUnit(vSub(vs[plane.members[0]], c));
  // (e1, e2, n) right-handed ⇒ increasing atan2 IS counterclockwise about n,
  // and n points out, so that is counterclockwise seen from outside.
  const e2 = vCross(plane.n, e1);
  const angle = (m: number): number => {
    const p = vSub(vs[m], c);
    const a = Math.atan2(vDot(p, e2), vDot(p, e1));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return [...plane.members].sort((a, b) => angle(a) - angle(b));
}

/** Distance from `p` to the line through `a` and `b`. The foot is always on
 *  the segment here — `p` is the centre of a convex polygon — so the cheap
 *  line formula is also the segment distance. */
function edgeDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = vSub(b, a);
  const len = vLen(ab);
  if (len === 0) return vLen(vSub(p, a));
  return vLen(vCross(ab, vSub(p, a))) / len;
}

/**
 * The face's DOWN axis.
 *
 * A regular face has no distinguished direction of its own, so its first edge
 * picks one and the numeral ends up standing flat on that edge — which is
 * what a numeral on a real d20 does. An elongated face (only the d10's kite)
 * has exactly one axis, and a numeral that ignored it would sit at 45° across
 * the kite. So: unique farthest vertex ⇒ that axis; otherwise the first edge.
 */
function downAxis(vs: readonly Vec3[], ring: readonly number[], c: Vec3): Vec3 {
  let far = -Infinity;
  let farAt = -1;
  let ties = 0;
  for (const m of ring) {
    const d = vLen(vSub(vs[m], c));
    if (d > far + AXIS_EPS) {
      far = d;
      farAt = m;
      ties = 1;
    } else if (d > far - AXIS_EPS) {
      ties++;
    }
  }
  if (ties === 1) return vUnit(vSub(vs[farAt], c));
  const mid = vScale(vAdd(vs[ring[0]], vs[ring[1]]), 0.5);
  return vUnit(vSub(mid, c));
}

/** Faces top-first, then anticlockwise around the body. Two passes rather
 *  than one fuzzy comparator: a comparator that calls near-equal z's "equal"
 *  is not a strict weak ordering, and `Array.sort` is entitled to do anything
 *  at all with one. Levels are assigned first, then sorted exactly. */
function canonicalOrder(planes: Plane[]): Plane[] {
  const byZ = [...planes].sort((a, b) => b.n.z - a.n.z);
  const level = new Map<Plane, number>();
  let current = 0;
  byZ.forEach((plane, i) => {
    if (i > 0 && byZ[i - 1].n.z - plane.n.z > LEVEL_EPS) current++;
    level.set(plane, current);
  });
  const azimuth = (p: Plane): number => {
    const a = Math.atan2(p.n.y, p.n.x);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return byZ.sort((a, b) => {
    const dl = level.get(a)! - level.get(b)!;
    return dl !== 0 ? dl : azimuth(a) - azimuth(b);
  });
}

function buildSolid(sides: number, zeroBased = false): Solid {
  const v = verticesFor(sides);
  const planes = canonicalOrder(derivePlanes(v));

  const f: Face[] = planes.map((plane, i) => {
    const ring = sortCcw(v, plane);
    const c = meanOf(v, ring);
    const n = newellNormal(v, ring);
    const w = downAxis(v, ring, c);
    // u × n = w, so u = n × w. Stated the other way round because `w` is what
    // the geometry hands us and `u` is what falls out.
    const u = vCross(n, w);
    let inr = Infinity;
    for (let k = 0; k < ring.length; k++) {
      inr = Math.min(
        inr,
        edgeDistance(c, v[ring[k]], v[ring[(k + 1) % ring.length]]),
      );
    }
    return {
      v: ring,
      n,
      c,
      u,
      w,
      inr,
      value: FACE_VALUES[sides][i] - (zeroBased ? 1 : 0),
    };
  });

  // Every edge belongs to exactly two faces; the map is keyed on the vertex
  // pair, so a body whose faces did not close up would leave a half-filled
  // entry and Euler's χ would go red rather than the silhouette quietly
  // losing a segment.
  const shared = new Map<string, number[]>();
  f.forEach((face, fi) => {
    for (let k = 0; k < face.v.length; k++) {
      const a = face.v[k];
      const b = face.v[(k + 1) % face.v.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const at = shared.get(key);
      if (at) at.push(fi);
      else shared.set(key, [fi]);
    }
  });
  const e: Edge[] = [...shared.entries()].map(([key, faces]) => {
    const [a, b] = key.split(",").map(Number);
    return [a, b, faces[0], faces[faces.length - 1]] as const;
  });

  return { sides, v, f, e };
}

const cache = new Map<string, Solid>();

/** The nearest offered type to `sides`; ties go to the LOWER one — the same
 *  rule `snapFaces` uses in `dice-core.ts`, so a newer version's d100 lands on
 *  the same body a press would give it. */
function snapSides(sides: number): number {
  const n = Number.isFinite(sides) ? sides : 6;
  let best = SOLID_SIDES[0];
  for (const option of SOLID_SIDES.slice(1)) {
    if (Math.abs(n - option) < Math.abs(n - best)) best = option;
  }
  return best;
}

/**
 * The body for a die type, built on first use and kept. Everything on it is
 * frozen in fact if not in type: callers read, never write.
 *
 * `zeroBased` is the REAL classroom ten-sider: the same trapezohedron with
 * the «10» face printed as a «0», so every value shifts down by one and the
 * opposite-face sum becomes 9 instead of 11. It is a RELABELLING, not a new
 * numbering — corner balance is untouched because every vertex sum drops by
 * exactly the vertex's own face count — which is why the values are derived
 * from `FACE_VALUES[10]` here rather than authored a second time: two tables
 * one subtraction apart would be a drift waiting for its round. Honoured for
 * the d10 alone (the mirror of `normalize` in layout.rs — no other body has
 * a zero-based convention to borrow).
 */
export function solidFor(sides: number, zeroBased = false): Solid {
  const key = snapSides(sides);
  const zero = zeroBased && key === 10;
  const cacheKey = zero ? `${key}z` : `${key}`;
  let solid = cache.get(cacheKey);
  if (!solid) {
    solid = buildSolid(key, zero);
    cache.set(cacheKey, solid);
  }
  return solid;
}

// ── The numbers ─────────────────────────────────────────────────────────────

/**
 * Which number goes on which face, indexed by the canonical face order
 * (top-first, then anticlockwise). Sixty integers, authored — see the file
 * header for why these are not derived.
 *
 * The conventions the tests re-derive from the geometry:
 *
 *   - every value 1..n appears exactly once;
 *   - OPPOSITE faces sum to n+1 — the rule every real die follows, which is
 *     also why the d4 is exempt: a tetrahedron has no opposite faces at all
 *     (each face stands against a VERTEX), so the rule is not weakened for it,
 *     it simply does not apply;
 *   - the numbers around each vertex are BALANCED, i.e. no corner of the die
 *     is much heavier than another — the second convention real dice follow,
 *     and the one that makes a numbering look considered rather than random;
 *   - the d6 is right-handed western: 1-2-3 run counterclockwise around the
 *     corner they share, seen from outside it.
 */
export const FACE_VALUES: Record<number, readonly number[]> = {
  4: [1, 2, 3, 4],
  // 1 up, 2 and 3 on the two faces that share its right-front corner.
  6: [1, 2, 3, 5, 4, 6],
  8: [8, 2, 6, 4, 3, 5, 1, 7],
  10: [10, 2, 7, 6, 3, 5, 8, 1, 9, 4],
  12: [1, 11, 9, 5, 6, 3, 7, 10, 8, 4, 2, 12],
  20: [14, 10, 18, 9, 8, 4, 2, 16, 15, 20, 6, 1, 5, 19, 13, 17, 3, 12, 11, 7],
};

/**
 * The best corner balance each body can reach, as the spread (max − min) of
 * the value sums around a vertex — measured WITHIN one vertex degree, since
 * the d10 is the only body with two kinds of corner (its poles carry five
 * faces, its ring vertices three) and comparing those two would be comparing
 * a sum of five numbers with a sum of three. Pinned rather than asserted
 * loosely, because the interesting number here is how LOW it goes and the
 * interesting failure is a numbering that quietly gets worse.
 *
 * These are floors, not preferences: for the d8, d10 and d12 an exhaustive
 * search over every numbering obeying the opposite-sum rule was run and
 * nothing beats them (the d8's 8 is forced — balancing an octahedron would
 * need two faces to carry the same number), and the d20's 1 is forced by
 * parity alone (five faces meet at a vertex and 5 × 21/2 is not an integer).
 * The d6 is the exception on purpose: 9 is what the WESTERN CONVENTION costs,
 * and convention outranks balance on the die everyone recognises.
 */
export const CORNER_SPREAD: Record<number, number> = {
  4: 3,
  6: 9,
  8: 8,
  10: 5,
  12: 7,
  20: 1,
};

/** The face index carrying `value`, or −1. */
export function faceForValue(solid: Solid, value: number): number {
  return solid.f.findIndex((face) => face.value === value);
}
