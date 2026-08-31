import { describe, expect, it } from "vitest";

import {
  frameAt,
  LANDING_FRACTION,
  simulateThrow,
  THROW_STEP_MS,
  type DieFrame,
  type ThrowSpec,
} from "./dice-physics-core";

/** A three-die throw in a card-sized box, with the dice in a row like the
 *  flex layout actually puts them. */
function spec(over: Partial<ThrowSpec> = {}): ThrowSpec {
  return {
    box: { w: 300, h: 240 },
    rest: [
      { x: 20, y: 80 },
      { x: 110, y: 80 },
      { x: 200, y: 80 },
    ],
    dieSize: 80,
    durationMs: 1100,
    seed: [1, 2, 3],
    ...over,
  };
}

/** Every (frame, die) pair, with the die's resting slot alongside. */
function walk(
  s: ThrowSpec,
  frames: DieFrame[][],
  visit: (frame: DieFrame, rest: { x: number; y: number }, i: number) => void,
): void {
  for (const row of frames) {
    row.forEach((frame, i) => visit(frame, s.rest[i], i));
  }
}

describe("simulateThrow", () => {
  it("never puts a die outside the box — in any frame, for any seed", () => {
    // The invariant a projector cares about: a die that leaves the card is
    // either clipped or printed over the neighbouring widget.
    for (const seed of [
      [1, 2, 3],
      [999, 12345, 7],
      [0, 0, 0],
      [0xffffffff, 0x7fffffff, 42],
    ]) {
      const s = spec({ seed });
      const frames = simulateThrow(s);
      const maxX = s.box.w - s.dieSize;
      const maxY = s.box.h - s.dieSize;
      walk(s, frames, (frame, rest) => {
        const x = rest.x + frame.dx;
        const y = rest.y + frame.dy;
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(maxX + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(maxY + 1e-9);
      });
    }
  });

  it("leaves room for the spin: a tumbling die never pokes through a wall", () => {
    // The containment check above measures the die's UPRIGHT box. A square
    // spinning at 45° is √2 times as wide, so a face flat against the wall
    // would have a corner sliced off by the card's `overflow: hidden` — the
    // exact failure a unit test cannot see and a projector shows to a whole
    // class. The free-flight range is inset by that overhang.
    const s = spec();
    const frames = simulateThrow(s);
    const pad = (s.dieSize * (Math.SQRT2 - 1)) / 2;
    const maxX = s.box.w - s.dieSize;
    const maxY = s.box.h - s.dieSize;
    const lastFreeFrame = Math.floor(
      (frames.length - 1) * (1 - LANDING_FRACTION),
    );
    expect(pad).toBeGreaterThan(0);
    for (let i = 0; i <= lastFreeFrame; i++) {
      frames[i].forEach((frame, die) => {
        const x = s.rest[die].x + frame.dx;
        const y = s.rest[die].y + frame.dy;
        expect(x).toBeGreaterThanOrEqual(pad - 1e-9);
        expect(x).toBeLessThanOrEqual(maxX - pad + 1e-9);
        expect(y).toBeGreaterThanOrEqual(pad - 1e-9);
        expect(y).toBeLessThanOrEqual(maxY - pad + 1e-9);
      });
    }
  });

  it("lands EXACTLY on the resting slot, with no rotation left", () => {
    // Not «close enough»: the component clears the transform when the throw
    // ends, so anything but an exact zero here is a visible jump at the very
    // moment the class is looking at the answer.
    const frames = simulateThrow(spec());
    for (const frame of frames[frames.length - 1]) {
      expect(frame.dx).toBe(0);
      expect(frame.dy).toBe(0);
      expect(frame.rot).toBe(0);
    }
  });

  it("actually flies — the middle of the throw is nowhere near home", () => {
    // The containment and landing invariants are both satisfied by a die that
    // never moves at all, so the interesting half has to be asserted too.
    const frames = simulateThrow(spec());
    const travelled = frames.map((row) =>
      Math.max(...row.map((f) => Math.hypot(f.dx, f.dy))),
    );
    expect(Math.max(...travelled)).toBeGreaterThan(60);
    const spun = Math.max(
      ...frames.map((row) => Math.max(...row.map((f) => Math.abs(f.rot)))),
    );
    expect(spun).toBeGreaterThan(180);
  });

  it("bounces: a die reverses direction inside the box", () => {
    // Without a wall the die would sail out and the containment clamp alone
    // would flatten it against the edge — which also passes the box check.
    // A genuine bounce shows up as a sign change in the step-to-step delta
    // while the die is nowhere near the clamp.
    const s = spec({ seed: [7, 7, 7] });
    const frames = simulateThrow(s);
    let reversals = 0;
    let previous = frames[0][0].dx;
    let direction = 0;
    for (const row of frames.slice(1)) {
      const delta = row[0].dx - previous;
      previous = row[0].dx;
      if (Math.abs(delta) < 1e-6) continue;
      const next = Math.sign(delta);
      if (direction !== 0 && next !== direction) reversals++;
      direction = next;
    }
    expect(reversals).toBeGreaterThanOrEqual(2);
  });

  it("loses energy: speed never increases, from launch to rest", () => {
    // Friction every step, damping at every wall, and nothing that adds
    // energy — so a sign error in the bounce shows up here as a die that
    // speeds up.
    const s = spec();
    const frames = simulateThrow(s);
    for (let die = 0; die < s.rest.length; die++) {
      let previous = Infinity;
      for (const row of frames) {
        expect(row[die].speed).toBeLessThanOrEqual(previous + 1e-9);
        previous = row[die].speed;
      }
    }
    // …and it really did start moving, so «monotone» is not trivially true.
    expect(frames[0][0].speed).toBeGreaterThan(0);
    expect(frames[frames.length - 1][0].speed).toBeLessThan(frames[0][0].speed);
  });

  it("is deterministic: the same seeds give the same throw", () => {
    expect(simulateThrow(spec())).toEqual(simulateThrow(spec()));
    expect(simulateThrow(spec({ seed: [4, 5, 6] }))).not.toEqual(
      simulateThrow(spec()),
    );
  });

  it("gives the three dice DIFFERENT flights", () => {
    // One seed per die, not one per throw: three dice moving as a rigid block
    // is the tell that the seeding collapsed.
    const frames = simulateThrow(spec());
    const middle = frames[Math.floor(frames.length / 2)];
    expect(middle[0].dx).not.toBeCloseTo(middle[1].dx, 3);
    expect(middle[1].dx).not.toBeCloseTo(middle[2].dx, 3);
  });

  it("survives a degenerate box without producing NaN", () => {
    // Called once before layout, or on a card shrunk to nothing. Every number
    // has to stay finite — a NaN reaches the DOM as a dropped transform and
    // the die simply vanishes.
    const cases: ThrowSpec[] = [
      spec({ box: { w: 0, h: 0 }, rest: [{ x: 0, y: 0 }], seed: [1] }),
      spec({ dieSize: 0 }),
      spec({ dieSize: 400 }), // die larger than the box
      spec({ durationMs: 0 }),
      spec({ box: { w: NaN, h: Infinity }, dieSize: NaN, durationMs: NaN }),
      spec({ rest: [], seed: [] }),
      spec({ rest: [{ x: NaN, y: -500 }], seed: [NaN] }),
    ];
    for (const s of cases) {
      const frames = simulateThrow(s);
      expect(frames.length).toBeGreaterThan(0);
      for (const row of frames) {
        for (const frame of row) {
          for (const value of [frame.dx, frame.dy, frame.rot, frame.speed]) {
            expect(Number.isFinite(value)).toBe(true);
          }
        }
      }
      // The landing promise holds in the degenerate cases too.
      for (const frame of frames[frames.length - 1]) {
        expect(frame.dx).toBe(0);
        expect(frame.dy).toBe(0);
      }
    }
  });

  it("simulates only as many dice as it has BOTH a slot and a seed for", () => {
    const frames = simulateThrow(spec({ seed: [1, 2] }));
    expect(frames[0]).toHaveLength(2);
  });

  it("flies free until the landing window opens", () => {
    // The steering must not start at t=0, or the whole throw is a slow drift
    // home instead of a throw.
    const frames = simulateThrow(spec());
    const openAt = Math.floor((frames.length - 1) * (1 - LANDING_FRACTION));
    expect(
      Math.hypot(frames[openAt][0].dx, frames[openAt][0].dy),
    ).toBeGreaterThan(1);
  });
});

describe("frameAt", () => {
  it("maps elapsed time to a frame, clamped at both ends", () => {
    const frames = simulateThrow(spec());
    expect(frameAt(frames, 0)).toBe(frames[0]);
    expect(frameAt(frames, THROW_STEP_MS * 3)).toBe(frames[3]);
    // A rAF tick that arrives late — or a tab that was backgrounded — reads
    // the landing, never an index past the end.
    expect(frameAt(frames, 99_999)).toBe(frames[frames.length - 1]);
    expect(frameAt(frames, -50)).toBe(frames[0]);
    expect(frameAt(frames, NaN)).toBe(frames[0]);
    expect(frameAt([], 10)).toEqual([]);
  });
});
