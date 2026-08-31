// THE FLICK — a finger let go of, as arithmetic.
//
// `die-orient-core.ts` already owns the two halves that touch the maths: the
// trackball itself (`spinDelta`, pointer travel → a rotation) and one step of
// coasting (`spinStep`, damping and the stop). What is missing between them is
// the RELEASE: how fast the die was turning at the instant the finger left it,
// and how the component is supposed to run the coast down to nothing.
//
// Pure — no DOM, no timing source. The component samples pointer positions and
// hands them here; everything below is a function of those samples.
//
// ## ⚠️ Two different things are called «spin» in this widget
//
//   - `SPIN_DEG_PER_PX` in `dice-physics-core.ts` is TUMBLE degrees per pixel
//     FLOWN: the die is in the air, and it turns because it is travelling.
//   - The trackball's law is π radians per die-width DRAGGED (`spinDelta`):
//     the die is standing still under a finger, and it turns because the
//     finger moved across it.
//
// They are unrelated rates with the same word in the name, which is why every
// constant in THIS file is prefixed `TRACKBALL_`. A future tuning session that
// reaches for «the spin constant» has to say which one out loud.

import {
  QUAT_IDENTITY,
  SPIN_DAMP_PER_STEP,
  SPIN_STOP_EPS,
  orientationForValue,
  qAxisAngle,
  qMul,
  qNormalize,
  spinStep,
  type Quat,
  type Spin,
  type SpinState,
} from "./die-orient-core";
import type { Solid } from "./die-solids-core";
import { v3, vCross, vLen, vUnit } from "./die-solids-core";

/** The coast is integrated in fixed steps, like the throw next door — a frame
 *  that arrives late runs several of them rather than taking one big one, so
 *  the decay does not depend on the frame rate. */
export const TRACKBALL_STEP_MS = 8;

/**
 * How far back the release velocity is measured.
 *
 * Short enough that the last thing the finger did is what the die does — a
 * teacher who drags slowly and then flicks expects the flick. Long enough to
 * survive one dropped pointermove: at 60 Hz this is roughly four samples, so
 * losing one changes the answer by a quarter rather than inventing a
 * direction out of a single 16 ms gap.
 */
export const TRACKBALL_SAMPLE_MS = 60;

/**
 * The fastest the die may be released, in degrees per millisecond.
 *
 * 2.2°/ms is about six turns a second: fast enough that a hard flick reads as
 * a flick, slow enough that the numbers on the faces stay individually
 * visible rather than smearing into a grey ball. Without a cap, a 3 px
 * pointermove sample separated by a 1 ms timestamp — which is a perfectly
 * ordinary thing for a trackpad to report — releases the die at a rate no
 * screen can draw.
 */
export const TRACKBALL_MAX_DEG_PER_MS = 2.2;

/** …the same cap in the unit `Spin.rate` is measured in: radians per step. */
export const TRACKBALL_MAX_RATE =
  (TRACKBALL_MAX_DEG_PER_MS * TRACKBALL_STEP_MS * Math.PI) / 180;

/**
 * The presentation tilt a ROLLED die rests in. Dead face-on, the cube reads
 * as a flat square — the 2-D die this round exists to replace, at the exact
 * moment the class is reading the answer (seen on screen, not guessed). A
 * gentle 14°/−10° keeps the die visibly a solid while costing the numeral
 * ~4 % of its width (cos ≈ 0.96). The up-face invariant survives for every
 * body: the smallest angle between two face normals is the d20's 41.8°, so a
 * 17° combined tilt can never promote a neighbouring face to «up» — and that
 * is a test, not a hope.
 */
export const REST_TILT: Quat = qNormalize(
  qMul(
    qAxisAngle(v3(0, 1, 0), (14 * Math.PI) / 180),
    qAxisAngle(v3(1, 0, 0), (-10 * Math.PI) / 180),
  ),
);

/** Where a die with THIS answer rests: face toward the class, numeral
 *  horizontal, tipped just enough to stay a solid. The single composition
 *  point — the flight target, the rest pose and the reload pose all call
 *  this, so they cannot disagree. */
export function restOrientationForValue(solid: Solid, value: number): Quat {
  return qMul(REST_TILT, orientationForValue(solid, value));
}

/**
 * How far the idle pose is turned about the LINE OF SIGHT, purely for
 * composition. −15° is what puts a cube's corner-on view into the drawing
 * everybody recognises: one face normal straight up, one seam straight down,
 * two seams up-left and up-right. It cannot change any face's `facing`
 * (that is `n · ẑ`, and a rotation about ẑ leaves z alone), so it is free.
 */
const IDLE_TWIST = (-15 * Math.PI) / 180;

/**
 * The pose a die is drawn in before anybody has rolled it: CORNER ON.
 *
 * `lastRoll` is empty on a freshly added widget, and a body parked at the
 * identity would show its first face flat to the class — a «1» the widget
 * would be inventing. The fix is not «tip it a bit»: a tipped die is still a
 * die with a best face, and the class cannot tell «tipped by 20°» from
 * «landed and tipped by 20°». What it CAN tell is a die standing on its
 * corner, because that is the one attitude in which no face is the answer —
 * every face at the vertex is equally turned toward the room, and a tie is
 * not a number.
 *
 * So: rotate `solid.v[0]` — a real vertex of the body, on the unit sphere by
 * construction — onto the camera axis by the SHORTEST arc, then turn the
 * whole picture `IDLE_TWIST` about that same camera axis for composition. Per
 * body, because the vertices are per body; deterministic, because nothing
 * here is a search.
 *
 * What that costs each body, measured (the facing of every face over
 * `MARK_MIN_FACING`, all equal to within 3e-16 — the test pins both halves):
 *
 *   - d4   3 faces at 0.333 — inside the mark's fade band, so a tetrahedron
 *          idles with three ghost numerals. That is correct and not a
 *          shortfall: a tetrahedron's best face is 1/3 square whatever you
 *          do with it (its faces stand against VERTICES), which is the same
 *          fact `MARK_MIN_FACING = 0.3` was chosen around.
 *   - d6   3 faces at 0.577 — the isometric cube.
 *   - d8   4 faces at 0.577
 *   - d10  5 kites at 0.669 — its `v[0]` is a POLE, so the trapezohedron
 *          idles pole-on, five equal faces around the point.
 *   - d12  3 faces at 0.795
 *   - d20  5 faces at 0.795
 *
 * Every one of those is under the 0.956 a rolled die rests at, and the worst
 * of them is under 0.81 — which is the gap the test defends. The other half
 * of the test is the one that matters more: the tie has to be EXACT, because
 * a «corner-on» pose that is a degree off is just a tilt again, with one face
 * quietly winning.
 */
export function idleOrientationFor(solid: Solid): Quat {
  const vertex = vUnit(solid.v[0]);
  // The shortest arc from the vertex to the camera axis. `|v × ẑ| = sin θ`
  // and `v · ẑ = cos θ`, so `atan2` of the two is the angle without an
  // `acos` that would lose precision as the two vectors line up.
  const axis = vCross(vertex, v3(0, 0, 1));
  const sin = vLen(axis);
  const toCamera =
    sin > 1e-12
      ? qAxisAngle(axis, Math.atan2(sin, vertex.z))
      : // Parallel: either already pointing at the camera (the d10's pole,
        // which is nothing to do) or dead away from it, where the cross
        // product has no direction to offer and any half-turn will do.
        vertex.z > 0
        ? QUAT_IDENTITY
        : qAxisAngle(v3(1, 0, 0), Math.PI);
  return qNormalize(qMul(qAxisAngle(v3(0, 0, 1), IDLE_TWIST), toCamera));
}

/** One pointer position, as the component saw it. `t` is any monotone clock;
 *  only differences are ever read. */
export interface PointerSample {
  t: number;
  x: number;
  y: number;
}

/**
 * The samples still inside the window at `now`, oldest first.
 *
 * Two edges, and both of them are about the release being HONEST:
 *
 *  - exactly one sample inside the window is not an interval, so the one
 *    before it is pulled back in. Otherwise a 70 Hz pointer stream that
 *    happened to land one report in the window would release the die on a
 *    single point, i.e. on nothing;
 *  - NO sample inside the window means the finger has been still for longer
 *    than the window, and the answer is «no flick». Only the last sample
 *    survives, which leaves `flickSpin` with nothing to measure — which is
 *    the truth, and is why it is spelled as a one-element list rather than
 *    as a special case there.
 */
export function trimSamples(
  samples: readonly PointerSample[],
  now: number,
): PointerSample[] {
  if (samples.length === 0) return [];
  const cutoff = now - TRACKBALL_SAMPLE_MS;
  let first = samples.findIndex((s) => s.t >= cutoff);
  if (first < 0) first = samples.length - 1;
  else if (samples.length - first < 2) first = Math.max(0, first - 1);
  return samples.slice(first);
}

/**
 * The angular velocity a released drag leaves behind, or `null` when the die
 * should simply stop where it is.
 *
 * The rotation law is `spinDelta`'s, to the letter — π radians per die-width
 * of travel — so the die does not change speed at the instant the finger
 * lifts. Everything here is about turning a DISTANCE into a RATE.
 *
 * `null` rather than a zero-rate spin: «there was no flick» and «there was a
 * flick of nothing» are the same thing to the eye and different things to a
 * rAF loop, and only one of them should start one.
 */
export function flickSpin(
  samples: readonly PointerSample[],
  diePx: number,
): Spin | null {
  if (samples.length < 2 || !(diePx > 0)) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  if (!(dt > 0)) return null;

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const travel = Math.hypot(dx, dy);
  if (!(travel > 0)) return null;

  const perStep = ((travel * Math.PI) / diePx / dt) * TRACKBALL_STEP_MS;
  const rate = Math.min(perStep, TRACKBALL_MAX_RATE);
  if (!(rate >= SPIN_STOP_EPS)) return null;

  // The same axis `spinDelta` picks, and for the same reason: `(dy, dx, 0)`
  // is the trackball axis once the y-flip is folded in. Stated here rather
  // than imported so the two cannot drift, and asserted equal in the test.
  return { axis: vUnit(v3(dy, dx, 0)), rate };
}

/** `steps` steps of coasting. The loop the component runs, as a function, so
 *  the invariants below are testable without a clock. */
export function coastSpin(state: SpinState, steps: number): SpinState {
  let at = state;
  for (let i = 0; i < steps && at.spin.rate !== 0; i++) at = spinStep(at);
  return at;
}

/**
 * How many steps a coast at `rate` takes to stop, and how far the die turns
 * on the way — the two numbers the tuning session in R5-C will actually be
 * arguing about, derived from the constants rather than from a stopwatch.
 *
 * Closed forms, both of them: the rate is a geometric sequence, so the step
 * count is a logarithm and the travel is a partial geometric sum. Written out
 * rather than iterated because a test that iterates the implementation to
 * check the implementation proves only that it is self-consistent.
 */
export function coastSteps(rate: number): number {
  const start = Math.abs(rate);
  if (!Number.isFinite(start) || start < SPIN_STOP_EPS) return 0;
  return Math.ceil(
    Math.log(SPIN_STOP_EPS / start) / Math.log(SPIN_DAMP_PER_STEP),
  );
}

/** Total rotation of a coast at `rate`, in radians. */
export function coastTravel(rate: number): number {
  const steps = coastSteps(rate);
  if (steps === 0) return 0;
  return (
    Math.abs(rate) *
    ((1 - SPIN_DAMP_PER_STEP ** steps) / (1 - SPIN_DAMP_PER_STEP))
  );
}
