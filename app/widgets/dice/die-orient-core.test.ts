import { describe, expect, it } from "vitest";

import {
  QUAT_IDENTITY,
  qAxisAngle,
  qFromBasis,
  qMul,
  qNormalize,
  qRotate,
  qSlerp,
  orientationForFace,
  orientationForValue,
  SPIN_DAMP_PER_STEP,
  SPIN_STOP_EPS,
  spinDelta,
  spinStep,
  type Quat,
} from "./die-orient-core";
import {
  SOLID_SIDES,
  solidFor,
  v3,
  vDot,
  vLen,
  vSub,
  type Vec3,
} from "./die-solids-core";

const X = v3(1, 0, 0);
const Y = v3(0, 1, 0);
const Z = v3(0, 0, 1);

function qLen(q: Quat): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

function expectVec(got: Vec3, want: Vec3, digits = 12): void {
  expect(vLen(vSub(got, want))).toBeLessThan(10 ** -digits);
}

/** mulberry32 again — the tests need a repeatable stream of orientations and
 *  `Math.random` would make a failure impossible to reproduce. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomQuat(rand: () => number): Quat {
  return qNormalize({
    x: rand() * 2 - 1,
    y: rand() * 2 - 1,
    z: rand() * 2 - 1,
    w: rand() * 2 - 1,
  });
}

describe("the quaternion algebra", () => {
  it("composes a AFTER b — the order, as a law", () => {
    // The whole reason this test exists: get the order backwards and the die
    // still tumbles by the right amount, in the wrong frame, landing on the
    // wrong face. Nothing about the motion looks broken.
    const rand = seeded(7);
    for (let i = 0; i < 200; i++) {
      const a = randomQuat(rand);
      const b = randomQuat(rand);
      const v = v3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      expectVec(qRotate(qMul(a, b), v), qRotate(a, qRotate(b, v)), 12);
    }
  });

  it("turns the basis the way the right hand says", () => {
    const quarter = Math.PI / 2;
    expectVec(qRotate(qAxisAngle(Z, quarter), X), Y);
    expectVec(qRotate(qAxisAngle(X, quarter), Y), Z);
    expectVec(qRotate(qAxisAngle(Y, quarter), Z), X);
    expectVec(qRotate(QUAT_IDENTITY, v3(3, -4, 5)), v3(3, -4, 5));
  });

  it("survives a degenerate axis or angle instead of blanking the die", () => {
    expect(qAxisAngle(v3(0, 0, 0), 1)).toEqual(QUAT_IDENTITY);
    expect(qAxisAngle(X, NaN)).toEqual(QUAT_IDENTITY);
    expect(qNormalize({ x: 0, y: 0, z: 0, w: 0 })).toEqual(QUAT_IDENTITY);
    expect(qLen(qNormalize({ x: 3, y: 0, z: 4, w: 0 }))).toBeCloseTo(1, 15);
  });

  it("rotates without stretching", () => {
    const rand = seeded(11);
    for (let i = 0; i < 200; i++) {
      const q = randomQuat(rand);
      const v = v3(rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2);
      expect(vLen(qRotate(q, v))).toBeCloseTo(vLen(v), 12);
    }
  });

  it("reads a rotation back out of its matrix — all four Shepperd branches", () => {
    // The half-turns are the point. A single-formula conversion divides by
    // √(1 + trace), which is zero for every one of them, and a die dragged
    // 180° is not an edge case.
    const cases: [Vec3, Vec3, Vec3][] = [
      [X, Y, Z], // identity — trace branch
      [v3(1, 0, 0), v3(0, -1, 0), v3(0, 0, -1)], // 180° about x
      [v3(-1, 0, 0), v3(0, 1, 0), v3(0, 0, -1)], // 180° about y
      [v3(-1, 0, 0), v3(0, -1, 0), v3(0, 0, 1)], // 180° about z
    ];
    for (const [rx, ry, rz] of cases) {
      const q = qFromBasis(rx, ry, rz);
      expect(qLen(q)).toBeCloseTo(1, 12);
      for (const v of [X, Y, Z, v3(0.3, -0.7, 0.5)]) {
        expectVec(qRotate(q, v), v3(vDot(rx, v), vDot(ry, v), vDot(rz, v)), 12);
      }
    }
  });

  it("round-trips any rotation through its matrix", () => {
    const rand = seeded(23);
    for (let i = 0; i < 300; i++) {
      const q = randomQuat(rand);
      const rows = [X, Y, Z].map((axis) => {
        // row i of the matrix = (R·x̂)ᵢ, (R·ŷ)ᵢ, (R·ẑ)ᵢ
        const rx = qRotate(q, X);
        const ry = qRotate(q, Y);
        const rz = qRotate(q, Z);
        const pick = (v: Vec3) => vDot(v, axis);
        return v3(pick(rx), pick(ry), pick(rz));
      });
      const back = qFromBasis(rows[0], rows[1], rows[2]);
      for (const v of [X, Y, Z]) expectVec(qRotate(back, v), qRotate(q, v), 11);
    }
  });
});

describe("qSlerp", () => {
  it("returns b VERBATIM at t ≥ 1 — so «landed exactly» can stay exact", () => {
    const a = qAxisAngle(Z, 1.1);
    const b = qAxisAngle(X, 2.4);
    expect(qSlerp(a, b, 1)).toBe(b);
    expect(qSlerp(a, b, 4)).toBe(b);
    expect(qSlerp(a, b, 1)).toEqual(b);
    // …and a verbatim at the other end, so a throw that has not started has
    // not moved.
    expect(qSlerp(a, b, 0)).toBe(a);
    expect(qSlerp(a, b, -3)).toBe(a);
    expect(qSlerp(a, b, NaN)).toBe(a);
  });

  it("takes the SHORT way round even when the target is spelled backwards", () => {
    // q and −q are the same rotation with opposite numbers. Without the flip
    // the die would take the 300° route to a 60° turn — a die that spins
    // backwards on landing, with every other test still green.
    const a = QUAT_IDENTITY;
    const b = qAxisAngle(Z, 0.6);
    const negated: Quat = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    const mid = qSlerp(a, negated, 0.5);
    const straight = qSlerp(a, b, 0.5);
    // Same rotation, whichever sign the target was written with.
    expectVec(qRotate(mid, X), qRotate(straight, X), 12);
    // …and it is the SHORT arc: halfway is 0.3 rad, not 3.0 rad.
    const angle = Math.acos(Math.min(1, Math.abs(mid.w))) * 2;
    expect(angle).toBeCloseTo(0.3, 10);
  });

  it("stays on the unit sphere all the way across", () => {
    const rand = seeded(31);
    for (let i = 0; i < 100; i++) {
      const a = randomQuat(rand);
      const b = randomQuat(rand);
      for (let t = 0; t <= 1.0001; t += 0.05) {
        expect(qLen(qSlerp(a, b, t))).toBeCloseTo(1, 10);
      }
    }
  });

  it("blends nearly-parallel quaternions without dividing by zero", () => {
    const a = qAxisAngle(Z, 1);
    const b = qAxisAngle(Z, 1 + 1e-9);
    const mid = qSlerp(a, b, 0.5);
    expect(Number.isFinite(mid.w)).toBe(true);
    expect(qLen(mid)).toBeCloseTo(1, 12);
  });
});

describe("orientationForFace — both degrees of freedom", () => {
  it("puts the face at the camera AND its numeral level, for every face of every body", () => {
    // Face-to-camera alone leaves the numeral free to sit at any angle, and a
    // «20» lying on its side reads as «02» from the back of the room. Both
    // axes are pinned, on all 60 faces.
    for (const sides of SOLID_SIDES) {
      const solid = solidFor(sides);
      solid.f.forEach((face, i) => {
        const q = orientationForFace(solid, i);
        expectVec(qRotate(q, face.n), v3(0, 0, 1), 12);
        expectVec(qRotate(q, face.u), v3(1, 0, 0), 12);
        // −ŷ, because the projection flips y on the way to SVG: the face's
        // DOWN has to point at −ŷ here to come out pointing down there.
        expectVec(qRotate(q, face.w), v3(0, -1, 0), 12);
        expect(qLen(q)).toBeCloseTo(1, 12);
      });
    }
  });

  it("finds the orientation for a VALUE, and falls back rather than throwing", () => {
    for (const sides of SOLID_SIDES) {
      const solid = solidFor(sides);
      for (let value = 1; value <= sides; value++) {
        const at = solid.f.findIndex((f) => f.value === value);
        expect(orientationForValue(solid, value)).toEqual(
          orientationForFace(solid, at),
        );
        // …and it really does show that number to the class.
        const q = orientationForValue(solid, value);
        expectVec(qRotate(q, solid.f[at].n), v3(0, 0, 1), 12);
      }
      // A value from a newer build's die type must render SOMETHING.
      expect(orientationForValue(solid, 99)).toEqual(
        orientationForFace(solid, 0),
      );
      expect(orientationForFace(solid, 999)).toEqual(
        orientationForFace(solid, 0),
      );
    }
  });
});

describe("the trackball", () => {
  it("rolls the front face the way the finger went", () => {
    // Dragging right must send the front face right and dragging DOWN must
    // send it down — the sign that the y-flip is accounted for exactly once.
    const right = qRotate(spinDelta(30, 0, 200), Z);
    expect(right.x).toBeGreaterThan(0.1);
    expect(Math.abs(right.y)).toBeLessThan(1e-12);
    const down = qRotate(spinDelta(0, 30, 200), Z);
    expect(down.y).toBeLessThan(-0.1);
    expect(Math.abs(down.x)).toBeLessThan(1e-12);
  });

  it("turns a quarter circle for half a die-width", () => {
    // The ratio that makes the die feel like an object rather than a slider.
    expectVec(qRotate(spinDelta(100, 0, 200), Z), X, 12);
    expectVec(qRotate(spinDelta(0, 100, 200), Z), v3(0, -1, 0), 12);
  });

  it("does nothing for a pointer that did not move", () => {
    expect(spinDelta(0, 0, 200)).toEqual(QUAT_IDENTITY);
    expect(spinDelta(10, 10, 0)).toEqual(QUAT_IDENTITY);
    expect(spinDelta(10, 10, NaN)).toEqual(QUAT_IDENTITY);
  });
});

describe("spinStep — the inertia", () => {
  it("slows strictly, stops for good, and stays a unit quaternion", () => {
    // Three claims in one loop because they fail together: an exponential that
    // never reaches zero is a rAF loop that never stops, and a quaternion
    // multiplied ten thousand times drifts off the sphere and starts scaling
    // the die as it turns it.
    let state = {
      q: QUAT_IDENTITY,
      spin: { axis: v3(1, 2, 3), rate: 0.31 },
    };
    let previous = Infinity;
    let stoppedAt = -1;
    for (let i = 0; i < 10_000; i++) {
      state = spinStep(state);
      const rate = Math.abs(state.spin.rate);
      if (rate > 0) {
        expect(rate).toBeLessThan(previous);
        previous = rate;
      } else if (stoppedAt < 0) {
        stoppedAt = i;
      }
      expect(qLen(state.q)).toBeCloseTo(1, 10);
    }
    expect(stoppedAt).toBeGreaterThan(50);
    // 8 ms a step: a hard flick coasts a couple of seconds, not a minute.
    expect(stoppedAt * 8).toBeLessThan(3000);
    expect(state.spin.rate).toBe(0);
  });

  it("damps by exactly the pinned factor while it is still moving", () => {
    const state = {
      q: QUAT_IDENTITY,
      spin: { axis: v3(0, 0, 1), rate: 0.2 },
    };
    expect(spinStep(state).spin.rate).toBeCloseTo(0.2 * SPIN_DAMP_PER_STEP, 15);
    // …and it really did turn the die, by the rate it was given.
    expectVec(
      qRotate(spinStep(state).q, X),
      qRotate(qAxisAngle(v3(0, 0, 1), 0.2), X),
      12,
    );
  });

  it("is already still below the stop threshold", () => {
    const state = {
      q: qAxisAngle(X, 0.4),
      spin: { axis: v3(0, 1, 0), rate: SPIN_STOP_EPS * 0.99 },
    };
    const next = spinStep(state);
    expect(next.spin.rate).toBe(0);
    expect(next.q).toBe(state.q);
    expect(spinStep({ ...state, spin: { axis: X, rate: NaN } }).spin.rate).toBe(
      0,
    );
  });
});
