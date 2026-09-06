// The dice: a real three-dimensional body, drawn as SVG, thrown across the
// card and turned under the teacher's finger. The last roll is persisted in
// the config so the board still shows it after a restart.
//
// The pieces are deliberately separate, and only the last TWO may touch a DOM
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
//   - `die-paint-core.ts`    one body + one orientation → the SVG nodes, and
//                            the three SVG traps that come with writing them
//   - this file              the markup those writes land on, the gestures,
//                            and the card around them
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
// The three SVG traps those imperative writes fall into are named in
// `die-paint-core.ts`, beside the code that has to dodge them. The fourth trap
// is named HERE, because the flight's transform is written here:
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
import { PIP_FACES, ZERO_BASED_FACES, randomDie, snapFaces } from "./dice-core";
import { frameAt, simulateThrow } from "./dice-physics-core";
import { dieDefId, MATERIAL_TRAITS } from "./die-materials-core";
import {
  qMul,
  qNormalize,
  spinDelta,
  spinStep,
  type Quat,
  type Spin,
  type SpinState,
} from "./die-orient-core";
import { LABEL_EM, TONES, type DieView } from "./die-project-core";
import { paintDie, TONE_CLASS } from "./die-paint-core";
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

/** A coast integrates at most this many fixed steps in one frame. A tab that
 *  was in the background for a minute comes back with a minute of elapsed
 *  time, and a die that answers by spinning forty turns is not a die. */
const MAX_STEPS_PER_FRAME = 12;

/** The five ramp steps and the six pip slots, as lists to render from. */
const TONE_STEPS = Array.from({ length: TONES }, (_, i) => i);
const PIP_SLOTS = Array.from({ length: 6 }, (_, i) => i);

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

// Re-exported so the appearance panel keeps ONE import from the widget it is
// a panel for (`DieLookMenu.tsx` draws its swatches with `facePool` above and
// this same renderer). The routine itself lives in `die-paint-core.ts`.
export { paintDie };

// ── The widget ──────────────────────────────────────────────────────────────

export function DiceWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "dice") return null;

  const count = cfg.count;
  const faces = cfg.faces;
  // The cross mirrors `normalize` in layout.rs AT THE READ SEAM: the real
  // store never hands out a zero-based d6, but the e2e tier's mini backend
  // stores configs raw, and this one line is what keeps the two tiers
  // reading the same die. Through `snapFaces`, not `faces === 10` — Rust
  // snaps BEFORE it judges the flag, so a future d11 config is a zero-based
  // d10 there, and the raw comparison would quietly disagree with it.
  const zeroBased = snapFaces(faces) === ZERO_BASED_FACES && cfg.zeroBased;
  const solid = solidFor(faces, zeroBased);
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
  const live = useRef({
    faces,
    zeroBased,
    count,
    material,
    lastRoll: cfg.lastRoll,
  });
  live.current = { faces, zeroBased, count, material, lastRoll: cfg.lastRoll };

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
  const poolKey = `${faces}${zeroBased ? "z" : ""}:${count}`;
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
    const body = solidFor(now.faces, now.zeroBased);
    return now.lastRoll.length === now.count &&
      now.lastRoll[index] !== undefined
      ? restOrientationForValue(body, now.lastRoll[index])
      : idleOrientationFor(body);
  };

  const paint = () => {
    const now = live.current;
    const body = solidFor(now.faces, now.zeroBased);
    const traits = MATERIAL_TRAITS[now.material];
    const key = `${body.sides}${now.zeroBased ? "z" : ""}:${now.material}`;
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
    const final = Array.from({ length: count }, () =>
      randomDie(faces, undefined, zeroBased),
    );
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
          randomDie(now.faces, undefined, now.zeroBased),
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
        // closure. The TYPE guard is load-bearing, not belt-and-braces
        // (0–9-gransking F1): a count change makes `final` the wrong length
        // and falls into the empty state on its own, but a TYPE switched
        // mid-flight keeps the length — and 0–9 ↔ 1–10 keeps the BODY too,
        // so a committed 0 would sit under a 1–10 label as a value that die
        // cannot even show (drawn as the «10» face by the value-lookup
        // fallback). The roll belongs to the die it was thrown as.
        updateWidgetConfigBy(widget.id, (c) =>
          c.kind === "dice" &&
          c.faces === faces &&
          (snapFaces(c.faces) === ZERO_BASED_FACES && c.zeroBased) === zeroBased
            ? { ...c, lastRoll: final }
            : c,
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
            key={`${faces}${zeroBased ? "z" : ""}:${material}:${i}`}
            class={styles.die}
            viewBox="0 0 100 100"
            data-solid={faces}
            data-zero-based={zeroBased || undefined}
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
          {zeroBased
            ? t("dice.facesLabelZero")
            : tf("dice.facesLabel", { n: faces })}
        </button>
      </div>
    </div>
  );
}
