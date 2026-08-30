import type { WidgetDef } from "../widget-def";
import { NamePickerWidget } from "./NamePickerWidget";

export const namePickerWidgetDef: WidgetDef = {
  kind: "namepicker",
  labelKey: "widget.label.namepicker",
  icon: "namepicker",
  defaultSizePx: { w: 460, h: 300 },
  // 260×190 until the count stepper landed. The hover row is six controls
  // now and measures 323 px including its own plate padding, so under
  // ~339 px of card it wraps onto two lines and the reserve below has to
  // double — which at 190 px tall left the drawn names literally zero pixels
  // (measured, not guessed). So the minimum is set ABOVE the wrap, with room
  // for a locale whose words are longer than bokmål's, and tall enough that
  // five names still fit over «Trekk navn». Groups arrived at 320×240 under
  // exactly the same pressure.
  minSizePx: { w: 380, h: 260 },
  aspect: "free",
  defaultConfig: () => ({
    kind: "namepicker",
    noRepeat: true,
    lastDrawn: null,
    lastDrawnMany: [],
    drawCount: 1,
  }),
  Component: NamePickerWidget,
};
