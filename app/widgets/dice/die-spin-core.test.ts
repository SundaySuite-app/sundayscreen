// The trackball's release, as invariants.
//
// A flick is tuned by eye and then defended by arithmetic. These tests are the
// arithmetic half: they do not claim the numbers FEEL right (R5-C does that,
// with the owner and a projector) — they claim that whatever the numbers are
// tuned to, the die still slows down, still stops, still turns a sane amount,
// and still does the same thing twice.

import { describe, expect, it } from "vitest";

import { FACE_OPTIONS } from "./dice-core";

import {
  QUAT_IDENTITY,
  qRotate,
  SPIN_DAMP_PER_STEP,
  SPIN_STOP_EPS,
  spinDelta,
  spinStep,
  type SpinState,
} from "./die-orient-core";
import { SOLID_SIDES, solidFor, v3, vDot } from "./die-solids-core";
import {
  IDLE_TILT,
  TRACKBALL_MAX_DEG_PER_MS,
  TRACKBALL_MAX_RATE,
  TRACKBALL_SAMPLE_MS,
  TRACKBALL_STEP_MS,
  coastSpin,
  coastSteps,
  coastTravel,
  flickSpin,
  restOrientationForValue,
  trimSamples,
  type PointerSample,
} from "./die-spin-core";

/** A straight drag of `px` pixels to the right over `ms`, sampled at 60 Hz. */
function drag(px: number, ms: number): PointerSample[] {
  const out: PointerSample[] = [];
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i <= steps; i++) {
    out.push({ t: (i * ms) / steps, x: (i * px) / steps, y: 0 });
  }
  return out;
}

describe("trimSamples", () => {
  it("keeps the window and drops what is older", () => {
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 1, y: 0 },
      { t: 160, x: 2, y: 0 },
      { t: 190, x: 3, y: 0 },
    ];
    // 200 − 60 = 140, so t = 160 and t = 190 are the window.
    expect(trimSamples(samples, 200).map((s) => s.t)).toEqual([160, 190]);
  });

  it("reaches back one sample when the window holds only one", () => {
    // A single point is not an interval, and a release measured on one is a
    // release measured on nothing.
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 10, y: 0 },
      { t: 190, x: 40, y: 0 },
    ];
    expect(trimSamples(samples, 200).map((s) => s.t)).toEqual([100, 190]);
  });

  it("a finger that has been still leaves nothing to measure", () => {
    // The drag stopped 500 ms ago. «No flick» is the truth, and it is spelled
    // as a one-element list so `flickSpin` needs no special case for it.
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 20, x: 40, y: 0 },
    ];
    const kept = trimSamples(samples, 520);
    expect(kept.map((s) => s.t)).toEqual([20]);
    expect(flickSpin(kept, 120)).toBeNull();
  });

  it("never invents samples", () => {
    expect(trimSamples([], 100)).toEqual([]);
  });
});

describe("flickSpin", () => {
  it("is silent when there was no flick", () => {
    expect(flickSpin([], 120)).toBeNull();
    expect(flickSpin([{ t: 0, x: 0, y: 0 }], 120)).toBeNull();
    // Two samples at the same instant: a rate would be a division by zero.
    expect(
      flickSpin(
        [
          { t: 5, x: 0, y: 0 },
          { t: 5, x: 40, y: 0 },
        ],
        120,
      ),
    ).toBeNull();
    // A finger that was put down and lifted without moving.
    expect(
      flickSpin(
        [
          { t: 0, x: 10, y: 10 },
          { t: 50, x: 10, y: 10 },
        ],
        120,
      ),
    ).toBeNull();
    // An unmeasured die: no width, no rotation law.
    expect(flickSpin(drag(300, 60), 0)).toBeNull();
  });

  it("lets a slow positioning drag settle where it was left", () => {
    // Half a die-width over a whole second is a teacher POSITIONING the die,
    // not throwing it. There is no «too slow to be a flick» constant — the
    // only floor is `SPIN_STOP_EPS`, which is far below this — so the
    // invariant is not «no coast» but «a coast nobody would call movement».
    const spin = flickSpin(trimSamples(drag(60, 1000), 1000), 120)!;
    const degrees = (coastTravel(spin.rate) * 180) / Math.PI;
    expect(degrees).toBeLessThan(45);
  });

  it("agrees with the trackball it takes over from", () => {
    // The finger is not allowed to change the die's speed by letting go. The
    // drag turns the die by `spinDelta`; the release must continue at that
    // same law, which is checkable as «one step of coasting equals the last
    // 8 ms of dragging».
    const diePx = 120;
    const perMs = 0.5; // px/ms — a mild, uncapped flick
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 40, x: 40 * perMs, y: 0 },
    ];
    const spin = flickSpin(samples, diePx)!;
    expect(spin).not.toBeNull();

    const dragged = spinDelta(perMs * TRACKBALL_STEP_MS, 0, diePx);
    // Same axis…
    expect(spin.axis.x).toBeCloseTo(0, 12);
    expect(spin.axis.y).toBeCloseTo(1, 12);
    expect(spin.axis.z).toBeCloseTo(0, 12);
    // …and the same angle: `qAxisAngle` puts sin(θ/2) on the axis.
    expect(
      2 * Math.asin(Math.hypot(dragged.x, dragged.y, dragged.z)),
    ).toBeCloseTo(spin.rate, 12);
  });

  it("caps a trackpad's idea of «one millisecond»", () => {
    // Two samples 1 ms apart with three pixels between them is an ordinary
    // report from a high-rate trackpad, and it implies 45 turns a second.
    const spin = flickSpin(
      [
        { t: 0, x: 0, y: 0 },
        { t: 1, x: 3, y: 0 },
      ],
      120,
    )!;
    expect(spin.rate).toBe(TRACKBALL_MAX_RATE);
    expect(
      (TRACKBALL_MAX_RATE * 180) / Math.PI / TRACKBALL_STEP_MS,
    ).toBeCloseTo(TRACKBALL_MAX_DEG_PER_MS, 12);
  });

  it("measures the LAST part of the drag, not the whole of it", () => {
    // The point of the window: a slow drag that ends in a flick releases at
    // the flick's speed. Same total travel, opposite ends of the gesture.
    const slowThenFast: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 400, x: 20, y: 0 },
      { t: 440, x: 200, y: 0 },
    ];
    const windowed = trimSamples(slowThenFast, 440);
    const whole = flickSpin(slowThenFast, 120)!;
    const flick = flickSpin(windowed, 120)!;
    expect(flick.rate).toBeGreaterThan(whole.rate);
  });

  it("is deterministic", () => {
    const samples = drag(180, 60);
    expect(flickSpin(samples, 120)).toEqual(flickSpin(samples, 120));
  });
});

describe("the coast", () => {
  const spinning = (rate: number): SpinState => ({
    q: QUAT_IDENTITY,
    spin: { axis: v3(0, 1, 0), rate },
  });

  it("slows down, every step, and never speeds up", () => {
    let at = spinning(TRACKBALL_MAX_RATE);
    let previous = Infinity;
    for (let i = 0; i < 400; i++) {
      const next = spinStep(at);
      expect(next.spin.rate).toBeLessThan(previous);
      previous = next.spin.rate === 0 ? -Infinity : next.spin.rate;
      at = next;
      if (at.spin.rate === 0) break;
    }
    expect(at.spin.rate).toBe(0);
  });

  it("stops — and the stop is a snap to zero, not an asymptote", () => {
    // An exponential never reaches zero. A rAF loop that keeps running for a
    // rotation of 1e-9 radians a frame is the eight-hour-school-day battery
    // bug, so the rate is SNAPPED once it drops under the floor.
    const steps = coastSteps(TRACKBALL_MAX_RATE);
    const ms = steps * TRACKBALL_STEP_MS;
    // ⚠️ Pinned to what the constants actually give, not to the round number
    // in the plan («under 2 s»): 0.985 per 8 ms from the cap works out at
    // ~2.5 s, and a test written to the wish rather than the arithmetic is a
    // test that gets its threshold quietly raised the first time it runs.
    // Tune the DAMPING to move this, and this number moves with it.
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(2700);

    const stopped = coastSpin(spinning(TRACKBALL_MAX_RATE), steps);
    expect(stopped.spin.rate).toBe(0);
    // …and it was still turning one step earlier, so the count is tight
    // rather than merely sufficient.
    expect(
      coastSpin(spinning(TRACKBALL_MAX_RATE), steps - 1).spin.rate,
    ).toBeGreaterThan(0);
  });

  it("a hard flick is about three turns", () => {
    // The interval, not the number: this is the one thing a teacher actually
    // experiences, and it has to stay in the band where a d20 is readable as
    // it slows rather than a grey ball that suddenly stops.
    const turns = coastTravel(TRACKBALL_MAX_RATE) / (2 * Math.PI);
    expect(turns).toBeGreaterThan(2.5);
    expect(turns).toBeLessThan(4);
  });

  it("a 300 px flick across a 120 px die lands in the same band", () => {
    // The gesture, end to end: sampled like a real pointermove stream, run
    // through the release, and measured in turns.
    const spin = flickSpin(trimSamples(drag(300, 60), 60), 120)!;
    const turns = coastTravel(spin.rate) / (2 * Math.PI);
    expect(turns).toBeGreaterThan(2);
    expect(turns).toBeLessThan(4);
  });

  it("the closed forms agree with the loop they describe", () => {
    // `coastSteps`/`coastTravel` are derivations, and a derivation that has
    // drifted from the loop is worse than no derivation. Measured against
    // `spinStep` itself.
    for (const rate of [TRACKBALL_MAX_RATE, 0.1, 0.02, SPIN_STOP_EPS * 1.5]) {
      let at = spinning(rate);
      let steps = 0;
      let travel = 0;
      while (at.spin.rate !== 0 && steps < 5000) {
        travel += at.spin.rate;
        at = spinStep(at);
        steps++;
      }
      expect(steps, `steps at rate ${rate}`).toBe(coastSteps(rate));
      expect(travel).toBeCloseTo(coastTravel(rate), 9);
    }
  });

  it("a rate under the floor never starts a loop at all", () => {
    expect(coastSteps(SPIN_STOP_EPS / 2)).toBe(0);
    expect(coastTravel(SPIN_STOP_EPS / 2)).toBe(0);
    expect(coastSteps(NaN)).toBe(0);
  });

  it("damping is a fraction, and the floor is under the cap", () => {
    // The two constants this file inherits. Either one nudged out of range
    // turns every test above into a different question.
    expect(SPIN_DAMP_PER_STEP).toBeGreaterThan(0);
    expect(SPIN_DAMP_PER_STEP).toBeLessThan(1);
    expect(SPIN_STOP_EPS).toBeLessThan(TRACKBALL_MAX_RATE);
    expect(TRACKBALL_SAMPLE_MS).toBeGreaterThan(TRACKBALL_STEP_MS);
  });
});

describe("IDLE_TILT", () => {
  it("shows no body a face square enough to read as an answer", () => {
    // The whole point: a die nobody has rolled must not appear to be showing
    // one. `facing` is the cosine between a face normal and the screen, so 1
    // is «flat on» — the pose has to keep every body well short of it.
    for (const sides of SOLID_SIDES) {
      const solid = solidFor(sides);
      const best = Math.max(
        ...solid.f.map((face) => qRotate(IDLE_TILT, face.n).z),
      );
      expect(best, `d${sides} reads as an answer at rest`).toBeLessThan(0.9);
      // …and it still shows the class a face, rather than an edge.
      expect(best, `d${sides} rests on an edge`).toBeGreaterThan(0.6);
    }
  });

  it("is a unit quaternion", () => {
    const { x, y, z, w } = IDLE_TILT;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });

  it("is a real rotation, not the identity in disguise", () => {
    // A tilt that had been normalised down to nothing would pass every other
    // assertion here by accident.
    const turned = qRotate(IDLE_TILT, v3(0, 0, 1));
    expect(vDot(turned, v3(0, 0, 1))).toBeLessThan(0.95);
  });
});

describe("REST_TILT", () => {
  it("never promotes a neighbouring face to «up», for any body and value", () => {
    // The whole licence for tilting the resting die: the smallest angle
    // between two face normals is the d20's 41.8°, far beyond the ~17°
    // combined tilt — so the face the class should read stays the face
    // pointing at them. Checked exhaustively, not trusted.
    for (const sides of FACE_OPTIONS) {
      const solid = solidFor(sides);
      for (const face of solid.f) {
        const q = restOrientationForValue(solid, face.value);
        let best = -1;
        let bestDot = -Infinity;
        for (const g of solid.f) {
          const { z: nz } = qRotate(q, g.n);
          if (nz > bestDot) {
            bestDot = nz;
            best = g.value;
          }
        }
        expect(best).toBe(face.value);
        // …and the answer still faces the class almost squarely.
        expect(bestDot).toBeGreaterThan(0.94);
      }
    }
  });
});
