// The canvas: absolutely-positioned widget shells over the full surface,
// plus the snap guides while something is being dragged. The ResizeObserver
// here is the ONE place pixels are measured — everything downstream converts
// through the `surfaceSize` signal.

import { useEffect, useRef } from "preact/hooks";

import { t } from "../i18n";
import { addMenuOpen, chromeActivity } from "../state/chrome";
import { designSession } from "../state/design-session";
import {
  activeScene,
  clearFocus,
  focusedWidget,
  layoutHydrated,
  selectedWidgetId,
  widgets,
} from "../state/layout";
import { surfaceSize } from "../state/surface";
import { focusRect } from "./coords-core";
import styles from "./Surface.module.css";
import { activeDrag } from "./useDrag";
import { WidgetShell } from "./WidgetShell";

/** How far outside the enlarged card a click still counts as a MISS rather
 *  than as «put it back» — see the scrim's handler below. */
const FOCUS_MISS_PAD_PX = 16;

export function Surface() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      surfaceSize.value = { w: el.clientWidth, h: el.clientHeight };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drag = activeDrag.value;

  return (
    <div
      class={styles.surface}
      // The screen's own BACKDROP colour (R6). It rides on the SCENE, so it
      // follows the screen across classes and comes back with it after a
      // restart — nothing here remembers a choice of its own. `"standard"`
      // before the first scene is read is the same board `--bg` draws, so the
      // boot frame cannot flash a colour.
      data-theme={activeScene.value?.theme ?? "standard"}
      ref={ref}
      onPointerDown={(e) => {
        // A click on the bare surface deselects.
        if (e.target === e.currentTarget) selectedWidgetId.value = null;
      }}
    >
      {/* An empty board never hides the way forward. Gated on
          `layoutHydrated` so it cannot flash between boot and the first
          read — and it says nothing about persistence: a global library
          screen is class-agnostic (ADR-009), so any such claim would have
          to read `activeScene`, never the class name. */}
      {layoutHydrated.value && widgets.value.length === 0 && (
        <div class={styles.empty}>
          <div class={styles.emptyCard}>
            <h2 class={styles.emptyTitle}>{t("board.emptyTitle")}</h2>
            {/* The hint POINTS somewhere, so it has to know where it is
                standing. On the wall the toolbar is along the bottom edge;
                inside the planner's design session the toolbar is not merely
                hidden but UNMOUNTED (Shell.tsx: two «Legg til verktøy» in one
                accessibility tree is an ambiguous target, and the class
                switcher behind a scrim is a way to swap the borrowed globals
                out from under the session). The old sentence therefore sent a
                teacher looking along an edge that had nothing on it — the same
                widget, the same empty board, a direction that was true in one
                place and false in the other. The design wording names the
                button that IS on screen, one line up, and is kept in step with
                `design.addTool` on purpose: the sentence and the control it
                points at are one thing said twice. */}
            <p class={styles.emptyHint}>
              {designSession.value
                ? t("board.emptyHintDesign")
                : t("board.emptyHint")}
            </p>
            {/* ONE door, not three: the same menu the toolbar opens.
                `chromeActivity()` is what makes it work when the toolbar
                has already slid away. Its own wording, NOT the toolbar's
                «Legg til verktøy» — two buttons with the same accessible
                name on the same screen is an ambiguous target for a
                screen reader and for every by-name test selector. */}
            <button
              class={styles.emptyAction}
              onClick={() => {
                addMenuOpen.value = true;
                chromeActivity();
              }}
            >
              {t("board.emptyAction")}
            </button>
          </div>
        </div>
      )}
      {/* The way OUT of «Vis stort», and the reason the board behind reads as
          set aside rather than merely covered.
          It is a control, not decoration: with dragging frozen, a click on a
          card behind the enlarged one does nothing at all, so without this
          the only exits would be Escape and one small button. It lives INSIDE
          `.surface` on purpose — a sibling of the shell would lie over the
          toolbar, the suggestion banner and the undo snackbar, and the
          teacher would lose the class switcher to a view mode. No transform
          and no backdrop-filter: either one makes this a containing block for
          the fixed chrome inside it. */}
      {focusedWidget.value && (
        <button
          class={styles.focusScrim}
          // The scrim and the card's own collapse button carry the SAME
          // sentence — they are the same command, and «Avslutt stor visning»
          // is what it is called. That makes them indistinguishable by
          // accessible name, which is fine for a reader (two doors, one room)
          // and ambiguous for every by-name test selector, so the scrim
          // carries a hook. Named for what it IS, not for a test.
          data-focus-scrim
          aria-label={t("board.focusExit")}
          onClick={(e) => {
            // A HALO, not a hard edge (R4-funn F8). The scrim lies UNDER the
            // enlarged card, so every click it ever receives is already
            // outside the card — which means a click on the card's own edge
            // is not a click on the board, it is a MISS. And the miss that
            // matters is eight pixels tall: the settings row sits `--sp-2`
            // above the card's bottom edge, so an aim just under «Lydvarsel»
            // or a preset lands on the scrim and collapses the view in front
            // of the class. Sixteen pixels of forgiveness around
            // `focusRect` — the same rect the card is drawn to — turns that
            // press into nothing at all, while the rest of the board (and
            // Escape, and the collapse button) still put the card back.
            const r = focusRect(surfaceSize.value);
            const box = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - box.left;
            const y = e.clientY - box.top;
            const near =
              x >= r.x - FOCUS_MISS_PAD_PX &&
              x <= r.x + r.w + FOCUS_MISS_PAD_PX &&
              y >= r.y - FOCUS_MISS_PAD_PX &&
              y <= r.y + r.h + FOCUS_MISS_PAD_PX;
            if (near) return;
            clearFocus();
          }}
        />
      )}
      {widgets.value.map((w) => (
        <WidgetShell key={w.id} widget={w} />
      ))}
      {drag?.guidesV.map((x) => (
        <div key={`v${x}`} class={styles.guideV} style={{ left: `${x}px` }} />
      ))}
      {drag?.guidesH.map((y) => (
        <div key={`h${y}`} class={styles.guideH} style={{ top: `${y}px` }} />
      ))}
    </div>
  );
}
