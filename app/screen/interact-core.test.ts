import { describe, expect, it } from "vitest";

import type { PxRect } from "./coords-core";
import {
  DRAG_THRESHOLD_PX,
  dragMove,
  isDrag,
  resizeSE,
  snapRect,
  snapResize,
} from "./interact-core";

const SURFACE = { w: 1000, h: 600 };

describe("dragMove", () => {
  it("moves by the delta", () => {
    const r = dragMove({ x: 100, y: 100, w: 200, h: 100 }, 30, -20, SURFACE);
    expect(r).toEqual({ x: 130, y: 80, w: 200, h: 100 });
  });

  it("clamps to every surface edge", () => {
    const start = { x: 100, y: 100, w: 200, h: 100 };
    expect(dragMove(start, -500, -500, SURFACE)).toMatchObject({ x: 0, y: 0 });
    const r = dragMove(start, 5000, 5000, SURFACE);
    expect(r.x).toBe(SURFACE.w - start.w);
    expect(r.y).toBe(SURFACE.h - start.h);
  });

  it("a widget wider than the surface pins to 0 rather than a negative max", () => {
    const r = dragMove({ x: 0, y: 0, w: 2000, h: 100 }, 50, 0, SURFACE);
    expect(r.x).toBe(0);
  });
});

describe("resizeSE", () => {
  const MIN = { w: 120, h: 80 };

  it("grows by the delta with the position fixed", () => {
    const r = resizeSE(
      { x: 100, y: 100, w: 200, h: 100 },
      40,
      20,
      MIN,
      SURFACE,
    );
    expect(r).toEqual({ x: 100, y: 100, w: 240, h: 120 });
  });

  it("never shrinks below the minimum", () => {
    const r = resizeSE(
      { x: 100, y: 100, w: 200, h: 100 },
      -500,
      -500,
      MIN,
      SURFACE,
    );
    expect(r.w).toBe(MIN.w);
    expect(r.h).toBe(MIN.h);
  });

  it("never grows past the surface edge", () => {
    const r = resizeSE(
      { x: 800, y: 500, w: 100, h: 50 },
      5000,
      5000,
      MIN,
      SURFACE,
    );
    expect(r.w).toBe(SURFACE.w - 800);
    expect(r.h).toBe(SURFACE.h - 500);
  });

  // ── The surface edge beats the minimum ───────────────────────────────────
  // A projector swap reflows normalised rects and can leave a card NARROWER
  // than its own minimum, hard against the edge. The old clamp let the first
  // pixel of a resize snap it out past the edge, where `.surface` clipped it
  // and the next boot's `clamp_rect` teleported it back — promise 2, broken
  // silently. What is asserted below is therefore NOT the minimum: it is
  // that the committed rect is a FIXPOINT for `clamp_rect`.

  it("a card left smaller than its minimum at the edge never leaves the surface", () => {
    // 40×30 card whose kind wants 120×80, pinned at the bottom-right.
    const r = resizeSE({ x: 950, y: 560, w: 40, h: 30 }, 1, 1, MIN, SURFACE);
    expect(r.x + r.w).toBeLessThanOrEqual(SURFACE.w);
    expect(r.y + r.h).toBeLessThanOrEqual(SURFACE.h);
    // The available room is what it gets — 50×40, not the 120×80 minimum.
    expect(r.w).toBe(50);
    expect(r.h).toBe(40);
  });

  it("every resize commits a rect clamp_rect would leave alone", () => {
    const cases: {
      start: PxRect;
      dx: number;
      dy: number;
    }[] = [
      { start: { x: 950, y: 560, w: 40, h: 30 }, dx: 1, dy: 1 },
      { start: { x: 950, y: 560, w: 40, h: 30 }, dx: -900, dy: -900 },
      { start: { x: 990, y: 590, w: 10, h: 10 }, dx: 400, dy: 400 },
      { start: { x: 1000, y: 600, w: 0, h: 0 }, dx: 300, dy: 300 },
      { start: { x: 0, y: 0, w: 200, h: 100 }, dx: 5000, dy: 5000 },
      { start: { x: 500, y: 300, w: 200, h: 100 }, dx: -50, dy: -50 },
    ];
    for (const { start, dx, dy } of cases) {
      const label = `${JSON.stringify(start)} +${dx}/${dy}`;
      const r = resizeSE(start, dx, dy, MIN, SURFACE);
      expect(r.w, label).toBeGreaterThanOrEqual(0);
      expect(r.h, label).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, label).toBeLessThanOrEqual(SURFACE.w);
      expect(r.y + r.h, label).toBeLessThanOrEqual(SURFACE.h);
    }
  });

  it("the minimum still wins wherever there IS room for it", () => {
    // The fix must not read as "the minimum was deleted": with the whole
    // surface to the right, shrinking still stops at 120×80.
    const r = resizeSE({ x: 100, y: 100, w: 200, h: 100 }, -180, -90, MIN, {
      w: 1000,
      h: 600,
    });
    expect(r.w).toBe(MIN.w);
    expect(r.h).toBe(MIN.h);
  });
});

describe("snapRect", () => {
  it("snaps the left edge to the surface edge within the threshold", () => {
    const { rect, guidesV } = snapRect(
      { x: 5, y: 300, w: 100, h: 50 },
      [],
      SURFACE,
    );
    expect(rect.x).toBe(0);
    expect(guidesV).toEqual([0]);
  });

  it("snaps the centre to the surface centre", () => {
    // Centre at 497 → 3px from 500.
    const { rect, guidesV } = snapRect(
      { x: 447, y: 300, w: 100, h: 50 },
      [],
      SURFACE,
    );
    expect(rect.x).toBe(450);
    expect(guidesV).toEqual([500]);
  });

  it("snaps to a sibling's edge", () => {
    const sibling = { x: 300, y: 100, w: 150, h: 80 };
    // Our left edge at 455 → 5px from sibling's right edge (450).
    const { rect } = snapRect(
      { x: 455, y: 300, w: 100, h: 50 },
      [sibling],
      SURFACE,
    );
    expect(rect.x).toBe(450);
  });

  it("misses when outside the threshold — the pointer's word stands", () => {
    const { rect, guidesV, guidesH } = snapRect(
      { x: 137, y: 233, w: 100, h: 50 },
      [],
      SURFACE,
    );
    expect(rect).toEqual({ x: 137, y: 233, w: 100, h: 50 });
    expect(guidesV).toEqual([]);
    expect(guidesH).toEqual([]);
  });

  it("the two axes snap independently", () => {
    const { rect } = snapRect({ x: 3, y: 233, w: 100, h: 50 }, [], SURFACE);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(233);
  });
});

describe("snapResize", () => {
  const MIN = { w: 120, h: 80 };

  it("snaps the right edge to a sibling's right edge", () => {
    const sibling = { x: 100, y: 40, w: 300, h: 120 };
    // Our right edge at 395 → 5 px from the sibling's 400.
    const { rect, guidesV } = snapResize(
      { x: 100, y: 300, w: 295, h: 200 },
      [sibling],
      SURFACE,
      MIN,
    );
    expect(rect.w).toBe(300);
    expect(rect.x).toBe(100);
    expect(guidesV).toEqual([400]);
  });

  it("snaps the bottom edge to the surface centre, and misses stand", () => {
    // Bottom at 303 → 3 px from 300; the right edge is nowhere near a line.
    const { rect, guidesH, guidesV } = snapResize(
      { x: 137, y: 100, w: 233, h: 203 },
      [],
      SURFACE,
      MIN,
    );
    expect(rect.h).toBe(200);
    expect(guidesH).toEqual([300]);
    expect(rect.w).toBe(233);
    expect(guidesV).toEqual([]);
  });

  it("never snaps a card under its minimum — and drops the guide it broke", () => {
    // A sibling's left edge sits 4 px inside the card's 120 px minimum: the
    // snap would pull the width to 116, which `resizeSE` had just refused.
    const sibling = { x: 216, y: 0, w: 200, h: 100 };
    const { rect, guidesV } = snapResize(
      { x: 100, y: 300, w: 120, h: 200 },
      [sibling],
      SURFACE,
      MIN,
    );
    expect(rect.w).toBe(MIN.w);
    expect(guidesV).toEqual([]);
  });

  it("the snapped rect is still a fixpoint for clamp_rect", () => {
    // The 5.1 rider's card — smaller than its own 120×80 minimum, hard
    // against the corner — routed through the snap path: the minimum must
    // not blow it out over the edge here either.
    const { rect, guidesV, guidesH } = snapResize(
      { x: 950, y: 560, w: 44, h: 34 },
      [],
      SURFACE,
      MIN,
    );
    expect(rect.w).toBe(50);
    expect(rect.h).toBe(40);
    expect(rect.x + rect.w).toBe(SURFACE.w);
    expect(rect.y + rect.h).toBe(SURFACE.h);
    expect(guidesV).toEqual([SURFACE.w]);
    expect(guidesH).toEqual([SURFACE.h]);
  });
});

describe("isDrag", () => {
  it("under the threshold is a click, at/over it a drag", () => {
    expect(isDrag(DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
    expect(isDrag(DRAG_THRESHOLD_PX, 0)).toBe(true);
    // Diagonal distance counts, not per-axis.
    expect(isDrag(3, 3)).toBe(true);
  });
});
