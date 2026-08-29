// The canvas: absolutely-positioned widget shells over the full surface,
// plus the snap guides while something is being dragged. The ResizeObserver
// here is the ONE place pixels are measured — everything downstream converts
// through the `surfaceSize` signal.

import { useEffect, useRef } from "preact/hooks";

import { t } from "../i18n";
import { addMenuOpen, chromeActivity } from "../state/chrome";
import { layoutHydrated, selectedWidgetId, widgets } from "../state/layout";
import { surfaceSize } from "../state/surface";
import styles from "./Surface.module.css";
import { activeDrag } from "./useDrag";
import { WidgetShell } from "./WidgetShell";

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
            <p class={styles.emptyHint}>{t("board.emptyHint")}</p>
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
