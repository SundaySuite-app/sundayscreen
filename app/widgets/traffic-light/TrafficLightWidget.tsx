// The traffic light: three lamps, click the one that should shine. The
// active colour is config — a restart mid-lesson shows the same light.

import type { TrafficColor } from "../../bindings/TrafficColor";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import styles from "./traffic-light.module.css";

const LAMPS: { color: TrafficColor; labelKey: string }[] = [
  { color: "red", labelKey: "traffic.red" },
  { color: "yellow", labelKey: "traffic.yellow" },
  { color: "green", labelKey: "traffic.green" },
];

export function TrafficLightWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "trafficlight") return null;

  return (
    <div class={styles.light} data-active={cfg.active}>
      <div class={styles.housing}>
        {LAMPS.map(({ color, labelKey }) => (
          <button
            key={color}
            class={styles.lamp}
            data-color={color}
            data-on={cfg.active === color || undefined}
            data-no-drag
            aria-label={t(labelKey)}
            title={t(labelKey)}
            aria-pressed={cfg.active === color}
            onClick={() =>
              updateWidgetConfig(widget.id, { ...cfg, active: color })
            }
          />
        ))}
      </div>
    </div>
  );
}
