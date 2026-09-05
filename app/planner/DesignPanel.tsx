// The planner's editor for a screen that is NOT on the projector.
//
// It is the REAL editor: `<Surface/>` with every WidgetShell, drag, resize,
// snap guide and popover the board has, drawn at a fraction of the size inside
// the panel. Nothing here is a preview — what the teacher moves is the scene's
// own row, saved by the same persister, and the ONLY thing that makes it
// different from working on the wall is which id the writes carry
// (state/design-session.ts).
//
// Three things this file is careful about:
//
//   - The frame carries the REAL surface's proportion, captured before the
//     borrow (`session.aspect`). A 4:3 projector edited in a 16:9 box is a
//     WYSIWYG editor that lies: the widgets are stored in normalised
//     coordinates, so what looks placed in the panel would be stretched on the
//     wall.
//   - «Legg til …» carries its OWN wording, never the toolbar's «Legg til
//     verktøy». Two buttons with the same accessible name on one screen are an
//     ambiguous target for a screen reader and for every by-name selector —
//     the same rule the empty-board card in Surface.tsx already follows. The
//     SIGNAL is shared (`addMenuOpen`), which is what puts this menu on the
//     Escape ladder for free and what lets the empty board's own «Velg et
//     verktøy» open it.
//   - No `transform` anywhere in the CSS next door. The menu's dismiss layer
//     is `position: fixed`, and a transform on any ancestor would silently
//     re-point it at this panel's box instead of the viewport.

import { t, tDyn, tf } from "../i18n";
import type { Size } from "../screen/coords-core";
import { Surface } from "../screen/Surface";
import { addMenuOpen } from "../state/chrome";
import { designSession, exitDesign } from "../state/design-session";
import { addWidget, saveError } from "../state/layout";
import { Icon } from "../ui/Icon";
import { WIDGET_KINDS, WIDGET_REGISTRY } from "../widgets/registry";
import styles from "./DesignPanel.module.css";

/** The wall's proportion as a NUMBER (w ÷ h). The fallback is only ever
 *  reached before the real surface has been measured once (a design session
 *  opened on a shell that never rendered a board), where any number is a
 *  guess — so it is the ordinary projector's. */
function aspect(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 16 / 9;
  return w / h;
}

/**
 * Everything ABOVE and BELOW the board inside the viewport, in px — the number
 * that turns «the board must fit» into a `max-width`.
 *
 * Measured, not guessed (R6-F1, Playwright at 1024×768): the scrim pads the
 * panel by `--sp-5` top and bottom (2 × 20), the planner's own header is 71,
 * the body pads by `--sp-5` (2 × 20), this panel's header is 40 and the gap
 * below it is `--sp-4` (16). That is 207 px of chrome, i.e. the board's top
 * edge sat at y = 167 and the last 40 px were the bottom margins. The value
 * below carries 73 px on top of that, which is what a header wrapped onto a
 * second line costs (the `saveError` chip appearing next to «Ferdig» on a
 * narrow panel is the way that happens).
 *
 * The cost of the slack is board size on a big screen, and there is none: at
 * 1440×900 the width is still capped by the panel's own 938 px, so the board
 * measures 938 × 586 before this constant and 938 × 586 after it. On 1024×768
 * it goes from 938 × 704 — bottom edge at y = 871, i.e. 103 px past the bottom
 * of the screen — to 651 × 488 with its bottom edge at 691, header and all.
 */
const BOARD_CHROME_PX = 280;

/** The two measured numbers the little board is drawn from. Both are inline
 *  because both are DATA — the stylesheet next door carries only a fallback
 *  shape for the frame. */
function boardStyle(size: Size): { aspectRatio: string; maxWidth: string } {
  const a = aspect(size.w, size.h);
  return {
    aspectRatio: String(a),
    maxWidth: `calc((100vh - ${BOARD_CHROME_PX}px) * ${a})`,
  };
}

export function DesignPanel() {
  const session = designSession.value;
  if (!session) return null;
  const open = addMenuOpen.value;

  return (
    <div class={styles.wrap}>
      <header class={styles.header}>
        <div class={styles.naming}>
          <h3 class={styles.name}>{session.scene.name}</h3>
          {/* Says out loud what the whole session is: this is not the board
              the class is looking at. Without it the teacher is editing a
              screen that looks exactly like her own, at a smaller size. */}
          <p class={styles.hint}>
            {tf("design.editingHint", { name: session.scene.name })}
          </p>
        </div>
        {/* `position: relative`, and it is load-bearing: the menu below is
            absolutely positioned against THIS box. */}
        <div class={styles.addWrap}>
          <button
            class={styles.add}
            aria-expanded={open}
            onClick={() => {
              addMenuOpen.value = !open;
            }}
          >
            <Icon name="plus" size="sm" />
            {t("design.addTool")}
          </button>
          {open && (
            <>
              {/* A real button, so the keyboard and a screen reader reach the
                  way out too — the same dismiss layer the toolbar's menu and
                  the widget popovers use, with the same accessible name. */}
              <button
                class={styles.backdrop}
                aria-label={t("manage.close")}
                onClick={() => {
                  addMenuOpen.value = false;
                }}
              />
              <div class={styles.menu} role="menu">
                {WIDGET_KINDS.map((kind) => (
                  <button
                    key={kind}
                    role="menuitem"
                    class={styles.item}
                    onClick={() => {
                      addMenuOpen.value = false;
                      addWidget(kind);
                    }}
                  >
                    <Icon
                      name={WIDGET_REGISTRY[kind].icon}
                      size="md"
                      class={styles.itemIcon}
                    />
                    {tDyn("widget.label", kind)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* The shell's chip is BEHIND this panel, so the one state a teacher
            must not miss while designing is mirrored here. Same sentence, same
            `data-status` hook — one message, two places it can be read. */}
        {saveError.value && (
          <p class={styles.errorChip} data-status="error">
            {t("layout.saveFailed")}
          </p>
        )}
        <button class={styles.done} onClick={() => void exitDesign()}>
          <Icon name="check" size="sm" />
          {t("design.done")}
        </button>
      </header>
      {/* The board. `position: relative` because `.surface` is `inset: 0`, and
          both numbers are INLINE because they are data — the stylesheet
          carries only the fallback ratio.

          `maxWidth` is how the board's SHORT side is governed by the height
          that is actually available. Capping the height directly would be a
          cap the ratio cannot honour (the width would stay at 100 %, and the
          shape would stop matching the wall); capping the WIDTH leaves
          `aspect-ratio` in charge and simply draws the same shape smaller.
          Without it the board ran 103 px past the bottom of a 1024×768 screen
          — and the header this panel keeps «Ferdig» and the save-error chip in
          scrolled out of sight with it. */}
      <div class={styles.board} style={boardStyle(session.aspect)}>
        <Surface />
      </div>
    </div>
  );
}
