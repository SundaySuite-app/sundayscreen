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
import { Surface } from "../screen/Surface";
import { addMenuOpen } from "../state/chrome";
import { designSession, exitDesign } from "../state/design-session";
import { addWidget, saveError } from "../state/layout";
import { Icon } from "../ui/Icon";
import { WIDGET_KINDS, WIDGET_REGISTRY } from "../widgets/registry";
import styles from "./DesignPanel.module.css";

/** The proportion to draw the little board in. The fallback is only ever
 *  reached before the real surface has been measured once (a design session
 *  opened on a shell that never rendered a board), where any number is a
 *  guess — so it is the ordinary projector's. */
function aspectRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return "16 / 9";
  return `${w} / ${h}`;
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
          the ratio is INLINE because it is data — the stylesheet carries only
          the fallback. */}
      <div
        class={styles.board}
        style={{ aspectRatio: aspectRatio(session.aspect.w, session.aspect.h) }}
      >
        <Surface />
      </div>
    </div>
  );
}
