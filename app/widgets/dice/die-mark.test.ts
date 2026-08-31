// THE SECOND PIP LAYOUT, held against the first.
//
// `projectDie` lays out the pips a d6 face actually carries. `pipsForValue`
// lays out the pips for a value the face does NOT carry — which the renderer
// needs for exactly one journey: the reduced-motion roll, where the body
// stands still and the number on the front face scrambles in place.
//
// Two pieces of arithmetic doing the same thing in two files is the shape a
// SEAM BUG comes in (reference-seam-bugs): each half correct, the two
// disagreeing in the middle, and both green. This file is the seam. It asks
// the only question that catches that class of failure — «given the SAME
// input, do the two agree?» — rather than asking each of them whether it is
// happy with itself.

import { describe, expect, it } from "vitest";

import { PIPS, PIP_FACES } from "./dice-core";
import { pipsForValue } from "./DiceWidget";
import {
  orientationForFace,
  qNormalize,
  qRotate,
  type Quat,
} from "./die-orient-core";
import { PIP_R, projectDie, toGrid } from "./die-project-core";
import { solidFor } from "./die-solids-core";

const cube = solidFor(PIP_FACES);

/** A deterministic stream — the same one the projection tests use, so a
 *  failure here can be reproduced there. */
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

/** Is `(x, y)` inside the polygon? Ray casting, the same as the projection
 *  suite's — the pip has to land ON the face, whatever else is true. */
function inside(points: string, x: number, y: number): boolean {
  const ring = points
    .split(" ")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi
    ) {
      hit = !hit;
    }
  }
  return hit;
}

describe("pipsForValue agrees with the projection", () => {
  it("places the face's OWN value exactly where projectDie does", () => {
    // Positions, for every orientation — these do not depend on the radius,
    // so the agreement here is exact rather than approximate.
    const rand = seeded(31337);
    for (let i = 0; i < 120; i++) {
      const q = randomQuat(rand);
      const view = projectDie(cube, q);
      view.faces.forEach((paint, fi) => {
        if (paint.pips.length === 0) return;
        const mine = pipsForValue(cube, fi, q, paint.value);
        expect(mine.length, `face ${fi}`).toBe(paint.pips.length);
        mine.forEach((spot, k) => {
          expect(spot[0]).toBeCloseTo(paint.pips[k][0], 9);
          expect(spot[1]).toBeCloseTo(paint.pips[k][1], 9);
        });
      });
    }
  });

  it("agrees on the RADIUS at ANY orientation, not merely square-on", () => {
    // ⚠️ This test used to run on `orientationForFace` alone, because the
    // docstring next door promised the scramble «only ever runs on a die at
    // REST, square to the class». It does not (R5-funn M1): under reduced
    // motion the trackball still follows the finger 1:1, and `roll()` then
    // takes a branch that never touches `orient.current` — so the scramble
    // routinely runs on a hand-spun body. On such a body the old shortcut
    // (the projected u-axis instead of the ellipse's minor axis) drew pips
    // up to 1.84× too fat.
    //
    // Both ends now call `pipRadius`, which is why the tolerance is a
    // RELATIVE 1e-12 and not a `toBeCloseTo`: same formula, same inputs, so
    // anything above float dust means the two have been re-derived apart
    // again.
    const rand = seeded(90210);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const q = randomQuat(rand);
      const view = projectDie(cube, q);
      view.faces.forEach((paint, fi) => {
        if (paint.pips.length === 0) return;
        const mine = pipsForValue(cube, fi, q, paint.value);
        mine.forEach((spot, k) => {
          const theirs = paint.pips[k][2];
          expect(theirs).toBeGreaterThan(0);
          expect(
            Math.abs(spot[2] - theirs) / theirs,
            `face ${fi}, pip ${k}`,
          ).toBeLessThan(1e-12);
          checked++;
        });
      });
    }
    // …on a real sample, not on an empty loop that agrees vacuously.
    expect(checked).toBeGreaterThan(2000);
  });

  it("and it is a real radius, not a collapsed one, square-on", () => {
    for (let face = 0; face < cube.f.length; face++) {
      const q = orientationForFace(cube, face);
      const view = projectDie(cube, q);
      expect(view.up).toBe(face);
      const mine = pipsForValue(cube, view.up, q, view.upValue);
      expect(mine[0][2]).toBeGreaterThan(PIP_R / 4);
    }
  });

  it("the discarded shortcut really does disagree, and by a lot", () => {
    // The receipt for the test above. A seam test whose two ends happen to
    // agree everywhere proves nothing about the seam, so this measures how
    // far apart the OLD derivation and the renderer actually get: if the
    // answer were «a rounding error», the fix would have been cosmetic and
    // the tolerance above would be defending nothing.
    //
    // The review measured 1.84× over the orientations a HAND-SPUN die
    // actually reaches; over uniform random ones, which include faces almost
    // edge-on to the class, this loop finds 6.74×. The floor below is the
    // conservative of the two — the point is the order of magnitude.
    let worst = 1;
    const rand = seeded(4242);
    for (let i = 0; i < 400; i++) {
      const q = randomQuat(rand);
      const view = projectDie(cube, q);
      view.faces.forEach((paint, fi) => {
        if (paint.pips.length === 0) return;
        const face = cube.f[fi];
        const c = qRotate(q, face.c);
        const u = qRotate(q, face.u);
        const origin = toGrid(c);
        const along = toGrid({
          x: c.x + u.x * face.inr,
          y: c.y + u.y * face.inr,
          z: c.z + u.z * face.inr,
        });
        // What `pipsForValue` used to return: the projected u-axis, which is
        // the ellipse's radius in ONE direction and its major axis whenever
        // the face is tilted about that same axis.
        const old =
          (PIP_R * Math.hypot(along.x - origin.x, along.y - origin.y)) / 50;
        worst = Math.max(worst, old / paint.pips[0][2]);
      });
    }
    expect(worst).toBeGreaterThan(1.8);
  });
});

describe("a scrambled value still lands on the face", () => {
  it("every value 1..6, on the face turned to the class", () => {
    // What the reduced-motion scramble actually asks for: a value the body is
    // NOT holding, drawn on the face the class is looking at. A pip that fell
    // outside its face would be a dot floating beside the die.
    for (let face = 0; face < cube.f.length; face++) {
      const q = orientationForFace(cube, face);
      const view = projectDie(cube, q);
      const polygon = view.faces[view.up].points;
      for (let value = 1; value <= PIP_FACES; value++) {
        const spots = pipsForValue(cube, view.up, q, value);
        expect(spots.length, `value ${value}`).toBe(PIPS[value].length);
        for (const [x, y, r] of spots) {
          // The pip's own extent, not just its centre — four points on its
          // rim, which is what «inside the face» has to mean for a circle.
          for (const [dx, dy] of [
            [r, 0],
            [-r, 0],
            [0, r],
            [0, -r],
          ]) {
            expect(
              inside(polygon, x + dx, y + dy),
              `d6 face ${face}, value ${value} at (${x}, ${y})`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("an unknown value draws nothing rather than throwing", () => {
    // A config from a newer build could name a d6 value this table has never
    // heard of. Nothing on the face is honest; a crash mid-lesson is not.
    expect(pipsForValue(cube, 0, orientationForFace(cube, 0), 9)).toEqual([]);
  });
});
