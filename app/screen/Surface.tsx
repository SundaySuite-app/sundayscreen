// The canvas: absolutely-positioned widget shells over the full surface,
// plus the snap guides while something is being dragged. The ResizeObserver
// here is the ONE place pixels are measured — everything downstream converts
// through the `surfaceSize` signal.

import { useEffect, useRef } from "preact/hooks";

import { selectedWidgetId, widgets } from "../state/layout";
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
