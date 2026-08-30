// The group generator: the backend deals (seeded shuffle + round-robin, so
// sizes differ by at most one); the widget persists the resulting NAMES in
// its config — the class walks in to the same groups the projector showed
// yesterday.

import { useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf, tn } from "../../i18n";
import { LIMITS } from "@lib/limits.generated";
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
  const showPresence = present.length > 0 && present.length < pool.length;

  // A split that belongs to another class must not stand in front of this
  // one. EVERY name has to be a member here — `some` on a single match would
  // let a shared first name ("Emma" exists in both 8A and 9B) keep 8A's
  // whole board up in front of 9B. Non-destructive: switch back and the
  // groups are there again.
  const names = new Set(pool.map((m) => m.name));
  const stale = cfg.lastResult.some((g) => g.some((n) => !names.has(n)));
  const result = stale ? [] : cfg.lastResult;

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

  const setN = (delta: number) => {
    const n = Math.min(
      Math.max(cfg.n + delta, LIMITS.GROUP_N_MIN),
      LIMITS.GROUP_N_MAX,
    );
    updateWidgetConfig(widget.id, { ...cfg, n });
  };

  return (
    <div class={styles.groups}>
      <div
        class={styles.result}
        style={gridStyle(result.length, longestGroup(result))}
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
                {t("widget.noNames")}
              </button>
            ) : allAway ? (
              t("groups.allAway")
            ) : (
              t("groups.empty")
            )}
          </div>
        ) : (
          result.map((group, i) => (
            <section key={i} class={styles.group}>
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
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, mode: "count" })
          }
        >
          {t("groups.modeCount")}
        </button>
        <button
          data-settings-btn
          data-current={cfg.mode === "size" || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, mode: "size" })
          }
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

/**
 * Groups are laid out on a grid whose column count comes from HOW MANY
 * groups there are — flex-wrap gave 3-per-row always, so four groups broke
 * into 3 + 1 and the last one was clipped. Near-square reads best on a
 * board: 2→2, 3→3, 4→2×2, 5–6→3, 7–9→3, more→4.
 */
function gridStyle(count: number, longest: number): string {
  if (count === 0) return "";
  const cols = count <= 3 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  // Names shrink as the board fills up, so a big class in many groups still
  // fits without scrolling (a scrollbar is invisible from the back row).
  const crowding = Math.max(rows, Math.ceil(longest / 5));
  const scale =
    crowding <= 1 ? 1 : crowding === 2 ? 0.72 : crowding === 3 ? 0.56 : 0.45;
  return `grid-template-columns: repeat(${cols}, minmax(0, 1fr)); --group-scale: ${scale}`;
}

function longestGroup(groups: string[][]): number {
  return groups.reduce((max, g) => Math.max(max, g.length), 0);
}
