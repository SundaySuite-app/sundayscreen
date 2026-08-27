// The widget registry — the ONE coupling point between the framework and the
// widget folders. Adding a kind = a new folder + one line here (+ the Rust
// `WidgetConfig` variant + i18n keys). Nothing else changes.

import { clockWidgetDef } from "./clock";
import { textWidgetDef } from "./text";
import { timerWidgetDef } from "./timer";
import type { WidgetDef, WidgetKind } from "./widget-def";

export type { WidgetDef, WidgetKind } from "./widget-def";

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetDef> = {
  text: textWidgetDef,
  clock: clockWidgetDef,
  timer: timerWidgetDef,
};

export const WIDGET_KINDS = Object.keys(WIDGET_REGISTRY) as WidgetKind[];
