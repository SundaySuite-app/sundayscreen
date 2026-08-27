// The name picker: the backend draws (and owns the no-repeat round in
// `draw_state`); the widget spins through names for suspense and persists
// the RESULT NAME in its config, so the projector shows the same pupil after
// a restart.

import { useEffect, useRef, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tn } from "../../i18n";
import { members } from "../../state/classes";
import {
  activeClass,
  updateWidgetConfig,
  updateWidgetConfigBy,
} from "../../state/layout";
import styles from "./name-picker.module.css";

/** How long the name-spin lasts. */
const SPIN_MS = 700;
const SPIN_STEP_MS = 60;

export function NamePickerWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "namepicker") return null;

  const [spinning, setSpinning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [round, setRound] = useState<{
    remaining: number;
    reshuffled: boolean;
  } | null>(null);
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

  const pool = members.value;
  const empty = pool.length === 0;

  const draw = async () => {
    const cls = activeClass.peek();
    if (!cls || spinning || empty) return;
    setSpinning(true);
    setRound(null);
    try {
      const result = await window.api.pickerDraw(cls.id, cfg.noRepeat);
      const names = members.peek().map((m) => m.name);
      timers.current.interval = setInterval(() => {
        setPreview(names[Math.floor(Math.random() * names.length)] ?? null);
      }, SPIN_STEP_MS);
      timers.current.timeout = setTimeout(() => {
        if (timers.current.interval) clearInterval(timers.current.interval);
        setPreview(null);
        setSpinning(false);
        setRound({
          remaining: result.remaining,
          reshuffled: result.reshuffled,
        });
        // Merge into the CURRENT config (F9-funn S#6): a no-repeat toggle
        // during the spin must not be reverted by this stale closure.
        updateWidgetConfigBy(widget.id, (c) =>
          c.kind === "namepicker" ? { ...c, lastDrawn: result.member.name } : c,
        );
      }, SPIN_MS);
    } catch (e) {
      console.warn("[picker] draw failed", e);
      setSpinning(false);
    }
  };

  const resetRound = async () => {
    const cls = activeClass.peek();
    if (!cls) return;
    try {
      await window.api.pickerReset(cls.id);
      setRound(null);
    } catch (e) {
      console.warn("[picker] reset failed", e);
    }
  };

  const shown = spinning ? preview : (cfg.lastDrawn ?? null);

  return (
    <div class={styles.picker}>
      <div
        class={styles.name}
        data-display
        data-empty={shown === null || undefined}
        data-spinning={spinning || undefined}
      >
        {shown ?? t("picker.ready")}
      </div>

      {cfg.noRepeat && round && !spinning && (
        <div class={styles.round}>
          {round.reshuffled
            ? t("picker.newRound")
            : round.remaining === 0
              ? t("picker.roundDone")
              : tn("picker.remaining", round.remaining)}
        </div>
      )}
      {empty && <div class={styles.hint}>{t("widget.noNames")}</div>}

      <button
        class={styles.draw}
        data-no-drag
        disabled={spinning || empty}
        onClick={() => void draw()}
      >
        {t("picker.draw")}
      </button>

      <div data-settings-row data-no-drag>
        <button
          data-settings-btn
          data-current={cfg.noRepeat || undefined}
          aria-pressed={cfg.noRepeat}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, noRepeat: !cfg.noRepeat })
          }
        >
          {t("picker.noRepeat")}
        </button>
        <button data-settings-btn onClick={() => void resetRound()}>
          {t("picker.reset")}
        </button>
      </div>
    </div>
  );
}
