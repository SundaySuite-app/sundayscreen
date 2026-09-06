// The die's PAINT layer: everything between a body-plus-orientation and the
// SVG nodes on screen. Lifted out of `DiceWidget.tsx` in R7 — it was the last
// place in the folder where a testable routine lived inside a component file,
// and `die-paint.test.ts` had to import a `.tsx` to reach it.
//
// What belongs here and what does not: this module owns the WRITES (the node
// pool, the per-frame attributes, the two dataset words the stylesheet and
// the e2e suite read). `facePool` — the markup those writes land on — stays
// in the component, because it is JSX and a `*-core` in this house is a
// node-tested `.ts`.
//
// ## Three SVG traps, named where they bite
//
//  - `element.className` on an SVG node is a read-only `SVGAnimatedString`.
//    Classes are written with `setAttribute("class", …)`.
//  - the `hidden` ATTRIBUTE does nothing in SVG. Marks are hidden with
//    `style.display`; faces are hidden with a CLASS, because whether the far
//    side is drawn is a question about the material and the card's size, not
//    about this frame (see `.back` in dice.module.css).
//  - a `font-size` in the numeral's CSS class would beat the presentation
//    attribute, and the presentation attribute is the one carrying the
//    projection's scale. It lives on the element; the class has none.

import { PIPS, PIP_FACES } from "./dice-core";
import { type MaterialTraits } from "./die-materials-core";
import { qRotate, type Quat } from "./die-orient-core";
import {
  fmt,
  GRID,
  LABEL_EM,
  MARK_MIN_FACING,
  matrixAttr,
  pipRadius,
  projectDie,
  toGrid,
  type DieView,
} from "./die-project-core";
import { type Solid } from "./die-solids-core";
import styles from "./dice.module.css";

/** How far past `MARK_MIN_FACING` a face has to turn before its numeral is
 *  fully opaque. The mark FADES across the threshold rather than popping:
 *  a «17» that appears out of nothing as the die slows is the one thing that
 *  reads as a rendering fault rather than as a die. */
const MARK_FADE_BAND = 0.12;

/** Tone index → the CSS class that names its ramp step. */
export const TONE_CLASS: string[] = [
  styles.tone0,
  styles.tone1,
  styles.tone2,
  styles.tone3,
  styles.tone4,
];

const HALF = GRID / 2;

/** How solid a mark is at this facing — 0 at the gate, 1 a little past it. */
function markOpacity(facing: number): number {
  const at = (facing - MARK_MIN_FACING) / MARK_FADE_BAND;
  return at <= 0 ? 0 : at >= 1 ? 1 : at;
}

/**
 * Where value `v`'s pips fall on one face — the ONE piece of geometry in this
 * file, and it exists for exactly one journey.
 *
 * `projectDie` places pips for the value the BODY carries, which is what a die
 * always shows. The reduced-motion roll is the single case where the mark and
 * the body disagree on purpose: the teacher has asked for no movement, so the
 * die stands still and the number on its front face scrambles in place until
 * the answer arrives. A d6's number is its pips, so «scramble the front
 * number» has to be able to lay out a pattern the geometry is not holding.
 *
 * ⚠️ «Stands still» is not «stands SQUARE», and the difference used to be
 * wrong here (R5-funn M1). The body it runs on is wherever the teacher last
 * left it: the trackball follows the finger 1:1 under reduced motion too —
 * that is design choice 7, deliberate — and `roll()` then takes the reduced
 * branch, which never touches `orient.current`. So the scramble can perfectly
 * well run on a die that has been hand-spun 40° off square, and a radius
 * taken from the projected u-axis alone was drawing pips up to 1.84× too fat
 * there. The positions were always right; only the dots swelled.
 *
 * It is still a SECOND implementation of the pip block in `projectDie`, which
 * is exactly the shape a seam bug comes in: two pieces of arithmetic that are
 * each correct and disagree in the middle. The FORMULA is now shared —
 * `pipRadius` in die-project-core is the single ellipse-minor-axis — and
 * `die-mark.test.ts` still holds the two ends against each other over
 * arbitrary orientations rather than over the square-on ones the docstring
 * used to promise.
 */
export function pipsForValue(
  solid: Solid,
  faceIndex: number,
  q: Quat,
  value: number,
): number[][] {
  const face = solid.f[faceIndex];
  const c = qRotate(q, face.c);
  const u = qRotate(q, face.u);
  const w = qRotate(q, face.w);
  const at = (lx: number, ly: number) =>
    toGrid({
      x: c.x + u.x * lx + w.x * ly,
      y: c.y + u.y * lx + w.y * ly,
      z: c.z + u.z * lx + w.z * ly,
    });
  // The face's own frame, projected — the same three points `projectDie`
  // takes the numeral's affine matrix from, in the same order.
  const origin = at(0, 0);
  const alongU = at(face.inr, 0);
  const alongW = at(0, face.inr);
  const radius = pipRadius(
    (alongU.x - origin.x) / HALF,
    (alongU.y - origin.y) / HALF,
    (alongW.x - origin.x) / HALF,
    (alongW.y - origin.y) / HALF,
  );
  return (PIPS[value] ?? []).map(([px, py]) => {
    const spot = at(
      ((px - HALF) / HALF) * face.inr,
      ((py - HALF) / HALF) * face.inr,
    );
    return [spot.x, spot.y, radius];
  });
}

// ── The pool ────────────────────────────────────────────────────────────────

interface Pool {
  key: string;
  faces: SVGPolygonElement[];
  marks: SVGElement[];
  outline: SVGPathElement | null;
  glossClip: SVGPolygonElement | null;
  plate: SVGCircleElement | null;
}

/** One `querySelectorAll` sweep per pool, not per frame: the node list is
 *  stable for as long as the body and the finish are, and re-querying sixty
 *  times a second is how a rAF loop starts allocating. */
const POOLS = new WeakMap<SVGSVGElement, Pool>();

function poolOf(svg: SVGSVGElement, key: string): Pool {
  const known = POOLS.get(svg);
  if (known && known.key === key) return known;
  const built: Pool = {
    key,
    faces: [...svg.querySelectorAll<SVGPolygonElement>("[data-face]")],
    marks: [...svg.querySelectorAll<SVGElement>("[data-mark]")],
    outline: svg.querySelector<SVGPathElement>("[data-outline]"),
    glossClip: svg.querySelector<SVGPolygonElement>("[data-gloss-clip]"),
    plate: svg.querySelector<SVGCircleElement>("[data-plate]"),
  };
  POOLS.set(svg, built);
  return built;
}

export interface PaintOpts {
  traits: MaterialTraits;
  /** Must change whenever the node pool does — body or finish. */
  poolKey: string;
  /** The pattern id for one tone step; only read when the finish has grain. */
  grainId?: (tone: number) => string;
  /** Last frame's view, reused in place. Read the result, do not keep it. */
  scratch?: DieView;
  /** Print this on the face turned to the class instead of what the body
   *  carries — the reduced-motion scramble, and nothing else. */
  mark?: number;
}

/**
 * One die, one orientation, straight into the DOM.
 *
 * Exported because the appearance panel draws its five finish swatches with
 * the REAL renderer: the difference between casino and metal is the shading,
 * and a word or a flat square could not show it. One paint routine, so a
 * teacher choosing «metall» from the panel is looking at the die she will get.
 */
export function paintDie(
  svg: SVGSVGElement,
  solid: Solid,
  q: Quat,
  opts: PaintOpts,
): DieView {
  const view = projectDie(solid, q, opts.scratch);
  const pool = poolOf(svg, opts.poolKey);
  const pipFace = solid.sides === PIP_FACES;

  let brightest = view.up;
  let brightestTone = -1;
  // The runner-up among the faces turned at the class — the one number that
  // says whether `view.up` is a READING or a coin toss. See the plate below.
  let runnerUp = -Infinity;

  view.faces.forEach((paint, i) => {
    const face = pool.faces[i];
    if (face) {
      face.setAttribute("points", paint.points);
      // ⚠️ `setAttribute`, not `.className` — that is a read-only
      // `SVGAnimatedString` on an SVG element.
      face.setAttribute(
        "class",
        paint.front
          ? `${styles.face} ${TONE_CLASS[paint.tone]}`
          : `${styles.face} ${styles.back} ${TONE_CLASS[paint.tone]}`,
      );
      // Wood fills from a pattern, which is a per-card url the stylesheet
      // cannot know. Cleared explicitly for every other finish: Preact reuses
      // these elements when only the material changes, and a stale inline
      // fill would leave a metal die wearing wood.
      face.style.fill =
        opts.traits.grain && opts.grainId
          ? `url(#${opts.grainId(paint.tone)})`
          : "";
    }
    if (paint.front && paint.tone > brightestTone) {
      brightestTone = paint.tone;
      brightest = i;
    }
    if (paint.front && i !== view.up && paint.facing > runnerUp) {
      runnerUp = paint.facing;
    }

    const mark = pool.marks[i];
    if (!mark) return;
    const scrambled = opts.mark !== undefined && i === view.up;
    const value = scrambled ? opts.mark! : paint.value;
    const spots =
      scrambled && pipFace ? pipsForValue(solid, i, q, value) : paint.pips;
    const shown = paint.front && (paint.label !== null || spots.length > 0);
    // ⚠️ `style.display`, not the `hidden` attribute — `hidden` has no effect
    // in SVG at all.
    mark.style.display = shown ? "" : "none";
    if (!shown) return;
    mark.style.opacity = String(markOpacity(paint.facing));
    if (pipFace) {
      const circles = mark.children;
      for (let k = 0; k < circles.length; k++) {
        const circle = circles[k] as SVGCircleElement;
        const spot = spots[k];
        if (!spot) {
          circle.style.display = "none";
          continue;
        }
        circle.style.display = "";
        circle.setAttribute("cx", fmt(spot[0]));
        circle.setAttribute("cy", fmt(spot[1]));
        circle.setAttribute("r", fmt(spot[2]));
      }
    } else if (paint.label) {
      mark.textContent = String(value);
      mark.setAttribute("transform", matrixAttr(paint.label));
    }
  });

  if (pool.outline) pool.outline.setAttribute("d", view.silhouette);
  if (pool.glossClip) {
    pool.glossClip.setAttribute("points", view.faces[brightest].points);
  }
  if (pool.plate) {
    // A plate of the card's own paper under the NUMERAL of the face the class
    // is reading, so the far edges a glass die draws across its front do not
    // run through the answer. Never under pips — a far edge across a solid
    // dot leaves a solid dot (see `MaterialTraits.plate`), which is why a
    // glass d6 has this node and never shows it.
    //
    // ⚠️ …and never when there is no answer to protect. Corner-on, a die has
    // three to five faces turned at the class by exactly the same amount, and
    // `view.up` is then a tie broken on face index. A white disc behind ONE of
    // five equal numerals is a die pointing at its own answer — which is
    // precisely what `idleOrientationFor` exists to stop it doing (R5-funn
    // H1), and it was visible on a glass d20 the moment the corner-on pose
    // landed. A rolled die rests at 0.956 against a runner-up far below it, so
    // the margin is never in doubt where it matters.
    const front = view.faces[view.up];
    const decided = front.facing - runnerUp > 1e-6;
    if (front.label && decided) {
      const scale = Math.hypot(front.label[0], front.label[1]);
      pool.plate.style.display = "";
      pool.plate.setAttribute("cx", fmt(front.label[4]));
      pool.plate.setAttribute("cy", fmt(front.label[5]));
      pool.plate.setAttribute("r", fmt(0.62 * LABEL_EM * scale));
    } else {
      pool.plate.style.display = "none";
    }
  }

  // Which finish wants the far side drawn — read off the TRAITS, so the table
  // in `die-materials-core` is load-bearing rather than decorative (R5-funn
  // M2). It used to be spelled `[data-material="glass"]` in the stylesheet,
  // which meant a sixth finish with `backFaces: true` would have gone green
  // through every trait test and drawn nothing at all.
  //
  // An ATTRIBUTE, present or absent: `.back` is `display: none` by default and
  // `[data-back-faces] .back` turns it back on, so the die is never one
  // re-render away from a flash of its own far side.
  if (opts.traits.backFaces) svg.dataset.backFaces = "";
  else delete svg.dataset.backFaces;

  // What the class is reading RIGHT NOW. Deliberately not the same thing as
  // the roll area's `data-value`: see the component's own note below.
  //
  // ⚠️ Not written by a die that is not talking to the class. The appearance
  // panel paints five 40 px `aria-hidden` swatches with this same renderer,
  // and five decorative dice claiming «the room is reading a 4» is five lies
  // in the attribute the e2e suite treats as the widget's own word for what
  // is turned toward the room (R5-funn L2).
  if (svg.getAttribute("aria-hidden") === "true") return view;

  // ⚠️ At REST the up face is a genuine argmax and this is the answer. In the
  // IDLE pose it is a TIE: `idleOrientationFor` stands the body on a corner,
  // where three to five faces are turned toward the room by exactly the same
  // amount, and `projectDie` breaks that tie on face INDEX (first strict
  // winner wins). Deterministic — the same body always publishes the same
  // number — but it is a tie-break, not a reading: `data-value` is absent
  // precisely then, and that is the attribute that says whether there is an
  // answer at all.
  svg.dataset.faceUp = String(opts.mark ?? view.upValue);
  return view;
}
