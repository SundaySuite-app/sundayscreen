// The timer widget: huge derived digits, warn colour near zero, the chime
// on finish, and a stopwatch mode. The running state is EPHEMERAL by design
// (docs/DECISIONS.md ADR-003) — a restart shows the configured duration.

import { useEffect, useRef, useState } from "preact/hooks";

import type { TimerAction } from "../../bindings/TimerAction";
import type { TimerState } from "../../bindings/TimerState";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tn } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import { Icon } from "../../ui/Icon";
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

/** One minute, the unit of both the presets and the ± while running. */
const MINUTE_MS = 60_000;

/**
 * The lengths a school day actually asks for. FIVE, not six: the row already
 * carries three 36 px icon buttons and the timer's minimum width is 260 px,
 * so a sixth pill is what pushes the digits onto a second line.
 *
 * These REPLACE the old ±1-minute pair that stood in `.controls`. That row
 * is on the projector permanently, in front of the class — «dere får tjue
 * minutter» cost fifteen clicks there; here it is one, and the fine
 * adjustment moved to where it is actually needed (see below).
 */
const PRESET_MINUTES = [1, 5, 10, 15, 20];

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

  const act = (action: TimerAction) => {
    setState(
      transition(
        stateRef.current,
        action,
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

  const setDuration = (minutes: number) => {
    updateWidgetConfig(widget.id, { ...cfg, durationMs: minutes * MINUTE_MS });
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
          <button class={styles.primary} onClick={() => act({ type: "start" })}>
            {t("timer.start")}
          </button>
        )}
        {(state.phase === "running" || state.phase === "swRunning") && (
          <>
            <button
              class={styles.primary}
              onClick={() => act({ type: "pause" })}
            >
              {t("timer.pause")}
            </button>
            <button
              class={styles.secondary}
              onClick={() => act({ type: "reset" })}
            >
              {t("timer.reset")}
            </button>
          </>
        )}
        {(state.phase === "paused" || state.phase === "swPaused") && (
          <>
            <button
              class={styles.primary}
              onClick={() => act({ type: "resume" })}
            >
              {t("timer.resume")}
            </button>
            <button
              class={styles.secondary}
              onClick={() => act({ type: "reset" })}
            >
              {t("timer.reset")}
            </button>
          </>
        )}
        {state.phase === "finished" && (
          <button class={styles.primary} onClick={() => act({ type: "reset" })}>
            {t("timer.reset")}
          </button>
        )}
      </div>

      {/*
       * The row is PHASE-DRIVEN, and the two groups can never stand at the
       * same time: before the start you choose a LENGTH, after it you move
       * the FINISH LINE. Both live here rather than in `.controls` because
       * that row stands permanently in front of the class, and a teacher who
       * needs either of these already has the mouse on the widget.
       *
       * Free consequence of the adjust action: lifting the remainder back
       * above `warnAtMs` flips `tone` from `warn` to `calm` on its own — the
       * amber stops claiming there is a hurry the extra minutes just removed.
       *
       * Deliberately outside: adjusting from `finished`. That is a different
       * edge for a rarer case.
       */}
      <div data-settings-row data-no-drag>
        {state.phase === "idle" &&
          cfg.mode === "countdown" &&
          PRESET_MINUTES.map((m) => (
            <button
              key={m}
              data-settings-btn
              data-current={cfg.durationMs === m * MINUTE_MS || undefined}
              aria-label={tn("timer.presetMinutes", m)}
              title={tn("timer.presetMinutes", m)}
              onClick={() => setDuration(m)}
            >
              {m}
            </button>
          ))}
        {(state.phase === "running" || state.phase === "paused") &&
          cfg.mode === "countdown" && (
            <>
              <button
                data-settings-btn
                aria-label={t("timer.minusMinute")}
                title={t("timer.minusMinute")}
                onClick={() => act({ type: "adjust", deltaMs: -MINUTE_MS })}
              >
                <Icon name="minus" size="sm" />
              </button>
              <button
                data-settings-btn
                aria-label={t("timer.plusMinute")}
                title={t("timer.plusMinute")}
                onClick={() => act({ type: "adjust", deltaMs: MINUTE_MS })}
              >
                <Icon name="plus" size="sm" />
              </button>
            </>
          )}
        <button
          data-settings-btn
          data-current={cfg.mode === "countdown" || undefined}
          aria-label={t("timer.modeCountdown")}
          title={t("timer.modeCountdown")}
          onClick={() => setMode("countdown")}
        >
          <Icon name="hourglass" size="sm" />
        </button>
        <button
          data-settings-btn
          data-current={cfg.mode === "stopwatch" || undefined}
          aria-label={t("timer.modeStopwatch")}
          title={t("timer.modeStopwatch")}
          onClick={() => setMode("stopwatch")}
        >
          <Icon name="timer" size="sm" />
        </button>
        <button
          data-settings-btn
          aria-label={t("timer.sound")}
          title={t("timer.sound")}
          aria-pressed={cfg.soundOn}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, soundOn: !cfg.soundOn })
          }
        >
          <Icon name={cfg.soundOn ? "bell" : "bell-off"} size="sm" />
        </button>
      </div>
    </div>
  );
}
