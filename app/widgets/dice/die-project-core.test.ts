import { describe, expect, it } from "vitest";

import { PIP_FACES } from "./dice-core";
import {
  orientationForFace,
  orientationForValue,
  qAxisAngle,
  qNormalize,
  qRotate,
  QUAT_IDENTITY,
  type Quat,
} from "./die-orient-core";
import {
  SOLID_SIDES,
  solidFor,
  v3,
  vCross,
  vDot,
  vLen,
  vUnit,
  type Solid,
  type Vec3,
} from "./die-solids-core";
import {
  AMB,
  CAM_D,
  EDGE_PAD,
  FOCAL,
  fmt,
  GRID,
  lambert,
  LABEL_EM,
  MARK_MIN_FACING,
  matrixAttr,
  PIP_R,
  projectDie,
  toGrid,
  toneFor,
  TONES,
  type DieView,
} from "./die-project-core";

type Pt = [number, number];

/** Repeatable orientations. `Math.random` here would mean a failure nobody
 *  can reproduce — and this file's whole job is a claim about ALL of them. */
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

/** The rotation that turns `v` to face the camera — how a die is held when it
 *  is resting on a corner. */
function cornerOn(v: Vec3): Quat {
  const axis = vCross(v, v3(0, 0, 1));
  const len = vLen(axis);
  if (len < 1e-12) {
    return v.z > 0 ? QUAT_IDENTITY : qAxisAngle(v3(1, 0, 0), Math.PI);
  }
  return qAxisAngle(axis, Math.atan2(len, vDot(v, v3(0, 0, 1))));
}

function parsePoints(points: string): Pt[] {
  return points
    .split(" ")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as Pt);
}

function parsePath(d: string): Pt[] {
  return d
    .replace(/^M/, "")
    .replace(/Z$/, "")
    .split("L")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as Pt);
}

/** Crossing number — winding-agnostic, which matters because the y-flip
 *  reverses every front face's order on the way to SVG. */
function inside(poly: Pt[], px: number, py: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

function edgeGap(poly: Pt[], px: number, py: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (xi + dx * t), py - (yi + dy * t)));
  }
  return best;
}

function frontFaces(view: DieView): number {
  return view.faces.filter((f) => f.front).length;
}

const all = SOLID_SIDES.map(solidFor);

describe("the camera", () => {
  it("is scaled so the WIDEST orientation exactly touches EDGE_PAD", () => {
    // The whole fit argument in one line. `f/√(d²−1)` is the largest radius a
    // point on the unit sphere can project to, over every orientation, and it
    // is set to the half-grid minus the pad. Nothing is left over.
    expect(FOCAL / Math.sqrt(CAM_D * CAM_D - 1)).toBeCloseTo(
      GRID / 2 - EDGE_PAD,
      12,
    );
  });

  it("puts the origin at the middle and flips y exactly once", () => {
    expect(toGrid(v3(0, 0, 0))).toEqual({ x: 50, y: 50 });
    // Up in the room is UP on the card, which in SVG means a smaller y.
    expect(toGrid(v3(0, 0.5, 0)).y).toBeLessThan(50);
    expect(toGrid(v3(0.5, 0, 0)).x).toBeGreaterThan(50);
    // Nearer is bigger — that is the perspective doing its job.
    expect(toGrid(v3(0.5, 0, 0.5)).x).toBeGreaterThan(
      toGrid(v3(0.5, 0, -0.5)).x,
    );
  });

  it("keeps every body inside the grid, at 2000 orientations each", () => {
    // 12 000 orientations against a closed-form bound. If a vertex ever
    // projected past 47.5 the die would be clipped by the card at exactly one
    // angle — the failure that only ever happens in front of a class.
    const rand = seeded(1907);
    let widest = 0;
    for (const solid of all) {
      for (let i = 0; i < 2000; i++) {
        const q = randomQuat(rand);
        for (const vertex of solid.v) {
          const g = toGrid(qRotate(q, vertex));
          widest = Math.max(widest, Math.hypot(g.x - 50, g.y - 50));
        }
      }
    }
    expect(widest).toBeLessThanOrEqual(GRID / 2 - EDGE_PAD + 1e-12);
    // …and the bound is TIGHT: a slacker camera would pass the line above
    // while drawing a needlessly small die, so the sample has to get there.
    expect(widest).toBeGreaterThan(GRID / 2 - EDGE_PAD - 1e-6);
  });

  it("emits nothing outside [EDGE_PAD, GRID − EDGE_PAD]", () => {
    const rand = seeded(4242);
    for (const solid of all) {
      for (let i = 0; i < 120; i++) {
        const view = projectDie(solid, randomQuat(rand));
        const coords = [
          ...view.faces.flatMap((f) => parsePoints(f.points).flat()),
          ...parsePath(view.silhouette).flat(),
        ];
        expect(coords.length).toBeGreaterThan(0);
        for (const value of coords) {
          expect(Number.isFinite(value)).toBe(true);
          // The emitted strings are rounded to hundredths, so the bound gets
          // exactly that much slack and not a unit more.
          expect(value).toBeGreaterThanOrEqual(EDGE_PAD - 0.005);
          expect(value).toBeLessThanOrEqual(GRID - EDGE_PAD + 0.005);
        }
      }
    }
  });
});

describe("culling", () => {
  it("shows the pinned number of faces, face-on and corner-on", () => {
    // These counts ARE the perspective. Under orthography a d20 corner-on
    // would show ten faces; the camera at 4R culls the five grazing ones, and
    // that is what makes the body read as solid rather than as a wireframe
    // flattened onto the card.
    const faceOn = all.map((s) =>
      frontFaces(projectDie(s, orientationForFace(s, 0))),
    );
    expect(faceOn).toEqual([1, 1, 4, 3, 6, 10]);
    // ⚠️ The d10's 3 is not a near miss. Its four equatorial faces are
    // EXACTLY perpendicular to the front face's normal — a closed-form
    // consequence of the trapezohedron's shape (tan²α = 1/cos 36°) — so they
    // land dead on the horizon and the camera culls them cleanly.
    const corner = all.map((s) => frontFaces(projectDie(s, cornerOn(s.v[0]))));
    expect(corner).toEqual([3, 3, 4, 5, 3, 5]);
  });

  it("tiles the silhouette exactly once — complete, exclusive, no overlap", () => {
    // The licence for drawing front faces in table order with no depth sort.
    // A point inside the outline belongs to exactly ONE face; a point outside
    // belongs to none. Sampled rather than argued, because "the body is
    // convex so it must be fine" is exactly the reasoning that hides an
    // inverted normal.
    const rand = seeded(88);
    for (const solid of all) {
      for (let trial = 0; trial < 12; trial++) {
        const view = projectDie(solid, randomQuat(rand));
        const outline = parsePath(view.silhouette);
        const polys = view.faces
          .filter((f) => f.front)
          .map((f) => parsePoints(f.points));
        expect(polys.length).toBeGreaterThan(0);
        for (let px = 4; px < GRID; px += 3) {
          for (let py = 4; py < GRID; py += 3) {
            // Skip anything sitting on a seam: a sample exactly on an edge is
            // in both faces or neither, and that is a fact about sampling,
            // not about the geometry.
            if (polys.some((p) => edgeGap(p, px, py) < 0.4)) continue;
            if (edgeGap(outline, px, py) < 0.4) continue;
            const hits = polys.filter((p) => inside(p, px, py)).length;
            expect(hits).toBe(inside(outline, px, py) ? 1 : 0);
          }
        }
      }
    }
  });

  it("draws the silhouette as ONE closed loop around everything visible", () => {
    // Without an outline the die loses its edge against a card of the same
    // tone. A loop that dropped a segment would still LOOK like a die most of
    // the time, so the shape is checked rather than its presence.
    const rand = seeded(313);
    for (const solid of all) {
      for (let trial = 0; trial < 20; trial++) {
        const view = projectDie(solid, randomQuat(rand));
        expect(view.silhouette.startsWith("M")).toBe(true);
        expect(view.silhouette.endsWith("Z")).toBe(true);
        const outline = parsePath(view.silhouette);
        expect(outline.length).toBeGreaterThanOrEqual(3);
        // no repeated vertex — a figure-eight would be a chaining bug
        const unique = new Set(outline.map(([x, y]) => `${x},${y}`));
        expect(unique.size).toBe(outline.length);
        for (const face of view.faces) {
          if (!face.front) continue;
          for (const [px, py] of parsePoints(face.points)) {
            const onEdge = edgeGap(outline, px, py) < 1e-6;
            expect(onEdge || inside(outline, px, py)).toBe(true);
          }
        }
      }
    }
  });

  it("always has an UP face, and it carries what the class reads", () => {
    const rand = seeded(555);
    for (const solid of all) {
      for (let i = 0; i < 60; i++) {
        const view = projectDie(solid, randomQuat(rand));
        expect(view.faces[view.up].front).toBe(true);
        expect(view.upValue).toBe(view.faces[view.up].value);
        if (solid.sides === PIP_FACES) {
          expect(view.faces[view.up].label).toBeNull();
          expect(view.faces[view.up].pips).toHaveLength(view.upValue);
        } else {
          // A numeral face turned to the class ALWAYS has its matrix — the
          // readability guarantee the e2e suite measures in pixels.
          expect(view.faces[view.up].label).not.toBeNull();
        }
      }
    }
  });

  it("shows the face a roll landed on", () => {
    for (const solid of all) {
      for (let value = 1; value <= solid.sides; value++) {
        const view = projectDie(solid, orientationForValue(solid, value));
        expect(view.upValue).toBe(value);
      }
    }
  });
});

describe("the numeral", () => {
  it("keeps its em-box on the face — one and two digits, 200 orientations", () => {
    // The matrix is built from three projected points, so a sign error there
    // puts the numeral beside the face rather than on it, at an angle nobody
    // would call a bug until they saw a «17» hanging in the air.
    const rand = seeded(2026);
    const halfWidth = (digits: number) => (digits * 0.6 * LABEL_EM) / 2;
    for (const solid of all.filter((s) => s.sides !== PIP_FACES)) {
      for (let i = 0; i < 200; i++) {
        const view = projectDie(solid, randomQuat(rand));
        view.faces.forEach((paint, fi) => {
          if (!paint.front || !paint.label) return;
          const poly = parsePoints(paint.points);
          const [a, b, c, d, e, f] = paint.label;
          const hw = halfWidth(String(paint.value).length);
          const hh = LABEL_EM / 2;
          for (const [lx, ly] of [
            [-hw, -hh],
            [hw, -hh],
            [hw, hh],
            [-hw, hh],
          ]) {
            const px = a * lx + c * ly + e;
            const py = b * lx + d * ly + f;
            expect(
              inside(poly, px, py),
              `d${solid.sides} face ${fi} value ${paint.value}`,
            ).toBe(true);
          }
        });
      }
    }
  });

  it("comes out with NO negation when the face is square to the class", () => {
    // The payoff for storing `w` pointing DOWN and flipping y exactly once:
    // the matrix of a face-on numeral is a POSITIVE multiple of the identity,
    // translated to the face's own centre. Any minus sign here would mean a
    // sign got quietly fixed somewhere else instead.
    for (const solid of all.filter((s) => s.sides !== PIP_FACES)) {
      const q = orientationForFace(solid, 0);
      const view = projectDie(solid, q);
      const m = view.faces[0].label!;
      expect(m[0]).toBeGreaterThan(0);
      expect(m[3]).toBeGreaterThan(0);
      expect(m[0]).toBeCloseTo(m[3], 12);
      expect(m[1]).toBeCloseTo(0, 12);
      expect(m[2]).toBeCloseTo(0, 12);
      // The translation is the face's own centre, projected — which for the
      // d10 is NOT the middle of the card: a kite's centre does not sit on
      // the body's axis, so a trapezohedron held face-on genuinely shows its
      // number off to one side. That is what a d10 looks like.
      const centre = toGrid(qRotate(q, solid.f[0].c));
      expect(m[4]).toBeCloseTo(centre.x, 9);
      expect(m[5]).toBeCloseTo(centre.y, 9);
      if (solid.sides !== 10) {
        expect(m[4]).toBeCloseTo(50, 9);
        expect(m[5]).toBeCloseTo(50, 9);
      }
    }
  });

  it("withholds the mark from a face too edge-on to read it", () => {
    // The affine matrix and the perspective the face is drawn with agree to
    // first order and drift apart as the face grazes; past the gate the
    // numeral would leave its own face. `facing` is published so the renderer
    // can fade rather than pop.
    const solid = solidFor(20);
    const rand = seeded(1234);
    let gated = 0;
    for (let i = 0; i < 200; i++) {
      const view = projectDie(solid, randomQuat(rand));
      for (const paint of view.faces) {
        if (!paint.front) continue;
        expect(paint.label !== null).toBe(paint.facing >= MARK_MIN_FACING);
        if (paint.label === null) gated++;
      }
    }
    // …and the gate really does bite, so «label follows facing» is not
    // vacuously true of a threshold nothing ever crosses.
    expect(gated).toBeGreaterThan(50);
  });

  it("still marks the UP face on every body, at every orientation", () => {
    // The gate must never take the number the class is reading. The binding
    // case is the d4: held on a corner its best face is only 1/3 square to
    // the room, which is why `MARK_MIN_FACING` is 0.3 and not 0.35.
    expect(MARK_MIN_FACING).toBeLessThan(1 / 3);
    const rand = seeded(4711);
    for (const solid of all) {
      let worst = Infinity;
      for (let i = 0; i < 500; i++) {
        const view = projectDie(solid, randomQuat(rand));
        const paint = view.faces[view.up];
        worst = Math.min(worst, paint.facing);
        expect(paint.facing).toBeGreaterThanOrEqual(MARK_MIN_FACING);
        if (solid.sides === PIP_FACES) {
          expect(paint.pips).toHaveLength(paint.value);
        } else {
          expect(paint.label).not.toBeNull();
        }
      }
      // The tetrahedron really is the tight one; nothing else comes close.
      if (solid.sides === 4) expect(worst).toBeLessThan(0.4);
    }
  });

  it("is null on a pip face and on a face turned away", () => {
    const view = projectDie(solidFor(PIP_FACES), QUAT_IDENTITY);
    for (const paint of view.faces) expect(paint.label).toBeNull();
    const d20 = projectDie(solidFor(20), QUAT_IDENTITY);
    for (const paint of d20.faces) {
      if (!paint.front) {
        expect(paint.label).toBeNull();
        expect(paint.pips).toHaveLength(0);
      }
    }
  });
});

describe("the pips", () => {
  it("keeps every pip on its face, with room for its radius", () => {
    const rand = seeded(606);
    const solid = solidFor(PIP_FACES);
    for (let i = 0; i < 200; i++) {
      const view = projectDie(solid, randomQuat(rand));
      view.faces.forEach((paint) => {
        if (!paint.front || paint.facing < MARK_MIN_FACING) {
          if (!paint.front) expect(paint.pips).toHaveLength(0);
          return;
        }
        expect(paint.pips).toHaveLength(paint.value);
        const poly = parsePoints(paint.points);
        for (const [cx, cy, r] of paint.pips) {
          expect(r).toBeGreaterThan(0);
          expect(inside(poly, cx, cy)).toBe(true);
          expect(edgeGap(poly, cx, cy)).toBeGreaterThan(r);
        }
      });
    }
  });

  it("shrinks the pips as the face turns away, without a single bump", () => {
    // The stand-in for drawing ellipses has to be MONOTONE or a spinning d6
    // visibly pulses. This is also where the area-preserving mean fails: it
    // RISES for the first few degrees, because a three-point estimate on a
    // tilted face is a secant across a curve that bends away from you. The
    // minor axis has no such bump.
    const solid = solidFor(PIP_FACES);
    let previous = Infinity;
    let steps = 0;
    for (let deg = 0; deg <= 70; deg += 5) {
      const view = projectDie(
        solid,
        qAxisAngle(v3(1, 0, 0), (deg * Math.PI) / 180),
      );
      const r = view.faces[0].pips[0][2];
      expect(r, `${deg}°`).toBeLessThan(previous);
      previous = r;
      steps++;
    }
    expect(steps).toBe(15);
    // …and it really did shrink by a visible amount, so «monotone» is not
    // trivially true of a constant.
    expect(previous).toBeLessThan(PIP_R * 0.2);
    // Square to the class, the minor axis IS the area mean — no cost where
    // the die spends its life.
    const flat = projectDie(solid, QUAT_IDENTITY).faces[0].pips[0][2];
    const face = solidFor(PIP_FACES).f[0];
    const k = FOCAL / (CAM_D - face.inr);
    expect(flat).toBeCloseTo((PIP_R / 50) * face.inr * k, 9);
  });
});

describe("the shading", () => {
  it("uses exactly TONES steps, all of them reachable", () => {
    const rand = seeded(9001);
    const seen = new Set<number>();
    for (const solid of all) {
      for (let i = 0; i < 400; i++) {
        for (const paint of projectDie(solid, randomQuat(rand)).faces) {
          if (paint.front) seen.add(paint.tone);
        }
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(seen.size).toBe(TONES);
  });

  it("is brightest straight at the light and monotone in between", () => {
    // Quantising is only defensible if it never inverts: a face turned FURTHER
    // from the light must never come out lighter.
    const light = vUnit(v3(-1, 1, 1));
    expect(toneFor(light)).toBe(TONES - 1);
    expect(toneFor(v3(-light.x, -light.y, -light.z))).toBe(0);
    expect(lambert(light)).toBeCloseTo(1, 12);
    expect(lambert(v3(-light.x, -light.y, -light.z))).toBeCloseTo(AMB, 12);
    const rand = seeded(77);
    const samples = Array.from({ length: 400 }, () => {
      const n = vUnit(v3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1));
      return { dot: vDot(n, light), tone: toneFor(n) };
    }).sort((a, b) => a.dot - b.dot);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].tone).toBeGreaterThanOrEqual(samples[i - 1].tone);
    }
  });

  it("is an INDEX, never a colour", () => {
    const view = projectDie(solidFor(20), QUAT_IDENTITY);
    for (const paint of view.faces) {
      expect(Number.isInteger(paint.tone)).toBe(true);
      expect(paint.tone).toBeGreaterThanOrEqual(0);
      expect(paint.tone).toBeLessThan(TONES);
    }
  });
});

describe("the emitted strings", () => {
  it("never contains a negative zero", () => {
    // `-0` is invisible on screen, legal in SVG, and enough to make a
    // string-equality test fail for a reason that takes an hour to find.
    expect(fmt(-0)).toBe("0");
    expect(fmt(-0.001)).toBe("0");
    expect(fmt(0)).toBe("0");
    expect(fmt(-0.00001, 4)).toBe("0");
    expect(fmt(NaN)).toBe("0");
    expect(fmt(Infinity)).toBe("0");
    // …and the guard is load-bearing: without it this very number prints
    // «-0».
    expect((-0.001).toFixed(2)).toBe("-0.00");

    const rand = seeded(31337);
    let tokens = 0;
    for (const solid of all) {
      for (let i = 0; i < 120; i++) {
        const view = projectDie(solid, randomQuat(rand));
        const emitted = [
          view.silhouette,
          ...view.faces.map((f) => f.points),
          ...view.faces.filter((f) => f.label).map((f) => matrixAttr(f.label!)),
        ].join(" ");
        expect(emitted).not.toContain("NaN");
        for (const token of emitted.match(/-?\d+(\.\d+)?/g) ?? []) {
          tokens++;
          // `-0.0065` is a perfectly good number; `-0` and `-0.00` are not.
          expect(token).not.toMatch(/^-0(\.0+)?$/);
        }
      }
    }
    // The scan found something to scan — an empty parse must not read green.
    expect(tokens).toBeGreaterThan(10_000);
  });

  it("formats a matrix with enough digits to place a numeral", () => {
    const m = [0.348412, -0.000001, 0, 0.348412, 50, 50];
    expect(matrixAttr(m)).toBe("matrix(0.3484,0,0,0.3484,50,50)");
  });
});

describe("projectDie — the scratch view", () => {
  it("writes into the caller's view instead of allocating a new one", () => {
    // Six dice at 60 fps: a fresh view per frame is a sawtooth of collections
    // in the middle of the one animation the whole class is watching.
    const solid = solidFor(20);
    const first = projectDie(solid, QUAT_IDENTITY);
    const faceObject = first.faces[0];
    const again = projectDie(solid, qAxisAngle(v3(0, 1, 0), 0.7), first);
    expect(again).toBe(first);
    expect(again.faces[0]).toBe(faceObject);
    expect(again.faces).toHaveLength(solid.f.length);
  });

  it("refuses a scratch view built for a different body", () => {
    // The teacher pressed D20 → D6 between frames. Reusing twenty face slots
    // for six faces would leave fourteen stale polygons on the card.
    const d20 = projectDie(solidFor(20), QUAT_IDENTITY);
    const d6 = projectDie(solidFor(6), QUAT_IDENTITY, d20);
    expect(d6).not.toBe(d20);
    expect(d6.faces).toHaveLength(6);
    expect(d6.sides).toBe(6);
  });

  it("keeps one paint slot per face, for ever", () => {
    for (const solid of all) {
      const view = projectDie(solid, QUAT_IDENTITY);
      expect(view.faces).toHaveLength(solid.f.length);
      view.faces.forEach((paint, i) =>
        expect(paint.value).toBe(solid.f[i].value),
      );
    }
  });

  it("survives a degenerate orientation without emitting NaN", () => {
    for (const q of [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: NaN, y: 0, z: 0, w: 1 },
    ] as Quat[]) {
      const view = projectDie(solidFor(20), q);
      expect(view.silhouette).not.toContain("NaN");
      for (const paint of view.faces) expect(paint.points).not.toContain("NaN");
    }
  });
});

/** Named so the drift is visible: the projection reads `PIPS` out of
 *  `dice-core`, which is the only thing this whole engine borrows from the
 *  flat die it replaces. */
describe("what is inherited from the flat die", () => {
  it("draws d6 pips at the same face coordinates as before", () => {
    const solid: Solid = solidFor(PIP_FACES);
    const view = projectDie(solid, orientationForFace(solid, 0));
    // Face-on, the face's 100-grid maps onto the projected square, so the
    // single pip of a «1» is dead centre.
    expect(view.faces[0].pips[0][0]).toBeCloseTo(50, 9);
    expect(view.faces[0].pips[0][1]).toBeCloseTo(50, 9);
  });
});
