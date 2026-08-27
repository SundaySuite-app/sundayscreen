// The timer widget: huge derived digits, warn colour near zero, the chime
// on finish, and a stopwatch mode. The running state is EPHEMERAL by design
// (docs/DECISIONS.md ADR-003) — a restart shows the configured duration.

import { useEffect, useRef, useState } from "preact/hooks";

import type { TimerState } from "../../bindings/TimerState";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import { playChime } from "./chime";
import styles from "./timer.module.css";
import {
  displayMs,
  formatClock,
  isCountdownFamily,
  tick,
  transition,
} from "./timer-core";

/** How often the display re-derives while running. The value shown is
 *  DERIVED from the wall clock either way — this only paces the paint (and
 *  catches the zero-crossing; a throttled background tab just derives a
 *  bigger jump on its next tick). */
const TICK_MS = 200;

/** The duration buttons step by a minute and stop at one. */
const STEP_MS = 60_000;
const BUTTON_MIN_MS = 60_000;
const BUTTON_MAX_MS = 86_400_000;

export function TimerWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "timer") return null;

  const [state, setState] = useState<TimerState>({ phase: "idle" });
  const [, force] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const soundOnRef = useRef(cfg.soundOn);
  soundOnRef.current = cfg.soundOn;

  const running = state.phase === "running" || state.phase === "swRunning";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { state: next, sound } = tick(stateRef.current, Date.now());
      if (next !== stateRef.current) {
        setState(next);
        if (sound && soundOnRef.current) playChime();
      } else {
        force((n) => n + 1);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const act = (type: "start" | "pause" | "resume" | "reset") => {
    setState(
      transition(
        stateRef.current,
        { type },
        cfg.mode,
        cfg.durationMs,
        Date.now(),
      ),
    );
  };

  const now = Date.now();
  const ms = displayMs(state, cfg.mode, cfg.durationMs, now);
  const seconds = isCountdownFamily(state, cfg.mode)
    ? Math.ceil(ms / 1000)
    : Math.floor(ms / 1000);

  const tone =
    state.phase === "finished"
      ? "done"
      : (state.phase === "running" || state.phase === "paused") &&
          ms <= cfg.warnAtMs &&
          ms > 0
        ? "warn"
        : "calm";

  const adjust = (delta: number) => {
    const durationMs = Math.min(
      Math.max(cfg.durationMs + delta, BUTTON_MIN_MS),
      BUTTON_MAX_MS,
    );
    updateWidgetConfig(widget.id, { ...cfg, durationMs });
  };

  const setMode = (mode: "countdown" | "stopwatch") => {
    if (mode === cfg.mode) return;
    setState({ phase: "idle" });
    updateWidgetConfig(widget.id, { ...cfg, mode });
  };

  return (
    <div class={styles.timer} data-tone={tone}>
      <div class={styles.display}>{formatClock(seconds)}</div>

      <div class={styles.controls} data-no-drag>
        {state.phase === "idle" && (
          <>
            {cfg.mode === "countdown" && (
              <>
                <button
                  class={styles.small}
                  aria-label={t("timer.minusMinute")}
                  title={t("timer.minusMinute")}
                  onClick={() => adjust(-STEP_MS)}
                >
                  −
                </button>
                <button
                  class={styles.small}
                  aria-label={t("timer.plusMinute")}
                  title={t("timer.plusMinute")}
                  onClick={() => adjust(STEP_MS)}
                >
                  +
                </button>
              </>
            )}
            <button class={styles.primary} onClick={() => act("start")}>
              {t("timer.start")}
            </button>
          </>
        )}
        {(state.phase === "running" || state.phase === "swRunning") && (
          <>
            <button class={styles.primary} onClick={() => act("pause")}>
              {t("timer.pause")}
            </button>
            <button class={styles.secondary} onClick={() => act("reset")}>
              {t("timer.reset")}
            </button>
          </>
        )}
        {(state.phase === "paused" || state.phase === "swPaused") && (
          <>
            <button class={styles.primary} onClick={() => act("resume")}>
              {t("timer.resume")}
            </button>
            <button class={styles.secondary} onClick={() => act("reset")}>
              {t("timer.reset")}
            </button>
          </>
        )}
        {state.phase === "finished" && (
          <button class={styles.primary} onClick={() => act("reset")}>
            {t("timer.reset")}
          </button>
        )}
      </div>

      <div class={styles.settings} data-no-drag>
        <button
          class={styles.modeBtn}
          data-current={cfg.mode === "countdown" || undefined}
          onClick={() => setMode("countdown")}
        >
          {t("timer.modeCountdown")}
        </button>
        <button
          class={styles.modeBtn}
          data-current={cfg.mode === "stopwatch" || undefined}
          onClick={() => setMode("stopwatch")}
        >
          {t("timer.modeStopwatch")}
        </button>
        <button
          class={styles.modeBtn}
          aria-label={t("timer.sound")}
          title={t("timer.sound")}
          aria-pressed={cfg.soundOn}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, soundOn: !cfg.soundOn })
          }
        >
          {cfg.soundOn ? "🔔" : "🔇"}
        </button>
      </div>
    </div>
  );
}
