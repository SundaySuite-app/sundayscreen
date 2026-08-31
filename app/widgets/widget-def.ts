import type { ComponentType } from "preact";

import type { AnchorRect } from "../screen/popover-core";
import type { IconName } from "../ui/icon-paths";
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
  /** The kind's mark in the add menu and other chrome. */
  icon: IconName;
  /** Wanted size when added, in px against the current surface. */
  defaultSizePx: { w: number; h: number };
  /** Smallest useful size, in px — enforced by the interaction layer (F2). */
  minSizePx: { w: number; h: number };
  /** "square" widgets render aspect-correct content INSIDE their box. */
  aspect: "free" | "square";
  defaultConfig(): WidgetConfig;
  Component: ComponentType<{ widget: WidgetInstance }>;
  /**
   * OPTIONAL: a panel this kind wants drawn OUTSIDE its own card.
   *
   * A widget cannot open a popover itself. Every card is `overflow: hidden`
   * with `container-type: size` (WidgetShell.module.css), and layout
   * containment makes the card a containing block for `position: fixed` — so
   * a widget's own `fixed; inset: 0` backdrop covers the CARD, and its panel
   * is clipped at the card's edge. That is not a bug in any one widget; it is
   * the shape of the box all of them live in, which is why the way out is a
   * slot in the registry rather than a fix in a folder.
   *
   * Declaring it here is all a kind has to do: the screen layer draws it
   * (screen/WidgetOverlay.tsx), places it (screen/popover-core.ts) and gives
   * it its Escape rung and its backdrop. The widget opens one with
   * `openWidgetOverlay(widget.id, trigger.getBoundingClientRect())` and is
   * handed back the `close` that every one of those routes calls.
   *
   * `anchor` is the trigger's box in VIEWPORT pixels — the same rect the host
   * positioned the panel against, passed on so an overlay that wants to draw
   * a pointer or align to the control can, without measuring twice.
   */
  Overlay?: ComponentType<{
    widget: WidgetInstance;
    anchor: AnchorRect;
    close(): void;
  }>;
}
