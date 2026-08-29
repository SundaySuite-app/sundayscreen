import type { WidgetDef } from "../widget-def";
import { NamePickerWidget } from "./NamePickerWidget";

export const namePickerWidgetDef: WidgetDef = {
  kind: "namepicker",
  labelKey: "widget.label.namepicker",
  icon: "namepicker",
  defaultSizePx: { w: 460, h: 300 },
  minSizePx: { w: 260, h: 190 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "namepicker",
    noRepeat: true,
    lastDrawn: null,
  }),
  Component: NamePickerWidget,
};
