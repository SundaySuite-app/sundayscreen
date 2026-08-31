// The dice: a real three-dimensional body, drawn as SVG, thrown across the
// card and turned under the teacher's finger. The last roll is persisted in
// the config so the board still shows it after a restart.
//
// The pieces are deliberately separate, and only the last one may touch a DOM
// node:
//
//   - `dice-core.ts`         which types exist, where a number comes from,
//                            where the d6's pips sit on a face
//   - `die-solids-core.ts`   the six bodies, as geometry
//   - `die-orient-core.ts`   which way one is facing, as quaternions
//   - `die-project-core.ts`  one body + one orientation → one frame of SVG
//   - `die-physics-core.ts`  the throw, as arithmetic
//   - `die-spin-core.ts`     the flick, as arithmetic
//   - `die-materials-core.ts` which extra parts a finish asks for
//   - this file              the DOM, and nothing else
//
// ## The DOM is a POOL, and Preact owns it
//
// Preact renders one node per face — a polygon, a numeral or a group of pips,
// an outline, and whatever the finish adds — and then never touches their
// geometry again. `paintDie` writes every coordinate imperatively, from a rAF
// tick and from a layout effect. Two reasons, and the second is the one that
// would have hurt:
//
//  1. A vdom diff per frame across six dice and a hundred and thirty nodes is
//     work for nothing: the SHAPE never changes, only the numbers in it.
//  2. Preact only writes props it was GIVEN. The face polygons are handed no
//     `points`, so an imperative `points` survives every re-render — a config
//     change mid-throw cannot blank the flight. A state-driven geometry would
//     fight the rAF loop for the same attribute at two different frame rates.
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
//
// ## The transform trap (docs/REVISJON-R3.md, Toolbar.module.css)
//
// «An element whose `transform` is not `none` becomes the containing block for
// every `position: fixed` DESCENDANT.» It bit the toolbar, whose dismiss
// backdrops then sized themselves to the toolbar instead of the viewport. Safe
// HERE because the flight's transform lands on the leaf `<svg>` faces, which
// have no descendants that matter — and because it is now a pure TRANSLATION:
// the die's rotation lives in the projected geometry, which is what keeps
// «the computed transform is the identity at rest» true by construction. Never
// lift it to `.dice` or to the roll area.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { DieMaterial } from "../../bindings/DieMaterial";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf } from "../../i18n";
import { LIMITS } from "@lib/limits.generated";
import { openWidgetOverlay, widgetOverlay } from "../../state/chrome";
import { selectedWidgetId, updateWidgetConfigBy } from "../../state/layout";
import { isDrag } from "../../screen/interact-core";
// ⚠️ The second ring in this folder, and it holds for the same reason the
// chrome → registry → dice → chrome one does: `useDrag` reads the registry
// only INSIDE functions, so nothing dereferences a half-built module during
// evaluation. `suppressNextClick` is imported rather than copied on purpose —
// see its docstring.
import { suppressNextClick } from "../../screen/useDrag";
import { Icon } from "../../ui/Icon";
import { PIPS, PIP_FACES, randomDie } from "./dice-core";
import { frameAt, simulateThrow } from "./dice-physics-core";
import {
  dieDefId,
  MATERIAL_TRAITS,
  type MaterialTraits,
} from "./die-materials-core";
import {
  qMul,
  qNormalize,
  qRotate,
  spinDelta,
  spinStep,
  type Quat,
  type Spin,
  type SpinState,
} from "./die-orient-core";
import {
  fmt,
  GRID,
  LABEL_EM,
  MARK_MIN_FACING,
  matrixAttr,
  pipRadius,
  projectDie,
  toGrid,
  TONES,
  type DieView,
} from "./die-project-core";
import { solidFor, type Solid } from "./die-solids-core";
import {
  TRACKBALL_STEP_MS,
  flickSpin,
  idleOrientationFor,
  restOrientationForValue,
  trimSamples,
  type PointerSample,
} from "./die-spin-core";
import styles from "./dice.module.css";

/**
 * The whole throw. Classroom-fast on purpose: long enough to read as a die
 * being thrown, short enough that a teacher rolling for the fourth time in a
 * minute is not waiting on it.
 *
 * The flight is confined to the WIDGET CARD, not the board — a die tumbling
 * across the whole screen would cover the timer and the day's agenda. A
 * teacher who wants the big version focuses the card with «Vis stort» first;
 * the card becomes the throw box and the same code fills the projector.
 */
const THROW_MS = 1100;

/** The reduced-motion fallback: the scramble-in-place, unchanged. */
const SCRAMBLE_MS = 600;
const SCRAMBLE_STEP_MS = 70;

/** How far past `MARK_MIN_FACING` a face has to turn before its numeral is
 *  fully opaque. The mark FADES across the threshold rather than popping:
 *  a «17» that appears out of nothing as the die slows is the one thing that
 *  reads as a rendering fault rather than as a die. */
const MARK_FADE_BAND = 0.12;

/** A coast integrates at most this many fixed steps in one frame. A tab that
 *  was in the background for a minute comes back with a minute of elapsed
 *  time, and a die that answers by spinning forty turns is not a die. */
const MAX_STEPS_PER_FRAME = 12;

/** The five ramp steps and the six pip slots, as lists to render from. */
const TONE_STEPS = Array.from({ length: TONES }, (_, i) => i);
const PIP_SLOTS = Array.from({ length: 6 }, (_, i) => i);

/** Tone index → the CSS class that names its ramp step. */
const TONE_CLASS: string[] = [
  styles.tone0,
  styles.tone1,
  styles.tone2,
  styles.tone3,
  styles.tone4,
];

const HALF = GRID / 2;

/** Does the teacher's OS ask for less movement? Read fresh at every gesture:
 *  the card's own growth animation asks the same question in CSS, but a rAF
 *  loop is invisible to a media query, so this half has to be asked in JS. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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

/**
 * Every node one die needs, for one body and one finish.
 *
 * Deliberately free of geometry: not one `points`, `d`, `cx` or `transform` is
 * handed to Preact, so `paintDie` owns all of them and no re-render can undo a
 * frame. The classes ARE handed over, because they never change between
 * renders — which means Preact skips them in the diff and the tone class
 * `paintDie` appends survives.
 */
export function facePool(
  solid: Solid,
  material: DieMaterial,
  id: (part: string) => string,
) {
  const traits = MATERIAL_TRAITS[material];
  const pips = solid.sides === PIP_FACES;
  return (
    <>
      {(traits.grain || traits.gloss) && (
        <defs>
          {traits.grain &&
            TONE_STEPS.map((step) => (
              // ⚠️ The id carries the widget's own id (see `dieDefId`): SVG
              // ids are document-global, and six dice sharing a `#grain2`
              // would all paint out of whichever one parsed last.
              <pattern
                key={`grain${step}`}
                id={id(`grain${step}`)}
                width="14"
                height="14"
                patternUnits="userSpaceOnUse"
                patternTransform={`rotate(${17 + step * 29})`}
              >
                <rect width="14" height="14" class={TONE_CLASS[step]} />
                <rect width="14" height="3.2" class={styles.grain} />
                <rect y="7.4" width="14" height="1.6" class={styles.grain} />
              </pattern>
            ))}
          {traits.gloss && (
            <clipPath id={id("gloss")}>
              <polygon data-gloss-clip />
            </clipPath>
          )}
        </defs>
      )}
      {solid.f.map((_, i) => (
        <polygon key={`f${i}`} data-face={i} class={styles.face} />
      ))}
      <path data-outline class={styles.outline} />
      {traits.gloss && (
        // The specular window: one soft ellipse, clipped to whichever face is
        // brightest this frame. The clip is what makes it a highlight ON the
        // die rather than a smudge floating over it.
        <ellipse
          class={styles.gloss}
          clip-path={`url(#${id("gloss")})`}
          cx="34"
          cy="30"
          rx="30"
          ry="15"
          transform="rotate(-34 34 30)"
        />
      )}
      {traits.plate && <circle data-plate class={styles.plate} />}
      {solid.f.map((_, i) =>
        pips ? (
          <g key={`m${i}`} data-mark={i}>
            {PIP_SLOTS.map((k) => (
              <circle key={k} class={styles.pip} />
            ))}
          </g>
        ) : (
          <text
            key={`m${i}`}
            data-mark={i}
            class={styles.value}
            x="0"
            y="0"
            font-size={LABEL_EM}
          />
        ),
      )}
    </>
  );
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

// ── The widget ──────────────────────────────────────────────────────────────

export function DiceWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "dice") return null;

  const count = cfg.count;
  const faces = cfg.faces;
  const solid = solidFor(faces);
  const material = cfg.material;

  const [rolling, setRolling] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLButtonElement | null>(null);
  const lookRef = useRef<HTMLButtonElement | null>(null);

  /**
   * What the rAF loops read. A throw outlives the render that started it, and
   * the count knob stays live throughout — so a tick that closed over the
   * config would keep drawing yesterday's die for a second after the teacher
   * changed it.
   */
  const live = useRef({ faces, count, material, lastRoll: cfg.lastRoll });
  live.current = { faces, count, material, lastRoll: cfg.lastRoll };

  /** Each die's orientation. VIEW state — never persisted, exactly like
   *  `focusedWidgetId`: a restart shows the roll square to the class, not the
   *  angle somebody happened to leave it at (promise 2). */
  const orient = useRef<Quat[]>([]);
  const scratch = useRef<(DieView | undefined)[]>([]);
  const scramble = useRef<number[] | null>(null);
  const coast = useRef<{
    index: number;
    state: SpinState;
    acc: number;
    last: number;
  } | null>(null);
  const timers = useRef<{
    interval?: ReturnType<typeof setInterval>;
    timeout?: ReturnType<typeof setTimeout>;
    frame?: number;
    spinFrame?: number;
  }>({});

  // A new body or a different number of dice is a new pool, and the old
  // orientations described faces that are gone. Rolled back to rest rather
  // than carried over: `setCount` and a type change both clear `lastRoll`, so
  // there is no answer for a carried-over angle to be showing.
  const poolKey = `${faces}:${count}`;
  const lastPool = useRef(poolKey);
  if (lastPool.current !== poolKey) {
    lastPool.current = poolKey;
    orient.current = [];
    scratch.current = [];
    coast.current = null;
  }

  useEffect(
    () => () => {
      if (timers.current.interval) clearInterval(timers.current.interval);
      if (timers.current.timeout) clearTimeout(timers.current.timeout);
      if (timers.current.frame !== undefined)
        cancelAnimationFrame(timers.current.frame);
      if (timers.current.spinFrame !== undefined)
        cancelAnimationFrame(timers.current.spinFrame);
    },
    [],
  );

  /** Every face currently on the card, read FRESH — the count knob stays live
   *  during a throw, so the list this returns is not necessarily the list the
   *  flight started with. */
  const faceEls = (): SVGSVGElement[] =>
    areaRef.current
      ? [...areaRef.current.querySelectorAll<SVGSVGElement>("svg[data-solid]")]
      : [];

  /** Where a die sits when nothing is happening to it: showing the face it
   *  landed on, or standing on its corner when there is no answer yet. */
  const restQuat = (index: number): Quat => {
    const now = live.current;
    const body = solidFor(now.faces);
    return now.lastRoll.length === now.count &&
      now.lastRoll[index] !== undefined
      ? restOrientationForValue(body, now.lastRoll[index])
      : idleOrientationFor(body);
  };

  const paint = () => {
    const now = live.current;
    const body = solidFor(now.faces);
    const traits = MATERIAL_TRAITS[now.material];
    const key = `${body.sides}:${now.material}`;
    faceEls().forEach((svg, i) => {
      scratch.current[i] = paintDie(
        svg,
        body,
        orient.current[i] ?? restQuat(i),
        {
          traits,
          poolKey: key,
          grainId: (tone) => dieDefId(`${widget.id}-${i}`, `grain${tone}`),
          scratch: scratch.current[i],
          mark: scramble.current?.[i],
        },
      );
    });
  };

  // No deps, on purpose. The resting image is painted SYNCHRONOUSLY after
  // every render and before the browser paints — which is promise 2 without a
  // blank frame: a restart mid-lesson comes back with the die already showing
  // what the class last saw, never a flash of an unpainted body.
  useLayoutEffect(paint);

  const clearFlight = () => {
    for (const el of faceEls()) el.style.transform = "";
  };

  const stopCoast = () => {
    coast.current = null;
    if (timers.current.spinFrame !== undefined) {
      cancelAnimationFrame(timers.current.spinFrame);
      timers.current.spinFrame = undefined;
    }
  };

  const startCoast = (index: number, spin: Spin) => {
    coast.current = {
      index,
      state: { q: orient.current[index] ?? restQuat(index), spin },
      acc: 0,
      last: performance.now(),
    };
    const tick = (now: number) => {
      const run = coast.current;
      if (!run) return;
      run.acc += now - run.last;
      run.last = now;
      let steps = 0;
      while (
        run.acc >= TRACKBALL_STEP_MS &&
        run.state.spin.rate !== 0 &&
        steps < MAX_STEPS_PER_FRAME
      ) {
        run.state = spinStep(run.state);
        run.acc -= TRACKBALL_STEP_MS;
        steps++;
      }
      run.acc = Math.min(run.acc, TRACKBALL_STEP_MS);
      orient.current[run.index] = run.state.q;
      paint();
      if (run.state.spin.rate === 0) {
        // Where the teacher left it is where it stays: no drift back to
        // square. Showing the sides IS the lesson, and a card that quietly
        // rewinds itself is a card arguing with her.
        stopCoast();
        return;
      }
      timers.current.spinFrame = requestAnimationFrame(tick);
    };
    timers.current.spinFrame = requestAnimationFrame(tick);
  };

  const startFlight = (targets: Quat[]) => {
    const card = cardRef.current;
    const els = faceEls();
    if (!card || els.length === 0) return;

    const box = card.getBoundingClientRect();
    const rects = els.map((el) => el.getBoundingClientRect());
    const frames = simulateThrow({
      box: { w: box.width, h: box.height },
      rest: rects.map((r) => ({ x: r.x - box.x, y: r.y - box.y })),
      dieSize: rects[0].width,
      durationMs: THROW_MS,
      seed: [...crypto.getRandomValues(new Uint32Array(els.length))],
      // Where each die is NOW, so a die the teacher has spun takes off from
      // the angle she left it at rather than snapping square first.
      start: els.map((_, i) => orient.current[i] ?? restQuat(i)),
      target: targets,
    });

    // Written imperatively, not as a `style` prop: Preact only touches props
    // it was given, so an inline transform it never sees survives the diff.
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      const current = faceEls();
      frameAt(frames, elapsed).forEach((frame, i) => {
        const el = current[i];
        if (!el) return;
        el.style.transform = `translate(${frame.dx.toFixed(2)}px, ${frame.dy.toFixed(2)}px)`;
        if (frame.q) orient.current[i] = frame.q;
      });
      // The tumble IS the scramble now. A die that rolls shows real, changing
      // numbers on real faces, so there is nothing to fake in between.
      paint();
      timers.current.frame =
        elapsed < THROW_MS ? requestAnimationFrame(tick) : undefined;
    };
    timers.current.frame = requestAnimationFrame(tick);
  };

  const roll = () => {
    if (rolling) return;
    stopCoast();

    // The answer is drawn FIRST and the flight is steered onto it — the same
    // philosophy the translation has used since R12. That is what lets the
    // tumble be honest: every face the class sees on the way is the number
    // that is really on it.
    const final = Array.from({ length: count }, () => randomDie(faces));
    const targets = final.map((value) => restOrientationForValue(solid, value));
    setRolling(true);

    const reduced = prefersReducedMotion();
    if (reduced) {
      // The body STANDS. Only the number on the face turned to the class
      // changes, and at the commit there is one orientation hop onto the
      // answer — so the computed transform is the identity throughout, which
      // is what e2e samples across the whole roll.
      timers.current.interval = setInterval(() => {
        const now = live.current;
        scramble.current = Array.from({ length: now.count }, () =>
          randomDie(now.faces),
        );
        paint();
      }, SCRAMBLE_STEP_MS);
    } else {
      startFlight(targets);
    }

    timers.current.timeout = setTimeout(
      () => {
        if (timers.current.interval) clearInterval(timers.current.interval);
        timers.current.interval = undefined;
        if (timers.current.frame !== undefined) {
          cancelAnimationFrame(timers.current.frame);
          timers.current.frame = undefined;
        }
        scramble.current = null;
        // The landing frame is already the resting slot to the last decimal
        // (the physics core's steered landing guarantees it), so clearing the
        // inline transform is a no-op ON SCREEN — but it hands the position
        // back to the LAYOUT, which is what has to own it once the card can
        // be resized, focused or re-flowed again.
        clearFlight();
        orient.current = targets.slice();
        setRolling(false);
        // Merge into the CURRENT config (F9-funn S#6): a count or die-type
        // change made during the throw must not be reverted by this stale
        // closure. Such a change also makes `final` the wrong length, and the
        // shorter-or-longer list simply stops matching `count` — which is the
        // empty state, not a wrong answer.
        updateWidgetConfigBy(widget.id, (c) =>
          c.kind === "dice" ? { ...c, lastRoll: final } : c,
        );
      },
      reduced ? SCRAMBLE_MS : THROW_MS,
    );
  };

  /**
   * The trackball. `useDrag`'s recipe to the letter — window listeners keyed
   * on `pointerId`, the 4 px threshold from `isDrag`, capture taken only ON
   * CROSSING (capture retargets the browser's synthesized click, so capturing
   * on pointerdown would eat the click that rolls), and the shared
   * `suppressNextClick` when the press turned out to be a drag.
   */
  const startSpin = (e: PointerEvent) => {
    if (rolling) return;
    const target = e.target as Element | null;
    // Several dice share one roll area; the one under the finger is the one
    // that turns.
    const svg = target?.closest?.("svg[data-solid]") as SVGSVGElement | null;
    if (!svg) return;
    const index = faceEls().indexOf(svg);
    if (index < 0) return;
    const diePx = svg.getBoundingClientRect().width;
    if (!(diePx > 0)) return;
    stopCoast();

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let dragging = false;
    let samples: PointerSample[] = [
      { t: performance.now(), x: startX, y: startY },
    ];

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (!isDrag(ev.clientX - startX, ev.clientY - startY)) return;
        dragging = true;
        try {
          svg.setPointerCapture(pointerId);
        } catch {
          // A pointer that just ended cannot be captured — the up handler is
          // already on its way.
        }
      }
      const now = performance.now();
      samples.push({ t: now, x: ev.clientX, y: ev.clientY });
      samples = trimSamples(samples, now);
      // The increment since the LAST move, not since the press: the finger
      // drives the die continuously, and a delta measured from the start
      // would re-apply the whole gesture every frame.
      orient.current[index] = qNormalize(
        qMul(
          spinDelta(ev.clientX - lastX, ev.clientY - lastY, diePx),
          orient.current[index] ?? restQuat(index),
        ),
      );
      lastX = ev.clientX;
      lastY = ev.clientY;
      paint();
    };

    const teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      teardown();
      // Under the threshold this was a press, not a drag: the click that
      // follows reaches the roll area and throws the dice.
      if (!dragging) return;
      suppressNextClick();
      // Direct manipulation is not «motion» — the die follows the finger 1:1
      // even here. Inertia IS motion, so a teacher who asked for less of it
      // gets a die that stops the instant she lets go.
      if (prefersReducedMotion()) return;
      const spin = flickSpin(trimSamples(samples, performance.now()), diePx);
      if (spin) startCoast(index, spin);
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      teardown();
      // The OS took the pointer. Stop dead: a flick computed from samples
      // that end wherever the system decided to interrupt is a guess, and no
      // click follows a cancel, so there is none to suppress either.
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const setCount = (delta: number) => {
    const next = Math.min(
      Math.max(count + delta, LIMITS.DICE_MIN),
      LIMITS.DICE_MAX,
    );
    if (next === count) return;
    // Merged into the CURRENT config, not spread from this render's closure —
    // the same rule the commit at the end of `roll()` follows (F9-funn S#6),
    // and it is not theoretical here: a colour chosen in the appearance panel
    // and a `+` pressed in the same tick had the colour fall straight back
    // out again, because `cfg` was captured before the panel wrote (R5-funn
    // L1). `count` is the one thing this control owns; everything else on the
    // config belongs to whoever wrote it last.
    updateWidgetConfigBy(widget.id, (c) =>
      c.kind === "dice" ? { ...c, count: next, lastRoll: [] } : c,
    );
  };

  const openLook = () => {
    const el = lookRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    openWidgetOverlay(widget.id, {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
    });
    // ⚠️ And SELECT the card, which is this widget's call to make about its
    // own chrome (see `openWidgetOverlay`). The settings row is
    // `visibility`-gated on `:hover`/`[data-selected]` and the panel is not a
    // descendant of the card, so the row — with the trigger on it — would
    // blink out from under the finger the moment the pointer moved onto the
    // panel. `:focus-within` does not save it: WKWebView does not keep focus
    // inside the card when the panel is elsewhere in the tree.
    selectedWidgetId.value = widget.id;
  };

  const values = cfg.lastRoll.length === count ? cfg.lastRoll : null;
  const sum = values ? values.reduce((a, b) => a + b, 0) : null;
  const lookOpen = widgetOverlay.value?.id === widget.id;

  return (
    <div
      class={`${styles.dice} ${styles.look}`}
      data-count={count}
      data-color={cfg.color}
      data-material={material}
      ref={cardRef}
    >
      <button
        class={styles.rollArea}
        ref={areaRef}
        data-no-drag
        // The ROLL's protocol: what the class was told, and what a restart
        // brings back. ⚠️ NOT the same as a die's `data-face-up`, which is
        // whatever is turned to the room right now — after a teacher has spun
        // a die by hand the two differ ON PURPOSE, and nothing should «fix»
        // that. Gated on `!rolling` rather than on a preview: mid-flight the
        // config still holds the PREVIOUS answer, and publishing it while the
        // dice are in the air would be an attribute lying with a green test.
        data-value={!rolling && values ? values.join("-") : undefined}
        aria-label={t("dice.roll")}
        title={t("dice.roll")}
        // `aria-disabled`, not `disabled`: a button disabled mid-press loses
        // focus to the document, and the teacher's next Space or Enter goes
        // nowhere. The guard is the first line of `roll` instead.
        aria-disabled={rolling ? "true" : undefined}
        onClick={roll}
        onPointerDown={startSpin}
      >
        {Array.from({ length: count }, (_, i) => (
          // Keyed on the BODY and the FINISH as well as the slot: either one
          // changing is a different pool, and Preact rebuilding it is exactly
          // what should happen.
          <svg
            key={`${faces}:${material}:${i}`}
            class={styles.die}
            viewBox="0 0 100 100"
            data-solid={faces}
          >
            {facePool(solid, material, (part) =>
              dieDefId(`${widget.id}-${i}`, part),
            )}
          </svg>
        ))}
      </button>
      {count > 1 && sum !== null && !rolling && (
        <div class={styles.sum}>{tf("dice.sum", { n: sum })}</div>
      )}

      <div data-settings-row data-no-drag>
        <button
          data-settings-btn
          aria-label={t("dice.fewer")}
          title={t("dice.fewer")}
          onClick={() => setCount(-1)}
        >
          <Icon name="minus" size="sm" />
        </button>
        <button
          data-settings-btn
          aria-label={t("dice.more")}
          title={t("dice.more")}
          onClick={() => setCount(1)}
        >
          <Icon name="plus" size="sm" />
        </button>
        {/* The die type shows its own value, AND wears the family it is cut
            from — «D20» in the body colour with the family's ink on it. The
            control that was already there IS the swatch, so the appearance
            panel cost the row nothing: it is still three buttons on one line,
            which is the pin e2e/dice.spec.ts has held since the type knob
            landed. The row is `width: max-content` with a max-width cap
            (WidgetShell.module.css), and three buttons measure ~120 px against
            the 154 px available on the 170 px minimum card. */}
        <button
          data-settings-btn
          data-dice-look
          ref={lookRef}
          aria-haspopup="menu"
          aria-expanded={lookOpen}
          aria-label={t("dice.look")}
          title={t("dice.look")}
          onClick={openLook}
        >
          {tf("dice.facesLabel", { n: faces })}
        </button>
      </div>
    </div>
  );
}
