// THE THROW, as arithmetic.
//
// The old animation scrambled the pips in place for 600 ms. The owner asked
// for a die that is actually THROWN — flies across the card, bounces off the
// walls, spins, loses speed and lands on its answer. That is a simulation, and
// a simulation belongs in a pure core: node-tested, DOM-free, deterministic
// from a seed, so the invariants that matter on a projector (never leaves the
// card, always lands exactly where the layout put it) are PROVEN rather than
// eyeballed.
//
// ## The one non-obvious decision: the landing is STEERED, not hoped for
//
// A free simulation lands wherever friction happens to leave it, which is
// never the flex slot the die actually occupies — so the transform would have
// to snap at the end, or the die would sit visibly off its row. Instead the
// last `LANDING_FRACTION` of the flight interpolates the simulated position
// toward the die's resting slot on a smoothstep. Because a box is convex and
// both endpoints are inside it, every blended point is inside it too: the
// steering cannot break containment, and the final frame is EXACTLY the rest
// position with zero rotation.
//
// ## No gravity
//
// Dice on a table, not dice in the air: friction and wall damping only. That
// buys a clean invariant — speed never increases — which is the cheapest way
// to catch a sign error in the bounce. Gravity would inject energy and make
// "did the physics stay sane?" a much softer question.
//
// ## The die also TUMBLES now (R5)
//
// The flight above is unchanged — it is still the same four random draws per
// die, in the same order, producing the same pixels. What is new is an
// OPTIONAL orientation track alongside it: give the spec a `target` quaternion
// per die and every frame gains a `q`, tumbling about a seeded axis and slerped
// onto the target over the last `ORIENT_LANDING_FRACTION` of the flight.
//
// Two landing windows, on purpose. The orientation settles at 30 % and the
// position at 25 %, so the class reads the NUMBER a beat before the die stops
// moving — the eye wants the answer first and the choreography second.
//
// Without `target` there is no `q` on the frame at all and not one number in
// this file changes: the tumble's own random draws are APPENDED to each die's
// seed stream rather than inserted, so every existing trajectory survives to
// the last bit.

import {
  qAxisAngle,
  qMul,
  qNormalize,
  qSlerp,
  QUAT_IDENTITY,
  type Quat,
} from "./die-orient-core";

/** The box the dice must stay inside — the widget card's own content area. */
export interface ThrowBox {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ThrowSpec {
  box: ThrowBox;
  /** Each die's RESTING top-left inside `box` — its flex slot, i.e. where it
   *  already is when `transform` is `none`. */
  rest: readonly Point[];
  /** Side length of one (square) die face. */
  dieSize: number;
  /** Total flight time. */
  durationMs: number;
  /** One seed per die. Same seeds ⇒ same throw, always. */
  seed: readonly number[];
  /** Each die's orientation when the throw begins — where the teacher last
   *  left it. Missing entries start square to the class. */
  start?: readonly Quat[];
  /** Each die's orientation at REST: the face the roll must end up showing.
   *  Omit the whole field and the throw has no orientation track at all. */
  target?: readonly Quat[];
}

export interface DieFrame {
  /** Offset from the die's resting slot, in px — straight into `translate()`. */
  dx: number;
  dy: number;
  /** Rotation in degrees. Since R5 this is the die's TUMBLE angle about its
   *  seeded axis rather than a flat CSS spin — the same number, computed the
   *  same way, read by the 3D renderer instead of a `rotate()`. */
  rot: number;
  /** The SIMULATION's speed at this step, px/ms — before the landing blend,
   *  which is steering rather than physics. Nothing renders it; it is here so
   *  the monotone-decay invariant is observable from a test instead of being
   *  an unverifiable claim in a comment. */
  speed: number;
  /** The die's orientation this frame. ABSENT — not identity, not null —
   *  when the spec carried no `target`, so a renderer that does not ask for
   *  orientation cannot accidentally receive one. */
  q?: Quat;
}

/** Frames are `THROW_STEP_MS` apart. Fixed, so a frame index is a pure
 *  function of elapsed time and a dropped rAF cannot desynchronise anything. */
export const THROW_STEP_MS = 8;

/** How much of the flight is spent being steered home. */
export const LANDING_FRACTION = 0.25;

/** How much of the flight is spent being steered onto the ANSWER — a separate
 *  constant from `LANDING_FRACTION`, and deliberately larger. The number is
 *  what the class is waiting for, so it settles first and the die coasts the
 *  last quarter into its slot with the answer already readable. */
export const ORIENT_LANDING_FRACTION = 0.3;

/** Degrees → radians, for turning the tumble angle into a rotation. */
const DEG = Math.PI / 180;

/** Wall damping — a die comes off the edge with 70 % of the speed it hit at. */
const RESTITUTION = 0.7;

/** Table friction, per step. 0.995^138 ≈ 0.5: a 1100 ms throw ends at about
 *  half the speed it started with, which reads as "slowing down" without
 *  looking like it stalls. */
const FRICTION_PER_STEP = 0.995;

/** Degrees of spin per px travelled — rotation is proportional to speed, so
 *  the die visibly stops turning as it stops moving. */
const SPIN_DEG_PER_PX = 1.1;

/** How many box-widths of travel the launch aims for, before friction. The
 *  spread is what keeps three dice from moving as one object. */
const LAUNCH_SPANS_MIN = 3;
const LAUNCH_SPANS_SPREAD = 2;

/** A die may reflect at most this many times inside ONE step. Only reachable
 *  when the box is narrower than the die's travel per step; the final clamp
 *  is what actually guarantees containment. */
const MAX_BOUNCES_PER_STEP = 8;

/** mulberry32 — small, fast, and the same sequence in every engine, which is
 *  the only property that matters here. */
function mulberry32(seed: number): () => number {
  let a = (Number.isFinite(seed) ? seed : 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Smoothstep: 0 at 0, 1 at 1, flat at both ends — no visible kink where the
 *  free flight hands over to the steered landing. */
function smoothstep(x: number): number {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}

/** `negative * 0` is `-0`, and `Object.is(-0, 0)` is false — so a die that
 *  drifted home from the LEFT would fail «landed exactly on its slot» while
 *  being pixel-perfect on screen. Normalise the sign of zero here rather than
 *  weakening the assertion there. */
function zeroed(value: number): number {
  return value === 0 ? 0 : value;
}

/** `[0, max]` pulled in by `pad` on both sides — collapsed to the single
 *  midpoint when there is not that much range to give. */
function inset(max: number, pad: number): { min: number; max: number } {
  if (max <= pad * 2) {
    const middle = max / 2;
    return { min: middle, max: middle };
  }
  return { min: pad, max: max - pad };
}

interface Axis {
  pos: number;
  vel: number;
  min: number;
  max: number;
}

/** Advance one axis by `dt`, reflecting off both walls with damping. */
function step(axis: Axis, dt: number): void {
  if (axis.max <= axis.min) {
    // A box no wider than the die: there is nowhere to travel, and a
    // reflection loop here would never converge.
    axis.pos = axis.min;
    axis.vel = 0;
    return;
  }
  axis.pos += axis.vel * dt;
  let bounces = 0;
  while (
    (axis.pos < axis.min || axis.pos > axis.max) &&
    bounces++ < MAX_BOUNCES_PER_STEP
  ) {
    if (axis.pos < axis.min) {
      axis.pos = axis.min + (axis.min - axis.pos) * RESTITUTION;
    } else {
      axis.pos = axis.max - (axis.pos - axis.max) * RESTITUTION;
    }
    axis.vel = -axis.vel * RESTITUTION;
  }
  axis.pos = clamp(axis.pos, axis.min, axis.max);
}

/**
 * The whole throw, precomputed.
 *
 * Outer index is the FRAME (`THROW_STEP_MS` apart, first frame at t = 0, last
 * frame at t = `durationMs`); inner index is the die. Precomputing rather than
 * integrating per rAF tick keeps the render loop trivial and makes every frame
 * inspectable from a test.
 */
export function simulateThrow(spec: ThrowSpec): DieFrame[][] {
  const count = Math.min(spec.rest.length, spec.seed.length);
  const duration = Math.max(finite(spec.durationMs), 0);
  const steps = Math.max(1, Math.ceil(duration / THROW_STEP_MS));

  const boxW = Math.max(finite(spec.box.w), 0);
  const boxH = Math.max(finite(spec.box.h), 0);
  const size = Math.max(finite(spec.dieSize), 0);
  const maxX = Math.max(boxW - size, 0);
  const maxY = Math.max(boxH - size, 0);
  const span = Math.max(boxW, boxH);

  // The rest slots the simulation works against. Clamped into the legal range
  // so a mismeasured slot cannot put the whole flight outside the card; the
  // component clears the transform once the throw is over, so the LAYOUT — not
  // this clamped copy — is what the die finally sits on.
  const rest = spec.rest.slice(0, count).map((p) => ({
    x: clamp(finite(p.x), 0, maxX),
    y: clamp(finite(p.y), 0, maxY),
  }));

  // ⚠️ The die is SQUARE and it SPINS. Its axis-aligned footprint at 45° is
  // `size × √2`, so a face parked flat against a wall pokes `SPIN_PAD` past it
  // and the card's `overflow: hidden` slices a corner off — mid-throw, on a
  // projector, which is precisely where nobody is going to file a bug about
  // it. The TRAVEL range is inset by that much; the LANDING target is not,
  // because a landed die has no rotation left to make room for.
  const spinPad = (size * (Math.SQRT2 - 1)) / 2;
  const travelX = inset(maxX, spinPad);
  const travelY = inset(maxY, spinPad);

  const dice = rest.map((home, i) => {
    const rand = mulberry32(spec.seed[i]);
    const angle = rand() * Math.PI * 2;
    // Speed is expressed as "box-spans per flight" so a small card gets a
    // small throw and a projector-sized one gets a big one.
    const spans = LAUNCH_SPANS_MIN + rand() * LAUNCH_SPANS_SPREAD;
    const speed = duration > 0 ? (span * spans) / duration : 0;
    const spinSign = rand() < 0.5 ? -1 : 1;
    const spinScale = 0.6 + rand() * 0.8;
    // ⚠️ APPENDED, never inserted. The four draws above ARE the trajectory;
    // taking the tumble axis before any of them would shift every die in
    // every existing throw by a few pixels — a change no test would name and
    // every screenshot would show. Two draws, uniform on the sphere.
    const spinAzimuth = rand() * Math.PI * 2;
    const spinZ = rand() * 2 - 1;
    const spinRing = Math.sqrt(Math.max(0, 1 - spinZ * spinZ));
    return {
      axis: {
        x: spinRing * Math.cos(spinAzimuth),
        y: spinRing * Math.sin(spinAzimuth),
        z: spinZ,
      },
      start: spec.start?.[i] ?? QUAT_IDENTITY,
      target: spec.target?.[i],
      x: {
        pos: clamp(home.x, travelX.min, travelX.max),
        vel: Math.cos(angle) * speed,
        ...travelX,
      },
      y: {
        pos: clamp(home.y, travelY.min, travelY.max),
        vel: Math.sin(angle) * speed,
        ...travelY,
      },
      rot: 0,
      spin: spinSign * spinScale,
      home,
    };
  });

  const landStart = 1 - LANDING_FRACTION;
  const orientStart = 1 - ORIENT_LANDING_FRACTION;
  const frames: DieFrame[][] = [];

  for (let i = 0; i <= steps; i++) {
    if (i > 0) {
      for (const die of dice) {
        step(die.x, THROW_STEP_MS);
        step(die.y, THROW_STEP_MS);
        die.x.vel *= FRICTION_PER_STEP;
        die.y.vel *= FRICTION_PER_STEP;
        const speed = Math.hypot(die.x.vel, die.y.vel);
        die.rot += die.spin * SPIN_DEG_PER_PX * speed * THROW_STEP_MS;
      }
    }
    // Progress is counted in FRAMES, not milliseconds, so the last frame is
    // exactly 1 whatever the duration rounds to — the landing is guaranteed,
    // not almost-guaranteed.
    const progress = i / steps;
    const blend = smoothstep(
      progress <= landStart ? 0 : (progress - landStart) / LANDING_FRACTION,
    );
    const free = 1 - blend;
    const homing = smoothstep(
      progress <= orientStart
        ? 0
        : (progress - orientStart) / ORIENT_LANDING_FRACTION,
    );
    frames.push(
      dice.map((die) => {
        const frame: DieFrame = {
          dx: zeroed((die.x.pos - die.home.x) * free),
          dy: zeroed((die.y.pos - die.home.y) * free),
          rot: zeroed(die.rot * free),
          speed: Math.hypot(die.x.vel, die.y.vel),
        };
        if (die.target) {
          // The tumble reads the RAW accumulator, not the frame's steered
          // `rot`: the slerp has to leave from a place that is still turning
          // forwards, or the die visibly un-tumbles and re-turns in the last
          // quarter — two blends pulling on the same rotation.
          const tumbled = qNormalize(
            qMul(qAxisAngle(die.axis, die.rot * DEG), die.start),
          );
          frame.q = qSlerp(tumbled, die.target, homing);
        }
        return frame;
      }),
    );
  }

  return frames;
}

/** The frame for an elapsed time, clamped at both ends — a late rAF tick past
 *  the end reads the landing frame rather than falling off the table. */
export function frameAt(frames: DieFrame[][], tMs: number): DieFrame[] {
  if (frames.length === 0) return [];
  const index = clamp(
    Math.floor(finite(tMs) / THROW_STEP_MS),
    0,
    frames.length - 1,
  );
  return frames[index];
}
