// The group generator: the backend deals (seeded shuffle + round-robin, so
// sizes differ by at most one); the widget persists the resulting NAMES in
// its config — the class walks in to the same groups the projector showed
// yesterday.

import { useState } from "preact/hooks";

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t, tf } from "../../i18n";
import { members } from "../../state/classes";
import {
  activeClass,
  updateWidgetConfig,
  updateWidgetConfigBy,
} from "../../state/layout";
import styles from "./groups.module.css";

export function GroupsWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "groups") return null;

  const [busy, setBusy] = useState(false);
  const empty = members.value.length === 0;

  const doSplit = async () => {
    const cls = activeClass.peek();
    if (!cls || busy || empty) return;
    setBusy(true);
    try {
      const groups = await window.api.groupsSplit(cls.id, cfg.mode, cfg.n);
      // Merge into the CURRENT config (F9-funn S#6).
      updateWidgetConfigBy(widget.id, (c) =>
        c.kind === "groups"
          ? { ...c, lastResult: groups.map((g) => g.map((m) => m.name)) }
          : c,
      );
    } catch (e) {
      console.warn("[groups] split failed", e);
    } finally {
      setBusy(false);
    }
  };

  const setN = (delta: number) => {
    const n = Math.min(Math.max(cfg.n + delta, 2), 30);
    updateWidgetConfig(widget.id, { ...cfg, n });
  };

  return (
    <div class={styles.groups}>
      <div class={styles.result}>
        {cfg.lastResult.length === 0 ? (
          <div class={styles.empty}>
            {empty ? t("widget.noNames") : t("groups.empty")}
          </div>
        ) : (
          cfg.lastResult.map((group, i) => (
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

      <div class={styles.controls} data-no-drag>
        <button
          class={styles.modeBtn}
          data-current={cfg.mode === "count" || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, mode: "count" })
          }
        >
          {t("groups.modeCount")}
        </button>
        <button
          class={styles.modeBtn}
          data-current={cfg.mode === "size" || undefined}
          onClick={() =>
            updateWidgetConfig(widget.id, { ...cfg, mode: "size" })
          }
        >
          {t("groups.modeSize")}
        </button>
        <span class={styles.stepper}>
          <button
            class={styles.step}
            aria-label={t("groups.decrease")}
            onClick={() => setN(-1)}
          >
            −
          </button>
          <span class={styles.n}>{cfg.n}</span>
          <button
            class={styles.step}
            aria-label={t("groups.increase")}
            onClick={() => setN(1)}
          >
            +
          </button>
        </span>
        <button
          class={styles.split}
          disabled={busy || empty}
          onClick={() => void doSplit()}
        >
          {t("groups.split")}
        </button>
      </div>
    </div>
  );
}
