// The traffic light: three lamps, click the one that should shine. The
// active colour is config — a restart mid-lesson shows the same light.

import type { TrafficColor } from "../../bindings/TrafficColor";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { tDyn } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import styles from "./traffic-light.module.css";

const LAMPS: readonly TrafficColor[] = ["red", "yellow", "green"];

export function TrafficLightWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "trafficlight") return null;

  return (
    <div class={styles.light} data-active={cfg.active}>
      <div class={styles.housing}>
        {LAMPS.map((color) => (
          <button
            key={color}
            class={styles.lamp}
            data-color={color}
            data-on={cfg.active === color || undefined}
            data-no-drag
            aria-label={tDyn("traffic", color)}
            title={tDyn("traffic", color)}
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
