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
import {
  managePanelOpen,
  members,
  membersReadFailed,
} from "../../state/classes";
import { activeClass, updateWidgetConfigBy } from "../../state/layout";
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
      <div class={styles.result} style={gridStyle(result)}>
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
              data-split={splittable(result) || undefined}
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

/**
 * From how many names to split a panel into two columns.
 *
 * The container query in the stylesheet owns the other half of the decision
 * (is the panel wide enough), and this is the half it cannot see: below eight
 * names the second column halves the width each name gets before it has
 * halved enough lines to pay for it, so the split makes the type SMALLER.
 */
const SPLIT_MIN_NAMES = 8;

/** How long a name the width term budgets for. The floor keeps a class of
 *  «Bo» and «Li» from turning two names into a poster; the ceiling keeps one
 *  outlier from shrinking the whole board. */
const NAME_CHARS_MIN = 6;
const NAME_CHARS_MAX = 18;

/**
 * Groups are laid out on a grid whose column count comes from HOW MANY
 * groups there are — flex-wrap gave 3-per-row always, so four groups broke
 * into 3 + 1 and the last one was clipped. Near-square reads best on a
 * board: 2→2, 3→3, 4→2×2, 5–6→3, 7–9→3, more→4.
 *
 * Rows are spelled out as `1fr` for the same reason the panels are size
 * containers (see groups.module.css): a panel with `contain: size` no longer
 * grows to its names, so the row heights have to be the grid's decision, and
 * equal rows are what makes one shared name size honest.
 *
 * The three custom properties are the INPUTS to the size formula — the counts
 * CSS cannot work out for itself. Nothing here is a font size: what a name
 * measures is decided in the stylesheet, against the panel it stands in.
 */
function gridStyle(groups: string[][]): string {
  const count = groups.length;
  if (count === 0) return "";
  const cols = count <= 3 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const lines = longestGroup(groups);
  const chars = Math.min(
    Math.max(longestName(groups), NAME_CHARS_MIN),
    NAME_CHARS_MAX,
  );
  return [
    `grid-template-columns: repeat(${cols}, minmax(0, 1fr))`,
    `grid-template-rows: repeat(${rows}, minmax(0, 1fr))`,
    `--lines: ${lines}`,
    `--lines-split: ${Math.ceil(lines / 2)}`,
    `--name-chars: ${chars}`,
  ].join("; ");
}

function longestGroup(groups: string[][]): number {
  return groups.reduce((max, g) => Math.max(max, g.length), 0);
}

function longestName(groups: string[][]): number {
  return groups.reduce(
    (max, g) => g.reduce((m, n) => Math.max(m, n.length), max),
    0,
  );
}

/** Are the panels crowded enough for the two-column layout to be worth
 *  asking the container about? */
function splittable(groups: string[][]): boolean {
  return longestGroup(groups) >= SPLIT_MIN_NAMES;
}
