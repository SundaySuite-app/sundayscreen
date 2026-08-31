import { describe, expect, it } from "vitest";

import { POPOVER_GAP_PX, popoverPos, type AnchorRect } from "./popover-core";

// One board, one panel size, and every case stated as a whole answer — the
// point of a table here is that «flipped» and «clamped» are the SAME
// function, so a change that fixes one edge and breaks another has nowhere
// to hide.

const VIEWPORT = { w: 1280, h: 800 };
const PANEL = { w: 300, h: 260 };
const GAP = POPOVER_GAP_PX;

/** A trigger the size of the house's 36 px round buttons. */
const anchor = (x: number, y: number, w = 40, h = 40): AnchorRect => ({
  x,
  y,
  w,
  h,
});

describe("popoverPos", () => {
  const cases: {
    name: string;
    anchor: AnchorRect;
    panel: { w: number; h: number };
    viewport: { w: number; h: number };
    want: { x: number; y: number; placement: "above" | "below" };
  }[] = [
    {
      name: "room underneath: below the anchor, centred on it",
      anchor: anchor(600, 100),
      panel: PANEL,
      viewport: VIEWPORT,
      // 600 + 20 − 150 = 470; 100 + 40 + 8 = 148.
      want: { x: 470, y: 148, placement: "below" },
    },
    {
      name: "no room underneath: flips above",
      anchor: anchor(600, 700),
      panel: PANEL,
      viewport: VIEWPORT,
      // 700 − 8 − 260 = 432.
      want: { x: 470, y: 432, placement: "above" },
    },
    {
      name: "the last pixel that still fits below stays below",
      // 484 + 40 + 8 + 260 = 792, i.e. the panel's foot lands exactly on the
      // bottom margin. «Fits» is inclusive on purpose: a flip one pixel early
      // is a panel that jumps sides while the teacher nudges the card, for no
      // reason she can see.
      anchor: anchor(600, 484),
      panel: PANEL,
      viewport: VIEWPORT,
      want: { x: 470, y: 532, placement: "below" },
    },
    {
      name: "one pixel lower flips",
      anchor: anchor(600, 485),
      panel: PANEL,
      viewport: VIEWPORT,
      // 485 − 8 − 260 = 217.
      want: { x: 470, y: 217, placement: "above" },
    },
    {
      name: "a trigger against the left edge slides the panel inward",
      anchor: anchor(0, 100, 36, 36),
      panel: PANEL,
      viewport: VIEWPORT,
      // Centred would be 18 − 150 = −132; the margin wins.
      want: { x: GAP, y: 144, placement: "below" },
    },
    {
      name: "a trigger against the right edge slides the panel inward",
      anchor: anchor(1244, 100, 36, 36),
      panel: PANEL,
      viewport: VIEWPORT,
      // Centred would be 1262 − 150 = 1112; 1280 − 300 − 8 = 972.
      want: { x: 972, y: 144, placement: "below" },
    },
    {
      name: "a panel wider than the screen keeps its LEFT edge on it",
      anchor: anchor(600, 100),
      panel: { w: 1400, h: 260 },
      viewport: VIEWPORT,
      want: { x: 0, y: 148, placement: "below" },
    },
    {
      name: "a panel taller than the screen keeps its TOP edge on it",
      anchor: anchor(600, 100),
      panel: { w: 300, h: 900 },
      viewport: VIEWPORT,
      // Neither side fits; below has 660 px against above's 100.
      want: { x: 470, y: 0, placement: "below" },
    },
    {
      name: "neither side fits and above is roomier: above, clamped to the top",
      anchor: anchor(600, 400),
      panel: { w: 300, h: 420 },
      viewport: { w: 1280, h: 500 },
      // 400 above the anchor against 60 below it.
      want: { x: 470, y: GAP, placement: "above" },
    },
    {
      name: "neither side fits and below is roomier: below, clamped to the foot",
      anchor: anchor(600, 60),
      panel: { w: 300, h: 420 },
      viewport: { w: 1280, h: 500 },
      // 500 − 420 − 8 = 72, i.e. the panel's foot lands on the bottom margin.
      want: { x: 470, y: 72, placement: "below" },
    },
    {
      name: "an unmeasured viewport yields zeroes, never NaN",
      anchor: anchor(0, 0, 0, 0),
      panel: PANEL,
      viewport: { w: 0, h: 0 },
      want: { x: 0, y: 0, placement: "below" },
    },
    {
      name: "a cramped window still places the panel wholly on screen",
      anchor: anchor(20, 300, 36, 36),
      panel: { w: 300, h: 260 },
      viewport: { w: 340, h: 700 },
      // x: centred is −112; 340 − 300 − 8 = 32 is the far clamp, 8 the near
      // one — the near one wins here.
      want: { x: GAP, y: 344, placement: "below" },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(popoverPos(c.anchor, c.panel, c.viewport)).toEqual(c.want);
    });
  }

  it("never leaves the viewport, over a sweep of anchors and sizes", () => {
    // The table above states the interesting answers; this states the
    // PROMISE, which is the one the teacher can see: no panel hangs off the
    // screen. Only sizes that fit are swept — a panel bigger than the window
    // has its own two cases above, where «wholly inside» is impossible.
    for (const vw of [640, 1024, 1280]) {
      for (const vh of [480, 768, 800]) {
        for (const px of [120, 300, 420]) {
          for (const py of [80, 260, 400]) {
            if (px + 2 * GAP > vw || py + 2 * GAP > vh) continue;
            const panel = { w: px, h: py };
            const viewport = { w: vw, h: vh };
            for (const ax of [0, vw / 2, vw - 40]) {
              for (const ay of [0, vh / 2, vh - 40]) {
                const pos = popoverPos(anchor(ax, ay), panel, viewport);
                expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(
                  true,
                );
                expect(pos.x).toBeGreaterThanOrEqual(GAP);
                expect(pos.y).toBeGreaterThanOrEqual(GAP);
                expect(pos.x + px).toBeLessThanOrEqual(vw - GAP);
                expect(pos.y + py).toBeLessThanOrEqual(vh - GAP);
              }
            }
          }
        }
      }
    }
  });

  it("takes the gap as an argument, and defaults to POPOVER_GAP_PX", () => {
    const a = anchor(600, 100);
    expect(popoverPos(a, PANEL, VIEWPORT, 0).y).toBe(140);
    expect(popoverPos(a, PANEL, VIEWPORT, 24).y).toBe(164);
    expect(popoverPos(a, PANEL, VIEWPORT).y).toBe(
      popoverPos(a, PANEL, VIEWPORT, POPOVER_GAP_PX).y,
    );
  });
});
