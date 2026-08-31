// The dice: fully frontend (OS entropy via crypto), THROWN across the card
// with a real little simulation, and the last roll persisted in the config so
// the board still shows it after a restart.
//
// The three pieces are deliberately separate:
//   - `dice-core.ts`         which types exist, how a face is drawn, where a
//                            number comes from
//   - `dice-physics-core.ts` the throw, as arithmetic — node-tested
//   - this file              the DOM, and nothing else
//
// A roll that is interrupted by a restart is not a roll: only the landed
// values reach the config, and a reload paints them straight (promise 2 — the
// screen comes back exactly as the class last saw it, with no animation
// replaying at them).

import { useEffect, useRef, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf } from "../../i18n";
import { LIMITS } from "@lib/limits.generated";
import { updateWidgetConfig, updateWidgetConfigBy } from "../../state/layout";
import { Icon } from "../../ui/Icon";
import {
  DEPTH_DX,
  DEPTH_DY,
  FACE_SHAPES,
  nextFaces,
  PIP_FACES,
  PIPS,
  randomDie,
} from "./dice-core";
import { frameAt, simulateThrow } from "./dice-physics-core";
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

/** The reduced-motion fallback: the pre-R11 scramble-in-place, unchanged. */
const SCRAMBLE_MS = 600;
const SCRAMBLE_STEP_MS = 70;

/** Where the numeral sits on the pip face's rounded square. */
const PIP_LABEL_Y = 52;

function DieFace({ value, faces }: { value: number | null; faces: number }) {
  // An unknown type is only reachable for the instant between a future
  // version's config arriving and Rust's clamp snapping it onto the list —
  // borrowing the d20 silhouette beats rendering a blank face for that frame.
  const shape =
    faces === PIP_FACES ? null : (FACE_SHAPES[faces] ?? FACE_SHAPES[20]);
  const labelY = shape ? shape.labelY : PIP_LABEL_Y;

  // The 3-D of it (owner request 08-31): one darker whole-die copy behind
  // the face gives the thickness, the shape's own facet table gives the
  // other visible faces, and the pips are drilled dimples rather than flat
  // dots. All flat tones and 2-unit edges — what survives 40 px on a
  // projector. The depth copy is drawn FIRST so the face covers it.
  const depth = `translate(${DEPTH_DX} ${DEPTH_DY})`;
  return (
    <svg
      class={styles.die}
      viewBox="0 0 100 100"
      data-narrow={shape?.narrow ? "" : undefined}
    >
      {shape ? (
        <>
          <polygon
            points={shape.points}
            class={styles.depth}
            transform={depth}
          />
          <polygon points={shape.points} class={styles.face} />
          {shape.shaded.map((pts, i) => (
            <polygon key={`s${i}`} points={pts} class={styles.facetShade} />
          ))}
          {shape.edges.map((pts, i) => (
            <polyline key={`e${i}`} points={pts} class={styles.facetEdge} />
          ))}
        </>
      ) : (
        <>
          <rect
            x="4"
            y="4"
            width="92"
            height="92"
            rx="18"
            class={styles.depth}
            transform={depth}
          />
          <rect
            x="4"
            y="4"
            width="92"
            height="92"
            rx="18"
            class={styles.face}
          />
        </>
      )}
      {value === null ? (
        <text x="50" y={labelY} class={styles.unknown} text-anchor="middle">
          ?
        </text>
      ) : shape === null ? (
        (PIPS[value] ?? []).map(([x, y], i) => (
          // A dimple, not a dot: a rim the pip sits inside, the pip itself a
          // hair up-left of it, and a specular fleck where the light lands.
          <g key={i}>
            <circle cx={x} cy={y} r="10" class={styles.pipRim} />
            <circle cx={x - 0.8} cy={y - 0.8} r="8.4" class={styles.pip} />
            <circle cx={x - 3.2} cy={y - 3.2} r="2.3" class={styles.pipSpec} />
          </g>
        ))
      ) : (
        <text x="50" y={labelY} class={styles.value} text-anchor="middle">
          {value}
        </text>
      )}
    </svg>
  );
}

export function DiceWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "dice") return null;

  const [rolling, setRolling] = useState(false);
  const [preview, setPreview] = useState<number[] | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<{
    interval?: ReturnType<typeof setInterval>;
    timeout?: ReturnType<typeof setTimeout>;
    frame?: number;
  }>({});

  useEffect(
    () => () => {
      if (timers.current.interval) clearInterval(timers.current.interval);
      if (timers.current.timeout) clearTimeout(timers.current.timeout);
      if (timers.current.frame !== undefined)
        cancelAnimationFrame(timers.current.frame);
    },
    [],
  );

  const count = cfg.count;
  const faces = cfg.faces;

  /** Every face currently on the card, read FRESH — the count knob stays live
   *  during a throw, so the list this returns is not necessarily the list the
   *  flight started with. */
  const faceEls = (): SVGSVGElement[] =>
    areaRef.current
      ? [...areaRef.current.querySelectorAll<SVGSVGElement>("svg")]
      : [];

  const clearFlight = () => {
    for (const el of faceEls()) el.style.transform = "";
  };

  const startFlight = () => {
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
    });

    // ⚠️ The transform trap (docs/REVISJON-R3.md, Toolbar.module.css): «an
    // element whose `transform` is not `none` becomes the containing block for
    // every `position: fixed` DESCENDANT, not just the absolute ones». It bit
    // the toolbar, whose dismiss backdrops then sized themselves to the
    // toolbar instead of the viewport and swallowed every click. Safe HERE
    // because the transform lands on the leaf <svg> faces, which have no
    // descendants at all — the rule is about CONTAINERS, and a die face is the
    // opposite of one. Never lift it to `.dice` or to the roll area.
    //
    // Written imperatively, not as a `style` prop, on purpose: the face
    // scramble re-renders these svgs every 70 ms, and Preact only touches
    // props it was given. An inline transform it never sees survives the diff;
    // a state-driven one would fight the rAF loop for the same attribute at
    // two different frame rates.
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      frameAt(frames, elapsed).forEach((f, i) => {
        const el = els[i];
        if (el)
          el.style.transform = `translate(${f.dx.toFixed(2)}px, ${f.dy.toFixed(2)}px) rotate(${f.rot.toFixed(2)}deg)`;
      });
      timers.current.frame =
        elapsed < THROW_MS ? requestAnimationFrame(tick) : undefined;
    };
    timers.current.frame = requestAnimationFrame(tick);
  };

  const roll = () => {
    if (rolling) return;
    setRolling(true);

    // Read the OS preference ONCE per throw. A teacher who has asked the
    // system for less movement gets the old scramble-in-place: the answer
    // still arrives, nothing flies. (The card's own growth animation asks the
    // same question in CSS — `WidgetShell.module.css` — but a rAF loop is
    // invisible to a media query, so this half has to be asked in JS.)
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    timers.current.interval = setInterval(() => {
      setPreview(Array.from({ length: count }, () => randomDie(faces)));
    }, SCRAMBLE_STEP_MS);

    if (!reduced) startFlight();

    timers.current.timeout = setTimeout(
      () => {
        if (timers.current.interval) clearInterval(timers.current.interval);
        timers.current.interval = undefined;
        if (timers.current.frame !== undefined) {
          cancelAnimationFrame(timers.current.frame);
          timers.current.frame = undefined;
        }
        // The landing frame is already the resting slot to the last decimal
        // (the physics core's steered landing guarantees it), so clearing the
        // inline transform is a no-op ON SCREEN — but it hands the position
        // back to the LAYOUT, which is what has to own it once the card can
        // be resized, focused or re-flowed again.
        clearFlight();

        const final = Array.from({ length: count }, () => randomDie(faces));
        setPreview(null);
        setRolling(false);
        // Merge into the CURRENT config (F9-funn S#6): a count or die-type
        // change made during the throw must not be reverted by this stale
        // closure.
        updateWidgetConfigBy(widget.id, (c) =>
          c.kind === "dice" ? { ...c, lastRoll: final } : c,
        );
      },
      reduced ? SCRAMBLE_MS : THROW_MS,
    );
  };

  const setCount = (delta: number) => {
    const next = Math.min(
      Math.max(count + delta, LIMITS.DICE_MIN),
      LIMITS.DICE_MAX,
    );
    if (next === count) return;
    updateWidgetConfig(widget.id, { ...cfg, count: next, lastRoll: [] });
  };

  /** Cycle the die type. Clears the roll for the same reason the count knob
   *  does: three d6 faces showing 5-5-6 under a «D20» label is a lie about
   *  what the class just saw. */
  const cycleFaces = () => {
    updateWidgetConfig(widget.id, {
      ...cfg,
      faces: nextFaces(faces),
      lastRoll: [],
    });
  };

  const shown: (number | null)[] = preview
    ? preview
    : cfg.lastRoll.length === count
      ? cfg.lastRoll
      : Array.from({ length: count }, () => null);
  const sum = shown.every((v): v is number => v !== null)
    ? shown.reduce((a, b) => a + b, 0)
    : null;

  return (
    <div class={styles.dice} data-count={count} ref={cardRef}>
      <button
        class={styles.rollArea}
        ref={areaRef}
        data-no-drag
        data-value={
          preview === null && cfg.lastRoll.length === count
            ? cfg.lastRoll.join("-")
            : undefined
        }
        aria-label={t("dice.roll")}
        title={t("dice.roll")}
        disabled={rolling}
        onClick={roll}
      >
        {shown.map((v, i) => (
          <DieFace key={i} value={v} faces={faces} />
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
        {/* The die type shows its own value — «D20» IS the state, so the row
            needs no separate readout. The row is `width: max-content` with a
            max-width cap (WidgetShell.module.css), and three buttons measure
            ~120 px against the 154 px available on the 170 px minimum card:
            one line, pinned by e2e/dice.spec.ts. */}
        <button
          data-settings-btn
          data-dice-faces
          aria-label={t("dice.faces")}
          title={t("dice.faces")}
          onClick={cycleFaces}
        >
          {tf("dice.facesLabel", { n: faces })}
        </button>
      </div>
    </div>
  );
}
