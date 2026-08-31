// The name picker: the backend draws (and owns the no-repeat round in
// `draw_state`); the widget spins through names for suspense and persists
// the RESULT NAMES in its config, so the projector shows the same pupils
// after a restart.
//
// A draw may ask for up to `PICK_N_MAX` names at once. That is ONE backend
// call, not N — see `pickerDrawMany` in the shim for why a loop here would
// be wrong — and ONE spin, so the class sees the whole answer land together.

import { useEffect, useRef, useState } from "preact/hooks";

import { LIMITS } from "@lib/limits.generated";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tn } from "../../i18n";
import { localDateStr } from "../../planner/date-core";
import { openAttendance, presentOn } from "../../state/attendance";
import {
  managePanelOpen,
  members,
  membersReadFailed,
} from "../../state/classes";
import { activeClass, updateWidgetConfigBy } from "../../state/layout";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import styles from "./name-picker.module.css";

/** How long the name-spin lasts. */
const SPIN_MS = 700;
const SPIN_STEP_MS = 60;

/**
 * How much the drawn names shrink as more of them share the card — the group
 * generator's crowding ladder, one column instead of a grid. One name is
 * scale 1, i.e. exactly the size the widget has always drawn it at.
 *
 * The steps below three are not a curve, they are a MEASUREMENT: the base is
 * `cqmin`, which grows with the card, so a bigger card does not by itself buy
 * a fifth name any room — the binding case is the smallest card
 * (`minSizePx`, 380×260) with the round counter under the names, and these
 * are the largest values that still fit it. Bigger cards are left slightly
 * conservative on purpose; a clipped last name is worse than a small one.
 */
const PICK_SCALE = [1, 1, 0.72, 0.54, 0.4, 0.32];

function pickScale(count: number): number {
  return PICK_SCALE[Math.min(count, PICK_SCALE.length - 1)] ?? 1;
}

/** The stored count, inside the backend's range. Applied to the value READ
 *  from the config as well as to the new one: a config written by a newer
 *  build (or by hand) must not let a press carry an out-of-range number one
 *  step further out. */
function clampCount(n: number): number {
  return Math.min(Math.max(n, LIMITS.PICK_N_MIN), LIMITS.PICK_N_MAX);
}

export function NamePickerWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "namepicker") return null;

  const [spinning, setSpinning] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [round, setRound] = useState<{
    remaining: number;
    reshuffled: boolean;
    /** Fewer names came back than were asked for — the class is smaller. */
    short: boolean;
    drawn: number;
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
  // away" reached the widget as a rejected draw swallowed into console.warn —
  // a dead button in front of a waiting class.
  const noNames = pool.length === 0;
  const allAway = !noNames && present.length === 0;
  /**
   * FOUR emptinesses now, and the fourth is a lie the board used to tell
   * (R4-funn E1-L10). `loadMembers` empties `members` when `members_get`
   * REJECTS — deliberately, so nothing can write a list it never read — and
   * an empty pool reached the widget as «Legg inn navn i klassen først». On a
   * database that will not open, that sentence sends a teacher to a panel to
   * retype a class she has already entered, in front of the class, and the
   * panel then refuses to save it.
   *
   * Still a DOOR, and still to the same panel: the panel is where the failure
   * is explained and where the list lives. Only the sentence changes, from an
   * instruction to a fact.
   */
  const namesUnread = noNames && membersReadFailed.value;
  // The honest line, and ONLY when it is needed: with nobody marked away this
  // is zero pixels, and with someone marked away the teacher can see that the
  // draw is leaving people out. A silent filter would be worse than none.
  const showPresence = present.length > 0 && present.length < pool.length;

  // What the board remembers. `lastDrawnMany` is the whole draw; `lastDrawn`
  // is its first name, written alongside so an older build still shows
  // something true (see the config's doc comment). A config written BEFORE
  // multi-draw existed has only `lastDrawn` — reading it here is what keeps
  // promise 2 across the upgrade: the pupil on the board at 09:14 is still
  // there after the restart at 09:15.
  const remembered =
    cfg.lastDrawnMany.length > 0
      ? cfg.lastDrawnMany
      : cfg.lastDrawn !== null
        ? [cfg.lastDrawn]
        : [];

  // A name that does NOT belong to the class on screen must not stand on the
  // board (switch 8A → 9B and 8A's drawn pupil used to stay up in front of
  // 9B). EVERY name has to be a member here — `some` on a single match would
  // let a shared first name ("Emma" exists in both 8A and 9B) keep 8A's whole
  // draw up in front of 9B. A render GUARD, not a config wipe: switching back
  // to 8A shows them again, it covers both switch paths — the banner and the
  // menu — and it takes the deleted-pupil case (v1-funn U#19) with it.
  const names = new Set(pool.map((m) => m.name));
  const stale = remembered.some((n) => !names.has(n));

  const drawCount = clampCount(cfg.drawCount);

  const draw = async () => {
    const cls = activeClass.peek();
    if (!cls || spinning || present.length === 0) return;
    setSpinning(true);
    setRound(null);
    try {
      // The date is minted HERE, per click — a machine left on overnight
      // must not deal yesterday's absences into this morning's lesson.
      const result = await window.api.pickerDrawMany(
        cls.id,
        cfg.noRepeat,
        drawCount,
        localDateStr(new Date()),
      );
      const drawn = result.members.map((m) => m.name);
      // The spin teases from the PRESENT pupils only: flashing a name the
      // draw can never land on is a small lie the front row reads. ONE spin
      // for the whole draw — every name is already decided, and 700 ms per
      // pupil in front of a class is a wait, not suspense.
      const spinNames = present.map((m) => m.name);
      const tease = () =>
        drawn.map(
          () => spinNames[Math.floor(Math.random() * spinNames.length)] ?? "",
        );
      setPreview(tease());
      timers.current.interval = setInterval(
        () => setPreview(tease()),
        SPIN_STEP_MS,
      );
      timers.current.timeout = setTimeout(() => {
        if (timers.current.interval) clearInterval(timers.current.interval);
        setPreview(null);
        setSpinning(false);
        setRound({
          remaining: result.remaining,
          reshuffled: result.reshuffled,
          short: drawn.length < drawCount,
          drawn: drawn.length,
        });
        // Merge into the CURRENT config (F9-funn S#6): a no-repeat toggle or
        // a stepper press during the spin must not be reverted by this stale
        // closure. BOTH keys are written — see the config's doc comment.
        updateWidgetConfigBy(widget.id, (c) =>
          c.kind === "namepicker"
            ? { ...c, lastDrawn: drawn[0] ?? null, lastDrawnMany: drawn }
            : c,
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

  /**
   * The stepper, merged into the CURRENT config (R4-funn E1-L9, the S#6
   * pattern). It used to spread `cfg` — the config from the render the
   * teacher was looking at — which makes the press a REPLACE of the whole
   * object, not an edit of one field. A draw landing in the same frame writes
   * `lastDrawnMany`; a `{ ...cfg, drawCount }` built before it would put the
   * previous draw straight back, so the name on the board in front of the
   * class silently reverted to the last one. Same discipline as `draw`'s own
   * write, and for the same reason.
   */
  const setCount = (delta: number) => {
    updateWidgetConfigBy(widget.id, (c) =>
      c.kind === "namepicker"
        ? { ...c, drawCount: clampCount(clampCount(c.drawCount) + delta) }
        : c,
    );
  };

  /** «Ingen gjentak», on the same terms as the stepper above: a toggle is an
   *  edit of ONE field, never a replace of the config a spin is about to
   *  write into. */
  const toggleNoRepeat = () => {
    updateWidgetConfigBy(widget.id, (c) =>
      c.kind === "namepicker" ? { ...c, noRepeat: !c.noRepeat } : c,
    );
  };

  const shown = spinning ? (preview ?? []) : stale ? [] : remembered;

  return (
    <div class={styles.picker}>
      <div
        class={styles.display}
        data-display
        data-empty={shown.length === 0 || undefined}
        data-spinning={spinning || undefined}
        style={`--pick-scale: ${pickScale(shown.length)}`}
      >
        {shown.length === 0
          ? t("picker.ready")
          : shown.map((name, i) => (
              <div key={i} class={styles.name}>
                {name}
              </div>
            ))}
      </div>

      {round && !spinning && !stale && (round.short || cfg.noRepeat) && (
        <div class={styles.round}>
          {round.short
            ? // Asked for more names than there are pupils here. The board
              // shows fewer, and saying why beats letting the teacher wonder
              // whether the draw half-failed.
              tn("picker.drewFewer", round.drawn)
            : round.reshuffled
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
          {namesUnread ? t("widget.namesReadFailed") : t("widget.noNames")}
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

      {/* The button KEEPS its name at every count. «Trekk 3 navn» would be a
          second button name to match on in a suite of tests that all reach
          for «Trekk navn» — and on the board the number is already visible,
          in the stepper the teacher just set it with. */}
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
          onClick={toggleNoRepeat}
        >
          {t("picker.noRepeat")}
        </button>
        {/* A compact stepper, not one chip per number: five chips measure
            ~200 px and push the row onto a third line at the card's minimum
            width. */}
        <button
          data-settings-btn
          aria-label={t("picker.decrease")}
          title={t("picker.decrease")}
          onClick={() => setCount(-1)}
        >
          <Icon name="minus" size="sm" />
        </button>
        <span class={styles.n} data-draw-count={drawCount}>
          {drawCount}
        </span>
        <button
          data-settings-btn
          aria-label={t("picker.increase")}
          title={t("picker.increase")}
          onClick={() => setCount(1)}
        >
          <Icon name="plus" size="sm" />
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
