// The clock widget: a big digital face or an analog SVG, optional seconds
// and date. Repaints once a second; everything shown is derived from the
// wall clock at paint time, so throttling can never make it wrong — only
// briefly stale.

import { useEffect, useState } from "preact/hooks";

import { localeTag } from "@lib/i18n";
import type { WidgetInstance } from "../../bindings/WidgetInstance";
import { t } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import styles from "./clock.module.css";

export function ClockWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  const [, force] = useState(0);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (cfg.kind !== "clock") return null;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");

  const toggle = (patch: Partial<typeof cfg>) =>
    updateWidgetConfig(widget.id, { ...cfg, ...patch });

  return (
    <div class={styles.clock}>
      {cfg.face === "digital" ? (
        <div class={styles.digital}>
          {pad(now.getHours())}:{pad(now.getMinutes())}
          {cfg.showSeconds && (
            <span class={styles.seconds}>:{pad(now.getSeconds())}</span>
          )}
        </div>
      ) : (
        <AnalogFace now={now} showSeconds={cfg.showSeconds} />
      )}
      {cfg.showDate && (
        <div class={styles.date}>
          {new Intl.DateTimeFormat(localeTag(), {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(now)}
        </div>
      )}

      <div data-settings-row data-no-drag>
        <button
          data-settings-btn
          data-current={cfg.face === "digital" || undefined}
          onClick={() => toggle({ face: "digital" })}
        >
          {t("clock.digital")}
        </button>
        <button
          data-settings-btn
          data-current={cfg.face === "analog" || undefined}
          onClick={() => toggle({ face: "analog" })}
        >
          {t("clock.analog")}
        </button>
        <button
          data-settings-btn
          aria-pressed={cfg.showSeconds}
          data-current={cfg.showSeconds || undefined}
          onClick={() => toggle({ showSeconds: !cfg.showSeconds })}
        >
          {t("clock.seconds")}
        </button>
        <button
          data-settings-btn
          aria-pressed={cfg.showDate}
          data-current={cfg.showDate || undefined}
          onClick={() => toggle({ showDate: !cfg.showDate })}
        >
          {t("clock.date")}
        </button>
      </div>
    </div>
  );
}

function AnalogFace({ now, showSeconds }: { now: Date; showSeconds: boolean }) {
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  const hand = (deg: number) => `rotate(${deg} 100 100)`;

  return (
    <svg class={styles.analog} viewBox="0 0 200 200" role="img">
      <circle cx="100" cy="100" r="94" class={styles.face} />
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          x1="100"
          y1="14"
          x2="100"
          y2={i % 3 === 0 ? "26" : "20"}
          class={i % 3 === 0 ? styles.tickMajor : styles.tick}
          transform={hand(i * 30)}
        />
      ))}
      <line
        x1="100"
        y1="100"
        x2="100"
        y2="54"
        class={styles.hourHand}
        transform={hand(hours * 30)}
      />
      <line
        x1="100"
        y1="100"
        x2="100"
        y2="32"
        class={styles.minuteHand}
        transform={hand(minutes * 6)}
      />
      {showSeconds && (
        <line
          x1="100"
          y1="106"
          x2="100"
          y2="26"
          class={styles.secondHand}
          transform={hand(seconds * 6)}
        />
      )}
      <circle cx="100" cy="100" r="4" class={styles.hub} />
    </svg>
  );
}
