// The work-mode symbol: one big signal for how the class works right now.
// The signal itself steps through the four modes, and the standard settings
// row picks one outright; the chosen mode is config, so the board keeps
// saying the same thing after a restart.

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

  const setMode = (mode: WorkMode) =>
    updateWidgetConfig(widget.id, { ...cfg, mode });

  return (
    <div class={styles.symbol}>
      {/*
       * The SIGNAL IS THE CONTROL (R7-funn K5). The two signal widgets spoke
       * different languages: the traffic light's lamps are its buttons, 85 px
       * of direct click, while this one asked for a 36 px hover button — and
       * a press on the big glyph, which is what a teacher does on a touch
       * whiteboard, did nothing at all. Same action, «tell the class
       * something», so: same form. One click steps to the next mode and
       * persists it exactly as a lamp press does; the row below stays for
       * picking a mode outright, which cycling cannot do in one press.
       *
       * The label is INSIDE the button, so the accessible name is the word on
       * the board (WCAG 2.5.3, and the ADR-017 shape). It is deliberately
       * `width: auto` — the card's margins stay drag surface, the way the
       * traffic light leaves the space around its housing.
       */}
      <button
        class={styles.signal}
        data-work-glyph
        data-no-drag
        onClick={() =>
          setMode(MODES[(MODES.indexOf(current) + 1) % MODES.length])
        }
      >
        <span class={styles.glyph}>
          <WorkGlyph mode={current} />
        </span>
        {/* `current`, not `cfg.mode`: glyph and word are one control now, so
            a config from a newer build with a mode this one does not know
            must not draw one thing and say another. */}
        <span class={styles.label}>{tDyn("work.mode", current)}</span>
      </button>

      <div data-settings-row data-no-drag>
        {MODES.map((mode) => (
          <button
            key={mode}
            data-settings-btn
            data-current={cfg.mode === mode || undefined}
            aria-label={tDyn("work.mode", mode)}
            title={tDyn("work.mode", mode)}
            aria-pressed={cfg.mode === mode}
            onClick={() => setMode(mode)}
          >
            <WorkGlyph mode={mode} class={styles.btnGlyph} />
          </button>
        ))}
      </div>
    </div>
  );
}
