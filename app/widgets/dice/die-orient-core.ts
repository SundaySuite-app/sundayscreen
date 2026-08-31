// WHICH WAY THE DIE IS FACING, as arithmetic.
//
// Quaternions, the orientation that shows a chosen face to the class, and the
// trackball a teacher's finger drags. Pure — no DOM, no timing. The bodies
// live in `die-solids-core.ts`, the camera in `die-project-core.ts`.
//
// ## Why quaternions and not three angles
//
// Euler angles gimbal-lock, and the two things this file has to do — «turn
// smoothly from wherever the finger left it to the face that was rolled» and
// «keep turning about the axis the finger threw it around» — are exactly the
// two operations quaternions do without a special case. Rotation matrices
// would do both too, but nine numbers drift out of orthogonality in a rAF
// loop and re-orthogonalising them is worse arithmetic than normalising four.
//
// ## The composition order is a TEST, not a comment
//
// `qMul(a, b)` is «a AFTER b». Getting that backwards produces a die that
// tumbles the right amount in the wrong frame — plausible-looking motion that
// lands on the wrong face — so the law is asserted rather than described:
// `qRotate(qMul(a, b), v) === qRotate(a, qRotate(b, v))`.
//
// ## The y-flip owns every sign in here
//
// SVG's y grows DOWNWARD; the maths frame's grows up. That single fact is why
// `orientationForFace` maps the face's down-axis to −ŷ and why `spinDelta`'s
// rotation axis is `(dy, dx, 0)` with a plus. Each is commented where it
// happens; neither is a fudge factor.

import { v3, vUnit, type Vec3 } from "./die-solids-core";
import type { Solid } from "./die-solids-core";

/** `(x, y, z, w)` — vector part first, scalar last. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Below this the trackball is considered stopped, in radians per 8 ms step.
 *  0.02°/ms — a quarter-turn would take fourteen seconds at that rate, so it
 *  reads as «stopped» while still being a rate rather than a hard cut. */
export const SPIN_STOP_EPS = (0.02 * 8 * Math.PI) / 180;

/** Inertia, per 8 ms step. 0.985^311 ≈ SPIN_STOP_EPS/0.31 rad: a hard flick
 *  coasts for about two and a half seconds and then stops for good. */
export const SPIN_DAMP_PER_STEP = 0.985;

/** `a` AFTER `b`. See the header — this order is pinned by a test. */
export function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** A rotation of `angle` radians about `axis`, right-hand rule. A zero-length
 *  axis gives the identity rather than NaN — a pointer that did not move must
 *  not blank the die. */
export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const unit = vUnit(axis);
  const len = Math.hypot(unit.x, unit.y, unit.z);
  if (!(len > 0) || !Number.isFinite(angle)) return QUAT_IDENTITY;
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: unit.x * s, y: unit.y * s, z: unit.z * s, w: Math.cos(half) };
}

/** Unit length. Called every frame: quaternions multiplied a thousand times
 *  drift, and a drifted quaternion scales the die as it turns it. */
export function qNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (!(len > 0)) return QUAT_IDENTITY;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** `q` applied to `v`. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // v + 2 · qv × (qv × v + w·v) — the branch-free form, two cross products
  // instead of building a matrix.
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

/**
 * The quaternion of the rotation whose MATRIX has these three rows.
 *
 * Shepperd's method: four algebraically equivalent formulas, one per diagonal
 * term, and the one whose denominator is largest is the one used. The naive
 * single formula divides by `√(1+trace)`, which goes to zero for a half-turn
 * — and a die that has been dragged 180° is not an edge case, it is Tuesday.
 */
export function qFromBasis(rowX: Vec3, rowY: Vec3, rowZ: Vec3): Quat {
  const m00 = rowX.x;
  const m01 = rowX.y;
  const m02 = rowX.z;
  const m10 = rowY.x;
  const m11 = rowY.y;
  const m12 = rowY.z;
  const m20 = rowZ.x;
  const m21 = rowZ.y;
  const m22 = rowZ.z;
  const trace = m00 + m11 + m22;
  if (trace > m00 && trace > m11 && trace > m22) {
    const s = Math.sqrt(trace + 1) * 2;
    return {
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s,
      w: 0.25 * s,
    };
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return {
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s,
      w: (m21 - m12) / s,
    };
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return {
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s,
      w: (m02 - m20) / s,
    };
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return {
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: 0.25 * s,
    w: (m10 - m01) / s,
  };
}

/**
 * Spherical interpolation from `a` to `b`, along the SHORT way round.
 *
 * `t ≥ 1` returns `b` verbatim — the same object, not a value that rounds to
 * it. Without that, the shortest-path flip (which silently replaces `b` with
 * `−b`, an identical rotation with different numbers) would make «the throw
 * lands EXACTLY on its face» a `toBeCloseTo`, and a landing assertion that
 * tolerates a millidegree is not a landing assertion. Same discipline as
 * `zeroed(-0)` next door.
 */
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  if (!(t > 0)) return a;
  if (t >= 1) return b;
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  // q and −q are the same rotation; the one with the positive dot is the one
  // reached by turning less than half a circle.
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    // Nearly parallel: sin θ₀ underflows and the spherical formula becomes
    // 0/0. A straight blend is within a rounding error of the arc here.
    return qNormalize({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }
  const theta0 = Math.acos(Math.min(1, dot));
  const theta = theta0 * t;
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sin0;
  const s1 = Math.sin(theta) / sin0;
  return {
    x: a.x * s0 + bx * s1,
    y: a.y * s0 + by * s1,
    z: a.z * s0 + bz * s1,
    w: a.w * s0 + bw * s1,
  };
}

/**
 * The orientation that turns one face square to the class.
 *
 * The face's own frame is mapped `(u, w, n) → (x̂, −ŷ, ẑ)`: the face's right
 * becomes screen right, its DOWN becomes −ŷ (which the projection's y-flip
 * turns back into screen down), and its normal points at the camera. Both
 * degrees of freedom are fixed — face to camera AND numeral level — which is
 * the whole reason `Face` carries `u` and `w` at all.
 */
export function orientationForFace(solid: Solid, faceIndex: number): Quat {
  const face = solid.f[faceIndex] ?? solid.f[0];
  return qNormalize(
    qFromBasis(face.u, v3(-face.w.x, -face.w.y, -face.w.z), face.n),
  );
}

/** The orientation that shows the face carrying `value`. An unknown value
 *  falls back to the first face rather than throwing — a config from a newer
 *  build must render something. */
export function orientationForValue(solid: Solid, value: number): Quat {
  const at = solid.f.findIndex((face) => face.value === value);
  return orientationForFace(solid, at < 0 ? 0 : at);
}

/**
 * A pointer drag turned into a rotation — the trackball.
 *
 * `dx`/`dy` are SCREEN pixels, y growing downward. The axis is
 * `(dy, dx, 0)`: in a y-up frame the trackball axis is `ẑ × (dx, dyᵤₚ, 0)` =
 * `(−dyᵤₚ, dx, 0)`, and `dyᵤₚ = −dy`, so the leading sign is positive. That
 * plus is the y-flip and NOTHING else; if it ever looks wrong, the flip moved,
 * not this line.
 *
 * Dragging half a die-width turns it a quarter circle — the ratio that makes
 * a die feel like an object under the finger rather than a slider.
 */
export function spinDelta(dx: number, dy: number, diePx: number): Quat {
  const travel = Math.hypot(dx, dy);
  if (!(travel > 0) || !(diePx > 0)) return QUAT_IDENTITY;
  return qAxisAngle(v3(dy, dx, 0), (travel * Math.PI) / diePx);
}

/** An angular velocity: a unit axis in VIEW space and radians per step. */
export interface Spin {
  axis: Vec3;
  rate: number;
}

export interface SpinState {
  q: Quat;
  spin: Spin;
}

/**
 * One step of coasting.
 *
 * The spin axis lives in VIEW space (the teacher flicked the screen, not the
 * die), so the increment multiplies on the LEFT. The rate decays by a fixed
 * factor and is SNAPPED to zero once it drops under `SPIN_STOP_EPS` — an
 * exponential never reaches zero, and a rAF loop that keeps running for a
 * rotation of 1e-9 radians a frame is the eight-hour-school-day battery bug.
 */
export function spinStep(state: SpinState): SpinState {
  const rate = state.spin.rate;
  if (!Number.isFinite(rate) || Math.abs(rate) < SPIN_STOP_EPS) {
    return { q: state.q, spin: { axis: state.spin.axis, rate: 0 } };
  }
  const q = qNormalize(qMul(qAxisAngle(state.spin.axis, rate), state.q));
  const next = rate * SPIN_DAMP_PER_STEP;
  return {
    q,
    spin: {
      axis: state.spin.axis,
      rate: Math.abs(next) < SPIN_STOP_EPS ? 0 : next,
    },
  };
}
