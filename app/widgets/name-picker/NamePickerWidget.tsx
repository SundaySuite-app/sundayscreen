// The name picker: the backend draws (and owns the no-repeat round in
// `draw_state`); the widget spins through names for suspense and persists
// the RESULT NAME in its config, so the projector shows the same pupil after
// a restart.

import { useEffect, useRef, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tn } from "../../i18n";
import { localDateStr } from "../../planner/date-core";
import { openAttendance, presentOn } from "../../state/attendance";
import { managePanelOpen, members } from "../../state/classes";
import {
  activeClass,
  updateWidgetConfig,
  updateWidgetConfigBy,
} from "../../state/layout";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
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
  const today = localDateStr(new Date());
  const present = presentOn(pool, today);
  // Three DIFFERENT emptinesses, and the class can tell them apart: no names
  // at all, everyone marked away, or a normal day. Before this, "everybody is
  // away" reached the widget as a rejected `picker_draw` swallowed into
  // console.warn — a dead button in front of a waiting class.
  const noNames = pool.length === 0;
  const allAway = !noNames && present.length === 0;
  // The honest line, and ONLY when it is needed: with nobody marked away this
  // is zero pixels, and with someone marked away the teacher can see that the
  // draw is leaving people out. A silent filter would be worse than none.
  const showPresence = present.length > 0 && present.length < pool.length;

  // A name that does NOT belong to the class on screen must not stand on the
  // board (switch 8A → 9B and 8A's drawn pupil used to stay up in front of
  // 9B). A render GUARD, not a config wipe: switching back to 8A shows her
  // again, it covers both switch paths — the banner and the menu — and it
  // takes the deleted-pupil case (v1-funn U#19) with it for free.
  const names = new Set(pool.map((m) => m.name));
  const stale = cfg.lastDrawn !== null && !names.has(cfg.lastDrawn);

  const draw = async () => {
    const cls = activeClass.peek();
    if (!cls || spinning || present.length === 0) return;
    setSpinning(true);
    setRound(null);
    try {
      // The date is minted HERE, per click — a machine left on overnight
      // must not deal yesterday's absences into this morning's lesson.
      const result = await window.api.pickerDraw(
        cls.id,
        cfg.noRepeat,
        localDateStr(new Date()),
      );
      // The spin teases from the PRESENT pupils only: flashing a name the
      // draw can never land on is a small lie the front row reads.
      const spinNames = present.map((m) => m.name);
      timers.current.interval = setInterval(() => {
        setPreview(
          spinNames[Math.floor(Math.random() * spinNames.length)] ?? null,
        );
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
      // The button comes back FIRST — a teacher standing in front of the
      // class has to be able to press it again — and the sentence follows.
      // A failed draw used to be a dead press and a console line nobody in a
      // classroom has open (funn U#7).
      setSpinning(false);
      toast("error", t("manage.actionFailed"));
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
      // A round that did NOT reset must not look like one that did.
      toast("error", t("manage.actionFailed"));
    }
  };

  const shown = spinning ? preview : stale ? null : (cfg.lastDrawn ?? null);

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

      {cfg.noRepeat && round && !spinning && !stale && (
        <div class={styles.round}>
          {round.reshuffled
            ? t("picker.newRound")
            : round.remaining === 0
              ? t("picker.roundDone")
              : tn("picker.remaining", round.remaining)}
        </div>
      )}
      {/* «Legg inn navn» was a dead end printed on the board. It is the one
          thing the teacher has to do next, so it is a DOOR. Muted, no gold
          CTA: this stands on a projector in front of a class. `data-no-drag`
          is mandatory — `.result`/the widget body is the drag surface. */}
      {noNames && (
        <button
          class={`${styles.hint} ${styles.door}`}
          data-no-drag
          onClick={() => {
            managePanelOpen.value = true;
          }}
        >
          {t("widget.noNames")}
        </button>
      )}
      {allAway && <div class={styles.hint}>{t("picker.allAway")}</div>}
      {showPresence && (
        <div class={styles.presence}>
          {tn("attendance.presentCount", present.length, {
            total: pool.length,
          })}
        </div>
      )}

      <button
        class={styles.draw}
        data-no-drag
        disabled={spinning || present.length === 0}
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
        <button data-settings-btn onClick={openAttendance}>
          {t("attendance.open")}
        </button>
        <button
          data-settings-btn
          aria-label={t("picker.reset")}
          title={t("picker.reset")}
          onClick={() => void resetRound()}
        >
          <Icon name="rotate" size="sm" />
        </button>
      </div>
    </div>
  );
}
