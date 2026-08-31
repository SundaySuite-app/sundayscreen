// The timer widget: huge derived digits, warn colour near zero, the chime
// on finish, and a stopwatch mode. The running state is EPHEMERAL by design
// (docs/DECISIONS.md ADR-003) — a restart shows the configured duration.

import { useEffect, useRef, useState } from "preact/hooks";

import type { TimerAction } from "../../bindings/TimerAction";
import type { TimerState } from "../../bindings/TimerState";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { LIMITS } from "@lib/limits.generated";
import { t, tf, tn } from "../../i18n";
import { formatMin } from "../../planner/date-core";
import { updateWidgetConfig } from "../../state/layout";
import { runningLessonEndMin } from "../../state/planner";
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

/**
 * Which preset steps aside for the «rest of the lesson» pill while a lesson
 * is running. FIVE means five — the count is the constraint, not the
 * contents — so the conditional pill REPLACES one rather than joining them.
 *
 * 15 is the one the row can spare. It is the only preset with a neighbour on
 * both sides (10 and 20 stay), so the ladder it leaves — 1 · 5 · 10 · 20 —
 * still covers a school hour end to end; and «kvarteret» is precisely the
 * length the new pill usually answers better anyway, because what the
 * teacher actually means by it is «until we are done here».
 */
const PRESET_REPLACED_BY_LESSON = 15;

/**
 * The backend clamps `durationMs` on the way in, so a value outside the
 * range would be shown on the board now and silently be a different number
 * after the next restart. Generated straight from layout.rs, so the two
 * sides cannot drift.
 */
const TIMER_MIN_MS = LIMITS.TIMER_MIN_MS;
const TIMER_MAX_MS = LIMITS.TIMER_MAX_MS;

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

  /** The ONE way the configured length is written — every caller goes through
   *  the clamp, so nothing can put a number here the backend would change. */
  const setDurationMs = (ms: number) => {
    updateWidgetConfig(widget.id, {
      ...cfg,
      durationMs: Math.min(Math.max(ms, TIMER_MIN_MS), TIMER_MAX_MS),
    });
  };

  const setDuration = (minutes: number) => setDurationMs(minutes * MINUTE_MS);

  /**
   * «Til timen slutter», computed the only way it can be right (R4-funn F4).
   *
   * Two bugs lived in the one-liner this replaces, and both of them put a
   * WRONG number on the board in front of a class:
   *
   *   - `lessonEndMin - minutesOfDay(new Date())` is minute arithmetic on a
   *     truncated clock. Pressed at 09:00:50 with the lesson ending at 09:15
   *     it answered 15 minutes — so the chime rang at 09:15:50, fifty seconds
   *     after the label on the pill said the lesson was over. Whole minutes in,
   *     whole minutes out, and the seconds silently rounded the wrong way.
   *   - the pill's own visibility comes from `runningLessonEndMin`, which
   *     reads the planner's 30 s tick. For up to half a minute after a lesson
   *     ends the button is still on the row, and pressing it asked for a
   *     NEGATIVE remainder — which the clamp turned into `TIMER_MIN_MS`, i.e.
   *     a five-second countdown starting the instant she pressed it.
   *
   * So: the end is an EPOCH built from the wall clock at click time (`setHours`
   * on today's date, which is DST-correct in a way midnight + minutes is not),
   * the remainder is milliseconds and is used as milliseconds — 14:10 left
   * means 14:10 on the board — and a pill that has outlived its lesson does
   * NOTHING AT ALL rather than something wrong. Doing nothing is the honest
   * answer: within 30 s the button disappears on its own.
   */
  const setDurationToLessonEnd = (endMin: number) => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
    const restMs = end.getTime() - now.getTime();
    if (restMs < TIMER_MIN_MS) return;
    setDurationMs(restMs);
  };

  const setMode = (mode: "countdown" | "stopwatch") => {
    if (mode === cfg.mode) return;
    setState({ phase: "idle" });
    updateWidgetConfig(widget.id, { ...cfg, mode });
  };

  // The app has known when the lesson ends since the planner landed, and has
  // never said it: «vi har tjueto minutter igjen» was start-then-adjust.
  // `null` whenever no lesson is running — the pill cannot appear on a
  // Saturday, in a break, or in front of a lesson that has not started.
  const lessonEndMin = runningLessonEndMin.value;
  const presets =
    lessonEndMin == null
      ? PRESET_MINUTES
      : PRESET_MINUTES.filter((m) => m !== PRESET_REPLACED_BY_LESSON);

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
          presets.map((m) => (
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
        {/*
         * «Til timen slutter», in one click.
         *
         * The face is the END TIME, not a sentence: at 13 px the row has
         * room for ~236 px of buttons at the timer's 260 px minimum, and
         * four pills plus «Til 09:15» measures past that — the sixth-pill
         * wrap the comment above warns about, arriving through width instead
         * of count. `09:15` is five tabular glyphs, reads in the same
         * grammar as the numbers beside it, and the whole sentence is one
         * hover away in the label. What it can never be is ambiguous: the
         * pill only exists while that lesson is running.
         *
         * It sets `durationMs` and nothing else (ADR-003): a timer that is
         * already counting is never touched — this branch is idle-only —
         * and the remainder is read from the wall clock at CLICK time, not
         * from the render that drew the pill (see `setDurationToLessonEnd`,
         * which also refuses a pill that has outlived its lesson).
         */}
        {state.phase === "idle" &&
          cfg.mode === "countdown" &&
          lessonEndMin != null && (
            <button
              data-settings-btn
              aria-label={tf("timer.untilLessonEnd", {
                time: formatMin(lessonEndMin),
              })}
              title={tf("timer.untilLessonEnd", {
                time: formatMin(lessonEndMin),
              })}
              onClick={() => setDurationToLessonEnd(lessonEndMin)}
            >
              {formatMin(lessonEndMin)}
            </button>
          )}
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
