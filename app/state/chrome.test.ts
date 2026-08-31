// The crossing behind `activeWidgetOverlay` — the one piece of the popover
// slot that no other tier can reach today.
//
// The e2e tier cannot: a widget popover opens only from a kind that declares
// `WidgetDef.Overlay`, and none does yet (the die's appearance panel is the
// first, and lands in the next commit). A test written against the real
// registry would therefore read green because the answer is ALWAYS null —
// green for the wrong reason, which is worse than no test at all. So the
// registry is stubbed with one kind that has an overlay and one that does
// not, and each branch is then distinguishable from the others.
//
// Node environment, like every unit test here: nothing below touches the DOM.
// `initChrome`'s listeners (the idle ticker, the pointer reveal, the stale
// sweep) are the DOM half and belong to the browser tier.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WidgetInstance } from "../bindings/WidgetInstance";

vi.mock("../widgets/registry", () => ({
  WIDGET_KINDS: ["dice", "text"],
  WIDGET_REGISTRY: {
    // Only the fields this module reads. `Overlay` is what separates «a kind
    // that can show a panel» from one that cannot.
    dice: { kind: "dice", Overlay: () => null },
    text: { kind: "text" },
  },
}));

const {
  activeWidgetOverlay,
  anyOverlayOpen,
  closeWidgetOverlay,
  openWidgetOverlay,
  widgetOverlay,
} = await import("./chrome");
const { widgets } = await import("./layout");

const ANCHOR = { x: 100, y: 200, w: 40, h: 40 };

function widget(id: string, kind: "dice" | "text"): WidgetInstance {
  return {
    id,
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    z: 0,
    config:
      kind === "dice"
        ? {
            kind: "dice",
            count: 1,
            faces: 6,
            lastRoll: [],
            color: "classic",
            material: "ivory",
          }
        : { kind: "text", content: id, fontScale: 1, align: "left" },
  };
}

const DIE = widget("die", "dice");
const TEXT = widget("txt", "text");

beforeEach(() => {
  widgets.value = [DIE, TEXT];
  closeWidgetOverlay();
});

describe("activeWidgetOverlay", () => {
  it("is null while nothing is open, and nothing is pinned", () => {
    expect(activeWidgetOverlay.value).toBeNull();
    expect(anyOverlayOpen.value).toBe(false);
  });

  it("carries the widget, its Overlay and the anchor once opened", () => {
    openWidgetOverlay(DIE.id, ANCHOR);
    const active = activeWidgetOverlay.value;
    expect(active?.widget).toBe(DIE);
    expect(active?.anchor).toEqual(ANCHOR);
    expect(typeof active?.Overlay).toBe("function");
    // …and an open panel holds the chrome open, like every other one.
    expect(anyOverlayOpen.value).toBe(true);
  });

  it("a card that leaves the board takes its panel with it", () => {
    openWidgetOverlay(DIE.id, ANCHOR);
    expect(activeWidgetOverlay.value).not.toBeNull();
    // The planner's auto-switch and the suggestion banner both swap the board
    // on a TIMER — no click, so no backdrop to intercept it. The raw signal is
    // still set here on purpose: this is the crossing doing its job on its
    // own, without anyone having remembered to clear anything.
    widgets.value = [TEXT];
    expect(widgetOverlay.value).not.toBeNull();
    expect(activeWidgetOverlay.value).toBeNull();
    // Which is the whole point: a stale id must not pin the toolbar open…
    expect(anyOverlayOpen.value).toBe(false);
    // …and, via this same signal in keyboard.ts, must not swallow an Escape.
  });

  it("a kind with no Overlay cannot hold the top Escape rung", () => {
    openWidgetOverlay(TEXT.id, ANCHOR);
    expect(widgetOverlay.value).not.toBeNull();
    expect(activeWidgetOverlay.value).toBeNull();
    expect(anyOverlayOpen.value).toBe(false);
  });

  it("closing clears the raw signal too", () => {
    openWidgetOverlay(DIE.id, ANCHOR);
    closeWidgetOverlay();
    expect(widgetOverlay.value).toBeNull();
    expect(activeWidgetOverlay.value).toBeNull();
  });
});
