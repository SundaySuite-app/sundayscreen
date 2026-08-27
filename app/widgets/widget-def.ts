import type { ComponentType } from "preact";

import type { WidgetConfig } from "../bindings/WidgetConfig";
import type { WidgetInstance } from "../bindings/WidgetInstance";

/** The kind discriminator — derived from the generated union, so a new Rust
 *  variant becomes a TS compile error in the registry until it has a def. */
export type WidgetKind = WidgetConfig["kind"];

/** Everything the framework needs to know about one widget kind. The
 *  registry (registry.ts) is the ONLY coupling point: the toolbar's add
 *  menu, the canvas renderer and the registry-shape test all iterate it. */
export interface WidgetDef {
  kind: WidgetKind;
  /** i18n key under `widget.label.*` — read via `tDyn("widget.label", kind)`. */
  labelKey: string;
  /** Wanted size when added, in px against the current surface. */
  defaultSizePx: { w: number; h: number };
  /** Smallest useful size, in px — enforced by the interaction layer (F2). */
  minSizePx: { w: number; h: number };
  /** "square" widgets render aspect-correct content INSIDE their box. */
  aspect: "free" | "square";
  defaultConfig(): WidgetConfig;
  Component: ComponentType<{ widget: WidgetInstance }>;
}
