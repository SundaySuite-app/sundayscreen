import { describe, expect, it } from "vitest";

import { FACE_OPTIONS, PIPS, PIP_FACES } from "./dice-core";
import {
  CORNER_SPREAD,
  FACE_VALUES,
  faceForValue,
  SOLID_SIDES,
  solidFor,
  vAdd,
  vCross,
  vDot,
  vLen,
  vScale,
  vSub,
  vUnit,
  type Solid,
  type Vec3,
} from "./die-solids-core";

/** Floating-point floor for "these two numbers came out of the same
 *  construction". Every body is built from a handful of square roots, so the
 *  real error is ~1e-16 and anything above 1e-12 is a BUG, not noise. */
const EPS = 1e-12;

const all = SOLID_SIDES.map(solidFor);

/** |a − b| as a fraction of b — the honest tolerance for a quantity whose
 *  own ulp is bigger than the absolute bound you would like to write. */
function relative(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

/** Every vertex with the faces that meet at it. */
function cornersOf(solid: Solid): number[][] {
  const at: number[][] = solid.v.map(() => []);
  solid.f.forEach((face, i) => face.v.forEach((vi) => at[vi].push(i)));
  return at;
}

/** The face whose normal is exactly opposite this one's, or −1 when the body
 *  has none (only the tetrahedron). */
function oppositeFace(solid: Solid, i: number): number {
  return solid.f.findIndex((g) => vLen(vAdd(g.n, solid.f[i].n)) < 1e-9);
}

describe("solidFor — the bodies", () => {
  it("offers a body for exactly the die types dice-core offers", () => {
    // The drift guard: a seventh type added to the ring without a body here
    // would render as an empty card, and this is the only place that notices.
    expect([...SOLID_SIDES]).toEqual([...FACE_OPTIONS]);
    expect(
      Object.keys(FACE_VALUES)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...SOLID_SIDES]);
  });

  it("snaps an off-list type to its nearest body, ties low", () => {
    // Same rule as `snapFaces`: a d100 from a newer version's config must not
    // land on a different body than the button would give it.
    expect(solidFor(7).sides).toBe(6);
    expect(solidFor(9).sides).toBe(8);
    expect(solidFor(100).sides).toBe(20);
    expect(solidFor(NaN).sides).toBe(6);
    expect(solidFor(0).sides).toBe(4);
  });

  it("memoises: the same type is the same object", () => {
    // The rAF loop asks for the body every frame. Rebuilding a d12 (1140
    // vertex triples) sixty times a second would be the whole CPU budget.
    expect(solidFor(20)).toBe(solidFor(20));
    expect(solidFor(7)).toBe(solidFor(6));
  });

  it("has the right census, and Euler agrees (V − E + F = 2)", () => {
    // Derived faces, derived edges: if the plane search dropped a face or the
    // edge map failed to close, χ is what says so.
    const census = all.map((s) => [
      s.sides,
      s.v.length,
      s.e.length,
      s.f.length,
    ]);
    expect(census).toEqual([
      [4, 4, 6, 4],
      [6, 8, 12, 6],
      [8, 6, 12, 8],
      [10, 12, 20, 10],
      [12, 20, 30, 12],
      [20, 12, 30, 20],
    ]);
    for (const s of all) {
      expect(s.v.length - s.e.length + s.f.length).toBe(2);
      expect(s.f).toHaveLength(s.sides);
    }
  });

  it("puts every vertex on the unit sphere", () => {
    // The camera fit in die-project-core is ANALYTIC — max projected radius =
    // f/√(d²−1) for a point at radius 1 — so a vertex at 1.0001 is a die that
    // pokes out of the 100-grid at exactly one angle.
    for (const s of all) {
      for (const v of s.v) expect(vLen(v)).toBeCloseTo(1, 12);
    }
  });

  it("has flat faces (< 1e-12) — including the d10's kites", () => {
    for (const s of all) {
      for (const face of s.f) {
        for (const i of face.v) {
          expect(Math.abs(vDot(face.n, vSub(s.v[i], face.c)))).toBeLessThan(
            EPS,
          );
        }
      }
    }
  });

  it("is CONVEX — the licence for culling without a z-sort", () => {
    // die-project-core draws front faces in table order and never sorts by
    // depth. That is only sound on a convex body: no vertex may lie outside
    // any face's plane. This test IS the permission slip.
    for (const s of all) {
      for (const face of s.f) {
        for (const p of s.v) {
          expect(vDot(face.n, vSub(p, face.c))).toBeLessThan(EPS);
        }
      }
    }
  });

  it("points every normal OUTWARD, and derives it from the CCW ring", () => {
    for (const s of all) {
      for (const face of s.f) {
        // n·c > 0 is "outward" for a body centred on the origin…
        expect(vDot(face.n, face.c)).toBeGreaterThan(0.3);
        expect(vLen(face.n)).toBeCloseTo(1, 12);
        // …and the ring really is counterclockwise from outside: the first
        // corner's turn agrees with the normal.
        const a = s.v[face.v[0]];
        const b = s.v[face.v[1]];
        const c = s.v[face.v[2]];
        const turn = vCross(vSub(b, a), vSub(c, b));
        expect(vDot(turn, face.n)).toBeGreaterThan(0);
      }
    }
  });

  it("gives each body congruent faces — equal area and equal inradius", () => {
    // The d10's ten kites are the interesting case: an off-by-a-ring
    // construction would still be convex and still close up, but its faces
    // would come in two sizes.
    for (const s of all) {
      const areas = s.f.map((face) => {
        let a = 0;
        for (let i = 1; i < face.v.length - 1; i++) {
          a += vLen(
            vCross(
              vSub(s.v[face.v[i]], s.v[face.v[0]]),
              vSub(s.v[face.v[i + 1]], s.v[face.v[0]]),
            ),
          );
        }
        return a / 2;
      });
      expect(Math.max(...areas) - Math.min(...areas)).toBeLessThan(EPS);
      const inrs = s.f.map((face) => face.inr);
      expect(Math.max(...inrs) - Math.min(...inrs)).toBeLessThan(EPS);
      expect(Math.min(...inrs)).toBeGreaterThan(0.3);
    }
  });

  it("gives every face a left-handed frame: u ⟂ w ⟂ n and u × n === w", () => {
    // The whole point of storing `w` rather than negating downstream. If this
    // slipped, every numeral in the app would be upside down and every test
    // that only checks the numeral is ON the face would still pass.
    for (const s of all) {
      for (const face of s.f) {
        expect(vLen(face.u)).toBeCloseTo(1, 12);
        expect(vLen(face.w)).toBeCloseTo(1, 12);
        expect(vDot(face.u, face.w)).toBeCloseTo(0, 12);
        expect(vDot(face.u, face.n)).toBeCloseTo(0, 12);
        expect(vDot(face.w, face.n)).toBeCloseTo(0, 12);
        const uxn = vCross(face.u, face.n);
        expect(vLen(vSub(uxn, face.w))).toBeLessThan(EPS);
      }
    }
  });

  it("gives the kite its own axis and lets a regular face take an edge", () => {
    // The d10 is the one body whose faces are not regular, so it is the one
    // body where `w` cannot be an arbitrary in-plane direction. Its down-axis
    // must run along the kite (through the pole vertex); every other body's
    // must sit square on an edge.
    const kite = solidFor(10).f[0];
    const s10 = solidFor(10);
    const far = kite.v.reduce((best, i) =>
      vLen(vSub(s10.v[i], kite.c)) > vLen(vSub(s10.v[best], kite.c)) ? i : best,
    );
    const axis = vUnit(vSub(s10.v[far], kite.c));
    expect(vDot(kite.w, axis)).toBeCloseTo(1, 12);

    for (const s of all.filter((x) => x.sides !== 10)) {
      const face = s.f[0];
      const mid = vScale(vAdd(s.v[face.v[0]], s.v[face.v[1]]), 0.5);
      expect(vDot(face.w, vUnit(vSub(mid, face.c)))).toBeCloseTo(1, 12);
    }
  });

  it("shares every edge between exactly two faces", () => {
    for (const s of all) {
      const seen = new Set<string>();
      for (const [a, b, fa, fb] of s.e) {
        expect(a).not.toBe(b);
        expect(fa).not.toBe(fb);
        seen.add(`${Math.min(a, b)},${Math.max(a, b)}`);
        // both named faces really contain both vertices
        for (const fi of [fa, fb]) {
          expect(s.f[fi].v).toContain(a);
          expect(s.f[fi].v).toContain(b);
        }
      }
      expect(seen.size).toBe(s.e.length);
    }
  });

  it("orders faces top-first with well-separated rings", () => {
    // The value tables are indexed by this order, so it has to be canonical
    // rather than whatever the plane search happened to emit. Two passes
    // (level, then azimuth) are only safe while the levels are far apart —
    // that is what is measured here, not assumed.
    for (const s of all) {
      const zs = s.f.map((f) => f.n.z);
      for (let i = 1; i < zs.length; i++)
        expect(zs[i]).toBeLessThan(zs[i - 1] + EPS);
      const gaps = zs
        .map((z, i) => (i === 0 ? Infinity : zs[i - 1] - z))
        .filter((g) => g > EPS);
      expect(Math.min(...gaps)).toBeGreaterThan(1e-3);
    }
    expect(solidFor(6).f[0].n.z).toBeCloseTo(1, 12);
    expect(solidFor(6).f[5].n.z).toBeCloseTo(-1, 12);
  });
});

describe("the d10 — the one body that is not Platonic", () => {
  const s = solidFor(10);

  it("holds the planarity proportion p/h = 5 + 2√5, read back off the vertices", () => {
    // The construction's whole content in one number. `h = 1 − 2/√5` is the
    // ring height that makes the kites flat; the pole sits at 1; their ratio
    // is 5 + 2√5 exactly. Measured from the CONSTRUCTED vertices, so a typo
    // anywhere in trapezohedron10 lands here rather than as a 1e-3 crack in
    // the silhouette that nobody sees on a laptop and everybody sees on a
    // projector.
    //
    // The tolerance is RELATIVE, at 1e-15. One ulp of 9.47 is 1.8e-15, so an
    // absolute 1e-15 here would be demanding better than a double can hold —
    // a bar that can only be cleared by luck is not a test.
    const pole = Math.max(...s.v.map((v) => v.z));
    const ring = Math.max(
      ...s.v.filter((v) => Math.hypot(v.x, v.y) > 0.5).map((v) => v.z),
    );
    expect(pole).toBe(1);
    expect(relative(pole / ring, 5 + 2 * Math.sqrt(5))).toBeLessThan(1e-15);
    expect(relative(ring, 1 - 2 / Math.sqrt(5))).toBeLessThan(1e-15);
    // …and the ring radius is what puts those vertices on the same sphere as
    // the poles, which is the second half of the criterion.
    const radius = Math.max(...s.v.map((v) => Math.hypot(v.x, v.y)));
    expect(relative(radius, Math.sqrt(1 - ring * ring))).toBeLessThan(1e-15);
    expect(
      relative(radius / ring, Math.sqrt((5 + 2 * Math.sqrt(5)) ** 2 - 1)),
    ).toBeLessThan(1e-15);
  });

  it("is two counter-rotated rings of five between two poles", () => {
    const poles = s.v.filter((v) => Math.hypot(v.x, v.y) < 1e-12);
    expect(poles).toHaveLength(2);
    const upper = s.v.filter((v) => v.z > 0 && v.z < 0.5);
    const lower = s.v.filter((v) => v.z < 0 && v.z > -0.5);
    expect(upper).toHaveLength(5);
    expect(lower).toHaveLength(5);
    const az = (v: Vec3) =>
      ((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360;
    expect(
      upper
        .map(az)
        .map(Math.round)
        .sort((a, b) => a - b),
    ).toEqual([0, 72, 144, 216, 288]);
    expect(
      lower
        .map(az)
        .map(Math.round)
        .sort((a, b) => a - b),
    ).toEqual([36, 108, 180, 252, 324]);
  });

  it("has ten four-cornered kites", () => {
    for (const face of s.f) expect(face.v).toHaveLength(4);
  });
});

describe("FACE_VALUES — the conventions, re-derived", () => {
  it("prints every number 1..n exactly once", () => {
    for (const s of all) {
      const values = s.f.map((f) => f.value).sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: s.sides }, (_, i) => i + 1));
      expect([...FACE_VALUES[s.sides]]).toEqual(s.f.map((f) => f.value));
    }
  });

  it("sums opposite faces to n+1 — with the d4 exempt because a tetrahedron HAS no opposite faces", () => {
    // Not a waiver: the tetrahedron is the one body here that is not centrally
    // symmetric, so each of its faces stands against a VERTEX and there is no
    // face to pair with. Asserted, so the exemption is a measurement rather
    // than a comment.
    for (const s of all) {
      const opposites = s.f.map((_, i) => oppositeFace(s, i));
      if (s.sides === 4) {
        expect(opposites).toEqual([-1, -1, -1, -1]);
        continue;
      }
      opposites.forEach((j, i) => {
        expect(j).toBeGreaterThanOrEqual(0);
        expect(s.f[i].value + s.f[j].value).toBe(s.sides + 1);
      });
    }
  });

  it("balances the corners to the pinned floor for each body", () => {
    for (const s of all) {
      const byDegree = new Map<number, number[]>();
      for (const faces of cornersOf(s)) {
        const sum = faces.reduce((a, i) => a + s.f[i].value, 0);
        const bucket = byDegree.get(faces.length) ?? [];
        bucket.push(sum);
        byDegree.set(faces.length, bucket);
      }
      let worst = 0;
      for (const sums of byDegree.values()) {
        worst = Math.max(worst, Math.max(...sums) - Math.min(...sums));
      }
      expect(worst).toBe(CORNER_SPREAD[s.sides]);
    }
  });

  it("reads 1-2-3 COUNTERCLOCKWISE on the d6 — the western die", () => {
    // The chirality nobody notices until they hold it next to a real die.
    // Both mirror images satisfy every other rule in this file.
    const s = solidFor(6);
    const centres = [1, 2, 3].map((v) => s.f[faceForValue(s, v)].c);
    const corner = s.v.find((v) =>
      [1, 2, 3].every((n) => vDot(s.f[faceForValue(s, n)].n, v) > 0),
    );
    expect(corner).toBeDefined();
    const turn = vCross(
      vSub(centres[1], centres[0]),
      vSub(centres[2], centres[0]),
    );
    expect(vDot(turn, corner as Vec3)).toBeGreaterThan(0);
  });

  it("finds the face for a value, and reports −1 for a value the body lacks", () => {
    for (const s of all) {
      for (let v = 1; v <= s.sides; v++) {
        expect(s.f[faceForValue(s, v)].value).toBe(v);
      }
      expect(faceForValue(s, s.sides + 1)).toBe(-1);
    }
  });
});

describe("the face grid — where pips and numerals actually land", () => {
  it("keeps every d6 pip inside its face, with room for its radius", () => {
    // The face's 100-grid is mapped so that ±50 is the face's INRADIUS, which
    // for the cube means the grid covers the square exactly. A pip at (30,30)
    // with r = 10 must still clear the edge — the drawn radius is 10 in the
    // renderer, so that is the number tested, not a friendlier one.
    const s = solidFor(PIP_FACES);
    const pipR = 10;
    for (const face of s.f) {
      const scale = face.inr / 50;
      for (const pips of Object.values(PIPS)) {
        for (const [px, py] of pips) {
          const p = vAdd(
            face.c,
            vAdd(
              vScale(face.u, (px - 50) * scale),
              vScale(face.w, (py - 50) * scale),
            ),
          );
          // in the plane…
          expect(Math.abs(vDot(face.n, vSub(p, face.c)))).toBeLessThan(EPS);
          // …and clear of every edge by the pip's own radius.
          for (let k = 0; k < face.v.length; k++) {
            const a = s.v[face.v[k]];
            const b = s.v[face.v[(k + 1) % face.v.length]];
            const ab = vSub(b, a);
            const dist = vLen(vCross(ab, vSub(p, a))) / vLen(ab);
            expect(dist).toBeGreaterThan(pipR * scale);
          }
        }
      }
    }
  });

  it("gives every body a grid big enough for a two-digit numeral", () => {
    // The em-box of «20» at the renderer's font size, as a radius: anything
    // inside the face's inscribed circle is inside the face, whatever the
    // face's shape, so this one comparison covers all six bodies.
    const em = 46;
    const halfWidth = (2 * 0.6 * em) / 2;
    const radius = Math.hypot(halfWidth, em / 2);
    expect(radius).toBeLessThan(50);
    for (const s of all) expect(s.f[0].inr).toBeGreaterThan(0.3);
  });
});
