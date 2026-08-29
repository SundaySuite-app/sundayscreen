// The widget registry — the ONE coupling point between the framework and the
// widget folders. Adding a kind = a new folder + one line here (+ the Rust
// `WidgetConfig` variant + i18n keys). Nothing else changes.

import { clockWidgetDef } from "./clock";
import { agendaWidgetDef } from "./agenda";
import { checklistWidgetDef } from "./checklist";
import { deadlineWidgetDef } from "./deadline";
import { diceWidgetDef } from "./dice";
import { groupsWidgetDef } from "./groups";
import { namePickerWidgetDef } from "./name-picker";
import { textWidgetDef } from "./text";
import { todayWidgetDef } from "./today";
import { timerWidgetDef } from "./timer";
import { trafficLightWidgetDef } from "./traffic-light";
import { workSymbolWidgetDef } from "./work-symbol";
import type { WidgetDef, WidgetKind } from "./widget-def";

export type { WidgetDef, WidgetKind } from "./widget-def";

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetDef> = {
  text: textWidgetDef,
  clock: clockWidgetDef,
  timer: timerWidgetDef,
  trafficlight: trafficLightWidgetDef,
  worksymbol: workSymbolWidgetDef,
  namepicker: namePickerWidgetDef,
  groups: groupsWidgetDef,
  dice: diceWidgetDef,
  agenda: agendaWidgetDef,
  today: todayWidgetDef,
  deadline: deadlineWidgetDef,
  checklist: checklistWidgetDef,
};

export const WIDGET_KINDS = Object.keys(WIDGET_REGISTRY) as WidgetKind[];
