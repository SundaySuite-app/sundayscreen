// The work-mode symbol: one big signal for how the class works right now.
// The four modes sit in the standard settings row; the chosen mode is
// config, so the board keeps saying the same thing after a restart.

import type { WidgetInstance } from "../../bindings/WidgetInstance";
import type { WorkMode } from "../../bindings/WorkMode";
import { tDyn } from "../../i18n";
import { updateWidgetConfig } from "../../state/layout";
import { WorkGlyph } from "./glyphs";
import styles from "./work-symbol.module.css";

const MODES: WorkMode[] = ["silent", "whisper", "collaborate", "raisehand"];

export function WorkSymbolWidget({ widget }: { widget: WidgetInstance }) {
  const cfg = widget.config;
  if (cfg.kind !== "worksymbol") return null;

  const current = MODES.includes(cfg.mode) ? cfg.mode : MODES[0];

  return (
    <div class={styles.symbol}>
      <div class={styles.glyph}>
        <WorkGlyph mode={current} />
      </div>
      <div class={styles.label}>{tDyn("work.mode", cfg.mode)}</div>

      <div data-settings-row data-no-drag>
        {MODES.map((mode) => (
          <button
            key={mode}
            data-settings-btn
            data-current={cfg.mode === mode || undefined}
            aria-label={tDyn("work.mode", mode)}
            title={tDyn("work.mode", mode)}
            aria-pressed={cfg.mode === mode}
            onClick={() => updateWidgetConfig(widget.id, { ...cfg, mode })}
          >
            <WorkGlyph mode={mode} class={styles.btnGlyph} />
          </button>
        ))}
      </div>
    </div>
  );
}
