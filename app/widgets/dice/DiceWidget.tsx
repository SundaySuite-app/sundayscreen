// The dice: fully frontend (OS entropy via crypto), animated with a short
// pip-scramble, and the LAST ROLL persisted in the config so the board still
// shows it after a restart.

import { useEffect, useRef, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import styles from "./dice.module.css";

const ROLL_MS = 600;
const ROLL_STEP_MS = 70;

function randomDie(): number {
  return 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 6);
}

/** Pip coordinates per value, on a 100×100 face. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [30, 30],
    [70, 70],
  ],
  3: [
    [30, 30],
    [50, 50],
    [70, 70],
  ],
  4: [
    [30, 30],
    [70, 30],
    [30, 70],
    [70, 70],
  ],
  5: [
    [30, 30],
    [70, 30],
    [50, 50],
    [30, 70],
    [70, 70],
  ],
  6: [
    [30, 30],
    [70, 30],
    [30, 50],
    [70, 50],
    [30, 70],
    [70, 70],
  ],
};

function DieFace({ value }: { value: number | null }) {
  return (
    <svg class={styles.die} viewBox="0 0 100 100">
      <rect x="4" y="4" width="92" height="92" rx="18" class={styles.face} />
      {value === null ? (
        <text x="50" y="64" class={styles.unknown} text-anchor="middle">
          ?
        </text>
      ) : (
        (PIPS[value] ?? []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="9" class={styles.pip} />
        ))
      )}
    </svg>
  );
}

export function DiceWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "dice") return null;

  const [rolling, setRolling] = useState(false);
  const [preview, setPreview] = useState<number[] | null>(null);
  const timers = useRef<{
    interval?: ReturnType<typeof setInterval>;
    timeout?: ReturnType<typeof setTimeout>;
  }>({});

  useEffect(
    () => () => {
      if (timers.current.interval) clearInterval(timers.current.interval);
      if (timers.current.timeout) clearTimeout(timers.current.timeout);
    },
    [],
  );

  const count = cfg.count;

  const roll = () => {
    if (rolling) return;
    setRolling(true);
    timers.current.interval = setInterval(() => {
      setPreview(Array.from({ length: count }, randomDie));
    }, ROLL_STEP_MS);
    timers.current.timeout = setTimeout(() => {
      if (timers.current.interval) clearInterval(timers.current.interval);
      const final = Array.from({ length: count }, randomDie);
      setPreview(null);
      setRolling(false);
      updateWidgetConfig(widget.id, { ...cfg, lastRoll: final });
    }, ROLL_MS);
  };

  const setCount = (delta: number) => {
    const next = Math.min(Math.max(count + delta, 1), 3);
    if (next === count) return;
    updateWidgetConfig(widget.id, { ...cfg, count: next, lastRoll: [] });
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
    <div class={styles.dice}>
      <button
        class={styles.rollArea}
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
          <DieFace key={i} value={v} />
        ))}
      </button>
      {count > 1 && sum !== null && !rolling && (
        <div class={styles.sum}>{tf("dice.sum", { n: sum })}</div>
      )}

      <div class={styles.settings} data-no-drag>
        <button
          class={styles.toggleBtn}
          aria-label={t("dice.fewer")}
          title={t("dice.fewer")}
          onClick={() => setCount(-1)}
        >
          −
        </button>
        <button
          class={styles.toggleBtn}
          aria-label={t("dice.more")}
          title={t("dice.more")}
          onClick={() => setCount(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
