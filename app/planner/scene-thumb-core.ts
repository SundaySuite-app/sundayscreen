// The screen thumbnail's geometry — pure, table-tested.
//
// A planner cell should SHOW the screen it points at, not just name it. The
// drawing itself is trivial (one rounded box per widget, its kind's mark
// inside); what is not trivial is which marks survive the shrink. On a
// 112 × 70 px thumbnail a wide text banner is 90 × 6 px, and a 16 px icon
// inside a 6 px box is not a hint about the board — it is a smear across it,
// and it makes two different screens look identical.
//
// So the rule lives here, with no DOM in sight: normalised rects in, pixel
// boxes plus an honest `showIcon` out. `SceneThumb.tsx` renders exactly what
// this returns and decides nothing.
//
// The px conversion is `fromNorm` from the screen layer — the SAME converter
// the real surface renders through (app/screen/coords-core.ts). A second copy
// here would be a seam: the thumbnail would keep agreeing with itself while
// drifting away from the board it claims to be a picture of.

import {
  fromNorm,
  type NormRect,
  type PxRect,
  type Size,
} from "../screen/coords-core";

/** One widget, as the thumbnail needs it: where it sits, what it is, and
 *  which layer it is on. A subset of `WidgetInstance` on purpose — the core
 *  never sees a `WidgetConfig`, so it cannot grow an opinion about one. */
export interface ThumbItem {
  rect: NormRect;
  /**
   * The widget's `config.kind`, as a plain STRING — deliberately not
   * `WidgetKind`.
   *
   * Promise 3 says a downgrade never deletes a newer version's widgets: an
   * unknown `kind` is kept in the database and skipped by the API. A picture
   * of that board must therefore be able to contain a box whose kind this
   * build has never heard of. Narrowing the type here would push that case
   * into an `as`-cast at every call site, which is where it would be
   * forgotten.
   */
  kind: string;
  z: number;
}

/** One box to draw. `showIcon: false` means «draw the box, skip the mark» —
 *  never «skip the widget»: a card too small for its icon is still a card
 *  the teacher put there, and leaving it out would make a busy screen look
 *  emptier than it is. */
export interface ThumbBox {
  box: PxRect;
  kind: string;
  showIcon: boolean;
}

/**
 * The smallest box that still gets its kind's mark, in thumbnail px.
 *
 * Measured against the SHORT side, not the area: a 90 × 6 px banner has
 * plenty of area and no room at all. 12 px is where the 24-viewBox stroke
 * icons stop being a shape and start being a blob.
 */
export const THUMB_ICON_MIN_PX = 12;

/**
 * The draw list for one screen, bottom layer first.
 *
 * Sorted ASCENDING by `z` so the painter's algorithm falls out of the array
 * order — the same stacking the real surface gets from `z-index`. Ties keep
 * their input order (`Array.prototype.sort` is stable since ES2019), which
 * matters because `clamp_layout` re-indexes z to 0..n and a freshly imported
 * layout can still arrive with duplicates.
 *
 * A zero-or-negative surface yields an EMPTY list rather than a pile of zero
 * boxes: there is no such thing as a 0 × 0 thumbnail worth drawing, and a
 * negative size would otherwise produce negative widths that CSS renders as
 * nothing anyway, one silent step later.
 */
export function thumbSpec(items: readonly ThumbItem[], size: Size): ThumbBox[] {
  if (size.w <= 0 || size.h <= 0) return [];
  return [...items]
    .sort((a, b) => a.z - b.z)
    .map((item) => {
      const box = fromNorm(item.rect, size);
      return {
        box,
        kind: item.kind,
        showIcon: Math.min(box.w, box.h) >= THUMB_ICON_MIN_PX,
      };
    });
}
