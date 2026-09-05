import type { WidgetDef } from "../widget-def";
import { ImageWidget } from "./ImageWidget";

export const imageWidgetDef: WidgetDef = {
  kind: "image",
  labelKey: "widget.label.image",
  icon: "image",
  defaultSizePx: { w: 480, h: 360 },
  minSizePx: { w: 160, h: 120 },
  // A picture has whatever shape it has, and the teacher crops or letterboxes
  // it with the fit toggle. Forcing the CARD square would decide that for
  // her.
  aspect: "free",
  defaultConfig: () => ({
    kind: "image",
    imageId: "",
    fit: "contain",
    caption: "",
  }),
  Component: ImageWidget,
};
