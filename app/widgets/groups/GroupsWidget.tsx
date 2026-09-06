// The group generator: the backend deals (seeded shuffle + round-robin, so
// sizes differ by at most one); the widget persists the resulting NAMES in
// its config — the class walks in to the same groups the projector showed
// yesterday.

import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf, tn } from "../../i18n";
import { LIMITS } from "@lib/limits.generated";
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
import {
  type Box,
  chooseLayout,
  gridStyle,
  longestGroup,
  longestNameEm,
} from "./groups-fit-core";
import { adoptChipFont, measureEpoch, nameEm } from "./groups-measure";
import styles from "./groups.module.css";

export function GroupsWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "groups") return null;

  const [busy, setBusy] = useState(false);
  const pool = members.value;
  const today = localDateStr(new Date());
  const present = presentOn(pool, today);
  const noNames = pool.length === 0;
  const allAway = !noNames && present.length === 0;
  // «Kunne ikke leses» is not «finnes ikke» (R4-funn E2-20) — the picker
  // carries the same distinction and the same reasoning: a failed
  // `members_get` empties the pool on purpose, and telling a teacher to add
  // names she already has sends her to a panel that will refuse to save them.
  const namesUnread = noNames && membersReadFailed.value;
  const showPresence = present.length > 0 && present.length < pool.length;

  // A split that belongs to another class must not stand in front of this
  // one. EVERY name has to be a member here — `some` on a single match would
  // let a shared first name ("Emma" exists in both 8A and 9B) keep 8A's
  // whole board up in front of 9B. Non-destructive: switch back and the
  // groups are there again.
  const names = new Set(pool.map((m) => m.name));
  const stale = cfg.lastResult.some((g) => g.some((n) => !names.has(n)));
  const result = stale ? [] : cfg.lastResult;

  // The size formula's inputs (groups-fit-core). The board's widest name is
  // MEASURED — `measureEpoch` is the subscription that re-measures when the
  // font settles — and one-column-or-two is decided from the panel's own
  // content box, which is the one number the formula in the stylesheet
  // cannot compare against itself.
  void measureEpoch.value;
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [panelBox, setPanelBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const panel = resultRef.current?.querySelector("section");
    if (!panel) return;
    // Font first: the chip is in the DOM now, and the stylesheet has given
    // it the weight the canvas has to measure with.
    const chip = panel.querySelector("li");
    if (chip) adoptChipFont(chip);
    if (typeof ResizeObserver === "undefined") return;
    // Every panel is the same box (`1fr` rows and columns), so one observer
    // on the first is the measurement for all. The content box is what the
    // stylesheet's `cqw`/`cqh` resolve against; `contentRect` is the same
    // box without the array-of-sizes ceremony. No feedback: the panel's
    // size comes from the card and the group count, never from the font it
    // ends up with — `.group` is a size container precisely so that it does
    // not grow to its names.
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setPanelBox((prev) =>
        prev && prev.w === w && prev.h === h ? prev : { w, h },
      );
    });
    ro.observe(panel);
    return () => ro.disconnect();
  }, [result.length]);
  const fit = chooseLayout(
    panelBox,
    longestGroup(result),
    longestNameEm(result, nameEm),
  );

  const doSplit = async () => {
    const cls = activeClass.peek();
    if (!cls || busy || present.length === 0) return;
    setBusy(true);
    try {
      // Minted per click, not per module load — see NamePickerWidget.
      const groups = await window.api.groupsSplit(
        cls.id,
        cfg.mode,
        cfg.n,
        localDateStr(new Date()),
      );
      // Merge into the CURRENT config (F9-funn S#6).
      updateWidgetConfigBy(widget.id, (c) =>
        c.kind === "groups"
          ? { ...c, lastResult: groups.map((g) => g.map((m) => m.name)) }
          : c,
      );
    } catch (e) {
      console.warn("[groups] split failed", e);
      // «Del inn» that does nothing is indistinguishable from a slow one:
      // say it, in the same words the manage panel uses (funn U#7).
      toast("error", t("manage.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The stepper, merged into the CURRENT config (R4-funn E1-L9, the S#6
   * pattern the name picker's `setCount` carries the full account of).
   *
   * It used to spread `cfg` — the config from the render the teacher is
   * looking at — which makes the press a REPLACE of the whole object rather
   * than an edit of one field. `doSplit` lands asynchronously and writes
   * `lastResult`; a `{ ...cfg, n }` built before it landed puts the PREVIOUS
   * split straight back, so the groups the class just read off the board
   * revert — and the second promise makes that permanent.
   */
  const setN = (delta: number) => {
    updateWidgetConfigBy(widget.id, (c) =>
      c.kind === "groups"
        ? {
            ...c,
            n: Math.min(
              Math.max(c.n + delta, LIMITS.GROUP_N_MIN),
              LIMITS.GROUP_N_MAX,
            ),
          }
        : c,
    );
  };

  /** «Antall grupper» / «Gruppestørrelse», on the same terms as the stepper:
   *  one field, never a replace of a config a landing split is writing. */
  const setMode = (mode: "count" | "size") => {
    updateWidgetConfigBy(widget.id, (c) =>
      c.kind === "groups" ? { ...c, mode } : c,
    );
  };

  return (
    <div class={styles.groups}>
      <div
        ref={resultRef}
        class={styles.result}
        style={gridStyle(result.length, fit)}
      >
        {result.length === 0 ? (
          <div class={styles.empty}>
            {noNames ? (
              // A door, not a message — see NamePickerWidget. `.result` is
              // part of the drag surface, so `data-no-drag` is mandatory.
              <button
                class={styles.door}
                data-no-drag
                onClick={() => {
                  managePanelOpen.value = true;
                }}
              >
                {namesUnread
                  ? t("widget.namesReadFailed")
                  : t("widget.noNames")}
              </button>
            ) : allAway ? (
              t("groups.allAway")
            ) : (
              t("groups.empty")
            )}
          </div>
        ) : (
          result.map((group, i) => (
            <section
              key={i}
              class={styles.group}
              data-split={fit.cols === 2 || undefined}
            >
              <h3 class={styles.groupTitle}>
                {tf("groups.header", { n: i + 1 })}
              </h3>
              <ul class={styles.chips}>
                {group.map((name, j) => (
                  <li key={j} class={styles.chip}>
                    {name}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {showPresence && (
        <div class={styles.presence}>
          {tn("attendance.presentCount", present.length, {
            total: pool.length,
          })}
        </div>
      )}

      {/* «Del inn» STAYS on the board — it is the widget's primary action.
          Everything else moved into the hover row below. */}
      <div class={styles.controls} data-no-drag>
        <button
          class={styles.split}
          disabled={busy || present.length === 0}
          onClick={() => void doSplit()}
        >
          {t("groups.split")}
        </button>
      </div>

      {/* Five permanent controls became one hover row. The class used to
          look at two mode buttons and a stepper for the whole lesson; the
          shell's contract has always been that a widget's settings appear
          when the teacher reaches for them. */}
      <div data-settings-row data-no-drag>
        <button
          data-settings-btn
          data-current={cfg.mode === "count" || undefined}
          onClick={() => setMode("count")}
        >
          {t("groups.modeCount")}
        </button>
        <button
          data-settings-btn
          data-current={cfg.mode === "size" || undefined}
          onClick={() => setMode("size")}
        >
          {t("groups.modeSize")}
        </button>
        <button
          data-settings-btn
          aria-label={t("groups.decrease")}
          title={t("groups.decrease")}
          onClick={() => setN(-1)}
        >
          <Icon name="minus" size="sm" />
        </button>
        <span class={styles.n}>{cfg.n}</span>
        <button
          data-settings-btn
          aria-label={t("groups.increase")}
          title={t("groups.increase")}
          onClick={() => setN(1)}
        >
          <Icon name="plus" size="sm" />
        </button>
        <button data-settings-btn onClick={openAttendance}>
          {t("attendance.open")}
        </button>
      </div>
    </div>
  );
}
