// FROM THE ROOM TO THE CARD — the camera.
//
// One die, one orientation, one frame's worth of SVG geometry. Pure: no DOM,
// no colour, no timing. The bodies are in `die-solids-core.ts` and the
// orientation in `die-orient-core.ts`.
//
// ## The fit is ANALYTIC, and the margin is exactly zero
//
// The 2D die learned this the hard way: a square spinning inside a box needs
// √2 of room, and the version that forgot lost a corner to `overflow: hidden`
// mid-throw. The 3D answer is better than a margin — it is a closed form. All
// vertices sit on the UNIT SPHERE, and a sphere looks the same from every
// direction, so the largest radius any vertex can ever project to is a
// property of the CAMERA alone:
//
//     max r = f / √(d² − 1)          (attained at depth z = 1/d)
//
// Pick `f = 47.5·√15` with `d = 4` and that is 47.5 grid units, dead on:
// `EDGE_PAD` is what is left of the 50-unit half-grid, and it is not slack —
// it is the exact reach of the worst orientation. No margin is needed because
// none is missing. The test asserts the bound to 1e-12 across 2000 random
// orientations of all six bodies.
//
// The same choice is why the die does not PULSE as it turns: the scale is
// fixed, so a cube face-on genuinely is smaller on the card than a cube
// corner-on. Normalising per frame would keep the die fat and make it breathe,
// which reads as a wobble from the back of the room.
//
// ## Culling is the whole trick
//
// `n · (cam − c) > 0` per face. On a CONVEX body — proven for all six in
// die-solids-core — no front face can occlude another, so there is no depth
// sort, no painter's algorithm, no z-buffer: the visible faces tile the
// silhouette exactly once. Doing it against the camera POSITION rather than
// the view axis also culls grazing faces for free, which is why a d20 seen
// corner-on shows five faces and not orthography's ten.
//
// ## Flat tones are a physical fact, not a style choice
//
// A flat face under a distant light has ONE radiance across its whole area —
// there is nothing to gradient. So each face gets one Lambert value,
// quantised to one of `TONES` steps that the CSS ramp names. Quantising is the
// deliberate part: two neighbouring faces separated by one percent of
// brightness read as a printing error at projector size, so they are either
// the same step or a visibly different one.
//
// Tones are an INDEX here, never a colour. Colour literals belong in
// `tokens.css` and the gate only reads `.css` — which makes the discipline
// more important in this file, not less.

import { PIPS, PIP_FACES } from "./dice-core";
import { qRotate, type Quat } from "./die-orient-core";
import { v3, vDot, vUnit, type Solid, type Vec3 } from "./die-solids-core";

/** The die's SVG coordinate system: a 100×100 box, like every other face
 *  drawing in this widget. */
export const GRID = 100;

/** How many shading steps the ramp has. */
export const TONES = 5;

/** Camera distance, in body radii. Near/far edges come out at 5/3 — enough
 *  perspective to read as a solid, far short of the fisheye that makes a die
 *  look like a balloon. */
export const CAM_D = 4;

/** What is left of the half-grid once the widest possible projection is
 *  drawn. See the header: this is a MEASUREMENT, not a safety margin. */
export const EDGE_PAD = 2.5;

/** Focal length in grid units, chosen so `f/√(d²−1)` is exactly
 *  `GRID/2 − EDGE_PAD`. */
export const FOCAL = 47.5 * Math.sqrt(15);

/** Ambient term: the darkest step of the ramp is a face that gets no direct
 *  light at all, and a black face on a die reads as a hole. */
export const AMB = 0.25;

/** Pip radius in FACE-LOCAL units — the same 10 the flat d6 has always used,
 *  on the same 100-unit face grid. */
export const PIP_R = 10;

/** Numeral height in FACE-LOCAL units. */
export const LABEL_EM = 46;

/**
 * The radius one pip is drawn at, given the face's own 2×2 projected map.
 *
 * `(ax, ay)` is where the face's u axis lands and `(bx, by)` its w axis, both
 * in half-grid units — the same four numbers the numeral's affine matrix is
 * built from.
 *
 * A projected circle is an ELLIPSE, and a `<circle>` per pip is worth
 * keeping: six rotated `<ellipse>` elements per face, re-angled every frame,
 * is a lot of attribute writing for a dot ten units across. So the radius is
 * the ellipse's MINOR axis — the smaller singular value of the map, obtained
 * from the eigenvalues of `MᵀM` — not its area-preserving mean. The mean
 * looks marginally better and spills over the face's own edge on one pip in
 * ten once the face tilts; the minor axis is the inscribed circle and never
 * can. On a face square to the class the two are identical, which is where
 * the die spends most of its life — but NOT all of it, which is exactly why
 * this is one exported function and not two copies (R5-funn M1: the second
 * copy took the u axis alone and ran 1.84× too wide on a hand-spun die).
 */
export function pipRadius(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const gu = ax * ax + ay * ay;
  const gw = bx * bx + by * by;
  const guw = ax * bx + ay * by;
  const spread = Math.sqrt(Math.max(0, (gu - gw) * (gu - gw) + 4 * guw * guw));
  return PIP_R * Math.sqrt(Math.max(0, (gu + gw - spread) / 2));
}

/**
 * How square to the class a face must be before it is given its MARK — its
 * numeral or its pips. Below this the face is drawn as a plain shaded sliver,
 * which is what a real die looks like at that angle anyway.
 *
 * Two reasons, and the second is the load-bearing one:
 *
 *  1. A numeral on a face tilted 73° is a few pixels of ink at projector
 *     size — noise, not information.
 *  2. The numeral is placed by an AFFINE matrix taken from three projected
 *     points, while the face itself is drawn in full perspective. Those two
 *     agree to first order and drift apart as the face grazes; past this
 *     angle the numeral can leave the face it belongs to. Measured, not
 *     guessed: escapes start appearing below 0.2 and none survive at 0.3.
 *
 * The bound in the other direction is the d4, whose best face can be as
 * little as 1/3 square to the class (held on a corner) — so anything at or
 * above 1/3 would leave a tetrahedron with no readable number at all. 0.3 is
 * the widest gate that keeps «the up face always has its mark» true.
 *
 * `FacePaint.facing` is published so the renderer can FADE a mark in across
 * the threshold rather than popping it.
 */
export const MARK_MIN_FACING = 0.3;

/** The light, fixed in VIEW space: up, left and in front. The light STANDS
 *  and the die turns underneath it — a light welded to the die would shade
 *  every face identically for ever and the body would look flat. */
const LIGHT = vUnit(v3(-1, 1, 1));

const HALF = GRID / 2;

/** One visible (or invisible) face, ready for the DOM.
 *
 *  Every face of the body gets an entry, every frame, whether it is turned
 *  toward the class or not: the renderer owns one node per face for the life
 *  of the widget, and `front` is what decides whether it is painted. Growing
 *  and shrinking the node list per frame is how a rAF loop starts allocating.
 */
export interface FacePaint {
  /** Turned toward the camera. */
  front: boolean;
  /** How square to the class the face is: the cosine between its normal and
   *  the screen. 1 is flat on, 0 is edge on. Published so the renderer can
   *  fade a mark across `MARK_MIN_FACING` instead of popping it. */
  facing: number;
  /** The number printed on this face. */
  value: number;
  /** `<polygon points>`, on the grid. Emitted for back faces too — the glass
   *  material draws them as faint lines. */
  points: string;
  /** Lambert step, `0 .. TONES-1`. An INDEX; the ramp lives in CSS. */
  tone: number;
  /** The numeral's 2D affine matrix `[a, b, c, d, e, f]` mapping the face's
   *  own 100-grid onto the card, or null for a pip face or a back face. The
   *  array is reused between frames: read it, do not keep it. */
  label: number[] | null;
  /** Pip circles as `[cx, cy, r]` on the grid — empty unless this is a d6
   *  face turned toward the class. Reused between frames. */
  pips: number[][];
}

export interface DieView {
  /** Which body this view was built for; a view for one type cannot be
   *  scratch for another. */
  sides: number;
  /** One entry per face, indexed exactly as `solid.f`. */
  faces: FacePaint[];
  /** The body's outline as one closed `<path d>` — without it the die loses
   *  its edge against a card of the same tone. */
  silhouette: string;
  /** Index of the face turned MOST toward the class. */
  up: number;
  /** The number on that face — what a pupil at the back reads. */
  upValue: number;
}

/**
 * A point in VIEW space onto the grid.
 *
 * The y flip lives HERE and nowhere else: SVG's y grows downward, the maths
 * frame's grows up. Every other sign in this widget — the face's `w` axis,
 * the trackball's rotation axis — is chosen so that this one negation is the
 * only one in the pipeline.
 */
export function toGrid(v: Vec3): { x: number; y: number } {
  const depth = CAM_D - v.z;
  const k = FOCAL / (Number.isFinite(depth) && depth > 1e-6 ? depth : 1e-6);
  return { x: HALF + v.x * k, y: HALF - v.y * k };
}

/** Lambert intensity for a normal already in view space, in `[AMB, 1]`. */
export function lambert(nView: Vec3): number {
  return AMB + (1 - AMB) * Math.max(0, vDot(nView, LIGHT));
}

/**
 * …quantised to a ramp step.
 *
 * The index spans the whole LIT range: step 0 IS the ambient level, which is
 * why `AMB` cancels out here rather than compressing the scale. Map the raw
 * intensity instead and the two darkest steps of every ramp would be
 * unreachable — five tones in the CSS, three of them ever drawn.
 */
export function toneFor(nView: Vec3): number {
  const lit = (lambert(nView) - AMB) / (1 - AMB);
  const step = Math.round(lit * (TONES - 1));
  return step < 0 ? 0 : step > TONES - 1 ? TONES - 1 : step;
}

/**
 * A grid number for an attribute.
 *
 * `-0` never reaches a string. `(-0).toFixed(2)` is `"-0.00"` and `-0 === 0`
 * is true, so a negative zero is invisible on screen, legal in SVG, and
 * exactly the kind of thing that makes a "the output is stable" test fail for
 * a reason nobody can find. Same discipline as `zeroed()` in the physics.
 */
export function fmt(value: number, places = 2): string {
  if (!Number.isFinite(value)) return "0";
  const scale = 10 ** places;
  const rounded = Math.round(value * scale) / scale;
  return String(rounded === 0 ? 0 : rounded);
}

/** A label matrix as an SVG `transform`. Four decimals on the linear part,
 *  two on the translation: at `LABEL_EM = 46` a hundredth of a linear term is
 *  half a grid unit of drift, which is visible. */
export function matrixAttr(m: readonly number[]): string {
  return `matrix(${fmt(m[0], 4)},${fmt(m[1], 4)},${fmt(m[2], 4)},${fmt(m[3], 4)},${fmt(m[4])},${fmt(m[5])})`;
}

function blankView(solid: Solid): DieView {
  return {
    sides: solid.sides,
    faces: solid.f.map((face) => ({
      front: false,
      facing: 0,
      value: face.value,
      points: "",
      tone: 0,
      label: null,
      pips: [],
    })),
    silhouette: "",
    up: 0,
    upValue: solid.f[0].value,
  };
}

/**
 * The silhouette, chained out of the edge table.
 *
 * An edge is on the outline exactly when its two faces disagree about facing
 * the camera. On a convex body those edges form ONE closed cycle in which
 * every vertex has degree two, so the walk is: start at the lowest vertex,
 * always step to the neighbour you did not come from, stop when you are back.
 */
function silhouetteOf(
  solid: Solid,
  front: readonly boolean[],
  gx: readonly number[],
  gy: readonly number[],
): string {
  const links = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const at = links.get(a);
    if (at) at.push(b);
    else links.set(a, [b]);
  };
  for (const [a, b, fa, fb] of solid.e) {
    if (front[fa] === front[fb]) continue;
    link(a, b);
    link(b, a);
  }
  if (links.size < 3) return "";
  const start = Math.min(...links.keys());
  const ring = [start];
  let previous = -1;
  let current = start;
  for (let guard = 0; guard < links.size; guard++) {
    const options = links.get(current);
    if (!options) break;
    const step = options.find((o) => o !== previous) ?? options[0];
    if (step === start) break;
    ring.push(step);
    previous = current;
    current = step;
  }
  return `M${ring.map((i) => `${fmt(gx[i])},${fmt(gy[i])}`).join("L")}Z`;
}

/**
 * One die, one orientation, one frame.
 *
 * `scratch` is a `DieView` the CALLER owns — pass last frame's back in and
 * every face object, pip triple and label matrix is written in place. At 60
 * frames a second across six dice, allocating a fresh view each time is the
 * difference between a steady loop and a sawtooth of collections. The strings
 * are the one thing that must be new each frame; SVG attributes are strings.
 */
export function projectDie(solid: Solid, q: Quat, scratch?: DieView): DieView {
  const view =
    scratch && scratch.sides === solid.sides ? scratch : blankView(solid);

  // Every vertex, once: rotated into view space and projected.
  const gx: number[] = [];
  const gy: number[] = [];
  for (const vertex of solid.v) {
    const point = toGrid(qRotate(q, vertex));
    gx.push(point.x);
    gy.push(point.y);
  }

  const front: boolean[] = [];
  let up = -1;
  let bestFacing = -Infinity;

  solid.f.forEach((face, i) => {
    const paint = view.faces[i];
    const nView = qRotate(q, face.n);
    const cView = qRotate(q, face.c);
    // Against the camera POSITION, not the view axis: that is what culls the
    // grazing faces a d20 shows at its silhouette. Written out rather than
    // built as a vector — this runs for every face of every die every frame,
    // and the object would be garbage before the next line.
    const toCamera =
      nView.x * -cView.x + nView.y * -cView.y + nView.z * (CAM_D - cView.z);
    front[i] = toCamera > 0;
    paint.front = front[i];
    paint.facing = nView.z;
    paint.value = face.value;
    paint.tone = toneFor(nView);
    paint.points = face.v
      .map((vi) => `${fmt(gx[vi])},${fmt(gy[vi])}`)
      .join(" ");

    if (front[i] && nView.z > bestFacing) {
      bestFacing = nView.z;
      up = i;
    }

    if (!front[i] || nView.z < MARK_MIN_FACING) {
      paint.label = null;
      paint.pips.length = 0;
      return;
    }

    // The face's own frame, projected. Three points is all an affine map
    // needs, and because `w` already points DOWN and `toGrid` already flips
    // y, the matrix comes out with no negation anywhere — the numeral is
    // upright on the face because the geometry says so, not because a sign
    // was tried both ways.
    const uView = qRotate(q, face.u);
    const wView = qRotate(q, face.w);
    const origin = toGrid(cView);
    const alongU = toGrid({
      x: cView.x + uView.x * face.inr,
      y: cView.y + uView.y * face.inr,
      z: cView.z + uView.z * face.inr,
    });
    const alongW = toGrid({
      x: cView.x + wView.x * face.inr,
      y: cView.y + wView.y * face.inr,
      z: cView.z + wView.z * face.inr,
    });
    const ax = (alongU.x - origin.x) / HALF;
    const ay = (alongU.y - origin.y) / HALF;
    const bx = (alongW.x - origin.x) / HALF;
    const by = (alongW.y - origin.y) / HALF;

    if (solid.sides === PIP_FACES) {
      paint.label = null;
      // One radius for the whole face — see `pipRadius`, which is also what
      // the reduced-motion scramble next door calls.
      const radius = pipRadius(ax, ay, bx, by);
      const spots = PIPS[face.value] ?? [];
      paint.pips.length = spots.length;
      spots.forEach(([px, py], k) => {
        const lx = ((px - HALF) / HALF) * face.inr;
        const ly = ((py - HALF) / HALF) * face.inr;
        const at = toGrid({
          x: cView.x + uView.x * lx + wView.x * ly,
          y: cView.y + uView.y * lx + wView.y * ly,
          z: cView.z + uView.z * lx + wView.z * ly,
        });
        const slot = paint.pips[k] ?? (paint.pips[k] = [0, 0, 0]);
        slot[0] = at.x;
        slot[1] = at.y;
        slot[2] = radius;
      });
      return;
    }

    paint.pips.length = 0;
    const m = paint.label ?? [0, 0, 0, 0, 0, 0];
    m[0] = ax;
    m[1] = ay;
    m[2] = bx;
    m[3] = by;
    m[4] = origin.x;
    m[5] = origin.y;
    paint.label = m;
  });

  view.silhouette = silhouetteOf(solid, front, gx, gy);
  view.up = up < 0 ? 0 : up;
  view.upValue = solid.f[view.up].value;
  return view;
}
