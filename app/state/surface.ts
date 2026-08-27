// The measured surface size, in CSS px. Written by the Surface component's
// ResizeObserver; read wherever normalised coordinates meet pixels. A
// projector swap, a DPI change or a window resize lands here and every
// widget reflows from the same number.

import { signal } from "@preact/signals";

import type { Size } from "../screen/coords-core";

export const surfaceSize = signal<Size>({ w: 0, h: 0 });
