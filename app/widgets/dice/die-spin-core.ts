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
  spinStep,
  SPIN_DAMP_PER_STEP,
  SPIN_STOP_EPS,
  qAxisAngle,
  qMul,
  qNormalize,
  type Quat,
  type Spin,
  type SpinState,
} from "./die-orient-core";
import { v3, vUnit } from "./die-solids-core";

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
 * The die's pose before anybody has rolled it.
 *
 * A real die is never seen square-on by accident, and this one must not be
 * either: `lastRoll` is empty on a freshly added widget, and a body parked at
 * the identity would show its first face flat to the class — a «1» the widget
 * would be inventing. Tipped like this, no face is square enough to read as
 * an answer and every body shows the three-quarter view that says «solid».
 *
 * The pinned property is the one that matters (see the test): at this
 * orientation the best face of every one of the six bodies is well short of
 * facing the class.
 *
 * ⚠️ The x tilt is BIG (80°), and that is not a stylistic choice — it is what
 * the bodies cost. An octahedron's eight normals are the cube's diagonals, so
 * a gentle nudge off square lands the next face square instead; a search over
 * the whole two-angle grid found nothing under ~75° that keeps all six bodies
 * off «flat on» at once. These two angles are the pose where the squarest
 * face of the worst body is furthest from facing the class.
 */
export const IDLE_TILT: Quat = qNormalize(
  qMul(
    qAxisAngle(v3(0, 1, 0), (28 * Math.PI) / 180),
    qAxisAngle(v3(1, 0, 0), (-80 * Math.PI) / 180),
  ),
);

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
