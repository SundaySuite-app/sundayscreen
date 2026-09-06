// The undo window is HELD while nothing on screen can show the offer
// (state/layout.ts, «The clock runs only while the offer is on screen»).
//
// The shell hides the snackbar while a modal panel is open (ADR-020's
// addendum), and a hidden offer whose fifteen seconds keep running is the
// half of that fix this file pins: a card removed, a panel opened, the gap
// noticed THERE — and the way back gone by the time the panel closes. The
// chrome half (who holds, who releases) is `undoReachable` in
// `state/chrome.ts`, asserted in `chrome.test.ts`; the wiring between them is
// a running shell's to prove (`e2e/interact.spec.ts`).
//
// Node environment, like every unit test here (never jsdom): fake timers,
// a stubbed `window.api`, and the store's own doors — `removeWidget` to open
// a window, `adoptSnapshot` to seed and to clear.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Class } from "../bindings/Class";
import type { Scene } from "../bindings/Scene";
import type { WidgetInstance } from "../bindings/WidgetInstance";
import {
  UNDO_MS,
  adoptSnapshot,
  flushPending,
  holdUndoClock,
  removeWidget,
  resumeUndoClock,
  undoRemove,
  undoSlot,
  widgets,
} from "./layout";

const CLASS: Class = { id: "c1", name: "7B", sortIndex: 0, createdAt: 0 };
const SCENE: Scene = {
  id: "default-c1",
  classId: "c1",
  name: "7B",
  sortIndex: 0,
  createdAt: 0,
  theme: "standard",
};

function textWidget(id: string): WidgetInstance {
  return {
    id,
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    z: 0,
    config: { kind: "text", content: id, fontScale: 1, align: "left" },
  };
}
const A = textWidget("a");

// Every save lands at once — persistence is `layout.test.ts`'s subject, not
// this file's; here the store only has to accept the removal.
const layoutSave = vi.fn(() => Promise.resolve());
vi.stubGlobal("window", { api: { layoutSave } });

beforeEach(() => {
  vi.useFakeTimers();
  layoutSave.mockClear();
  // Seeding clears the slot and its timer through the store's own door — and
  // a hold left standing by a previous test is released, so the clock starts
  // every test running.
  resumeUndoClock();
  adoptSnapshot({ class: CLASS, scene: SCENE, members: [], widgets: [A] });
});

afterEach(async () => {
  await flushPending();
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the undo window while it cannot be seen", () => {
  it("runs out on its own when nothing holds it — the baseline", () => {
    removeWidget(A.id);
    expect(undoSlot.value?.widget.id).toBe("a");
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(undoSlot.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(undoSlot.value).toBeNull();
  });

  it("is HELD, not spent, while out of sight — and resumes with what was left", () => {
    removeWidget(A.id);
    // Five seconds of looking at the snackbar, then a panel opens over it.
    vi.advanceTimersByTime(5_000);
    holdUndoClock();

    // A whole class list edited behind the panel: the offer must not run out
    // while nobody could have pressed it.
    vi.advanceTimersByTime(10 * UNDO_MS);
    expect(undoSlot.value?.widget.id).toBe("a");

    // The panel closes. Ten seconds were left, and ten seconds is what she
    // gets — not a fresh fifteen (the offer was already five seconds old when
    // it went out of sight) and not zero.
    resumeUndoClock();
    vi.advanceTimersByTime(UNDO_MS - 5_000 - 1);
    expect(undoSlot.value?.widget.id).toBe("a");
    vi.advanceTimersByTime(1);
    expect(undoSlot.value).toBeNull();
  });

  it("can still be taken back while held — the slot is the store's, not the clock's", () => {
    removeWidget(A.id);
    holdUndoClock();
    vi.advanceTimersByTime(10 * UNDO_MS);
    // ⌘Z through the wall (screen/keyboard.ts reads `undoSlot`, never the
    // panel): the offer stands, so the card comes back.
    undoRemove();
    expect(widgets.value.map((w) => w.id)).toEqual(["a"]);
    expect(undoSlot.value).toBeNull();
    // …and a release with nothing pending arms nothing.
    resumeUndoClock();
    vi.advanceTimersByTime(UNDO_MS);
    expect(undoSlot.value).toBeNull();
  });

  it("a removal made DURING a hold starts a full window on release", () => {
    // Unreachable from the board today (the wall is inert), pinned so the
    // arithmetic has no branch that quietly arms a timer behind a hold.
    holdUndoClock();
    removeWidget(A.id);
    vi.advanceTimersByTime(10 * UNDO_MS);
    expect(undoSlot.value?.widget.id).toBe("a");
    resumeUndoClock();
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(undoSlot.value?.widget.id).toBe("a");
    vi.advanceTimersByTime(1);
    expect(undoSlot.value).toBeNull();
  });

  it("hold and resume are idempotent — a subscriber may fire them on every toggle", () => {
    removeWidget(A.id);
    vi.advanceTimersByTime(3_000);
    holdUndoClock();
    holdUndoClock();
    vi.advanceTimersByTime(60_000);
    resumeUndoClock();
    resumeUndoClock();
    // Twelve seconds left, once — a second resume must not have re-armed the
    // window from a stale remainder.
    vi.advanceTimersByTime(UNDO_MS - 3_000 - 1);
    expect(undoSlot.value?.widget.id).toBe("a");
    vi.advanceTimersByTime(1);
    expect(undoSlot.value).toBeNull();
  });

  it("a board swap clears the offer whether the clock is held or not", () => {
    removeWidget(A.id);
    holdUndoClock();
    // The class menu, the screen library, the auto-switch — every swap runs
    // through here, and the pending undo belongs to the board being left.
    adoptSnapshot({ class: CLASS, scene: SCENE, members: [], widgets: [] });
    expect(undoSlot.value).toBeNull();
    resumeUndoClock();
    vi.advanceTimersByTime(UNDO_MS);
    expect(undoSlot.value).toBeNull();
  });
});
