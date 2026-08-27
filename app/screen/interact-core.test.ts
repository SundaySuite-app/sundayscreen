import { describe, expect, it } from "vitest";

import {
  DRAG_THRESHOLD_PX,
  dragMove,
  isDrag,
  resizeSE,
  snapRect,
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

describe("isDrag", () => {
  it("under the threshold is a click, at/over it a drag", () => {
    expect(isDrag(DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
    expect(isDrag(DRAG_THRESHOLD_PX, 0)).toBe(true);
    // Diagonal distance counts, not per-axis.
    expect(isDrag(3, 3)).toBe(true);
  });
});
