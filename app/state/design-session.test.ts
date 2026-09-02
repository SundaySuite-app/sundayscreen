// The design session's invariants, asserted where they live: against a
// stubbed `window.api` and an ORDERED call log.
//
// Nothing here is about pixels. «Designing never touches what the class sees»
// is, in a one-window app, three statements about state — write isolation,
// pointer isolation, restitution — and every one of them is a statement about
// what reached the backend and in what ORDER. So the stub records both
// `layout_load` and `layout_save` into ONE list: the question test 1 asks
// («did the lesson's debounced write land before the borrow?») cannot be asked
// of two separate mocks.
//
// Node environment, like every unit test here (never jsdom): the store is
// signals and the session is two functions.
//
// ## Module state outlives a test
//
// The persister's `inflight` and `debounceTimer` are module-private and
// survive from one test to the next, so `afterEach` drains them, and
// `beforeEach` re-seeds through the store's own door, `adoptSnapshot`.

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
import { designSession, enterDesign, exitDesign } from "./design-session";
import {
  activeScene,
  adoptSnapshot,
  flushPending,
  focusedWidgetId,
  layoutHydrated,
  saveError,
  saveNow,
  saveSoon,
  selectedWidgetId,
  undoSlot,
  widgets,
} from "./layout";

const CLASS: Class = { id: "c1", name: "7B", sortIndex: 0, createdAt: 0 };

/** The screen on the projector — the lesson in progress. */
const LESSON: Scene = {
  id: "default-c1",
  classId: "c1",
  name: "7B",
  sortIndex: 0,
  createdAt: 0,
  theme: "standard",
};
/** The screen being prepared for Wednesday, third period. */
const DESIGN: Scene = {
  id: "s-design",
  classId: null,
  name: "Morgensamling",
  sortIndex: 1,
  createdAt: 0,
  theme: "papir",
};
/** A third one, for the "already in a session" test. */
const OTHER: Scene = { ...DESIGN, id: "s-other", name: "Stasjoner" };

function textWidget(id: string): WidgetInstance {
  return {
    id,
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    z: 0,
    config: { kind: "text", content: id, fontScale: 1, align: "left" },
  };
}
/** On the lesson's board. */
const A = textWidget("a");
const B = textWidget("b");
/** Stored in the design scene. */
const D1 = textWidget("d1");
/** Added while designing. */
const D2 = textWidget("d2");

// ── The stub, with one ordered log ──────────────────────────────────────────

type Call =
  | { op: "load"; sceneId: string }
  | { op: "save"; sceneId: string; ids: string[] }
  | { op: "settings" };

const calls: Call[] = [];

/** What the design scene reads back as. */
let stored: WidgetInstance[] = [D1];
/** Make the next `layout_load` reject — the S#4 case. */
let loadFails = false;
/** Make every `layout_save` reject — the sticky-chip case. */
let saveFails = false;

const layoutLoad = vi.fn(async (sceneId: string) => {
  calls.push({ op: "load", sceneId });
  if (loadFails) throw new Error("database is locked");
  return stored;
});

const layoutSave = vi.fn(async (sceneId: string, list: WidgetInstance[]) => {
  calls.push({ op: "save", sceneId, ids: list.map((w) => w.id) });
  if (saveFails) throw new Error("database is locked");
});

// Both settings doors, logged as one kind: invariant 2 is «the pointers do not
// move», and it does not care which of the two would have moved them.
const settingsSave = vi.fn(async () => {
  calls.push({ op: "settings" });
});
const settingsSetWindow = vi.fn(async () => {
  calls.push({ op: "settings" });
});

vi.stubGlobal("window", {
  api: { layoutLoad, layoutSave, settingsSave, settingsSetWindow },
});

/** Only the writes, in order. */
function saves(from = 0): { sceneId: string; ids: string[] }[] {
  return calls
    .slice(from)
    .filter((c): c is Extract<Call, { op: "save" }> => c.op === "save")
    .map(({ sceneId, ids }) => ({ sceneId, ids }));
}

function loadCount(): number {
  return calls.filter((c) => c.op === "load").length;
}

beforeEach(() => {
  calls.length = 0;
  layoutLoad.mockClear();
  layoutSave.mockClear();
  settingsSave.mockClear();
  settingsSetWindow.mockClear();
  stored = [D1];
  loadFails = false;
  saveFails = false;
  designSession.value = null;
  // The store's own seeding door: class, scene, widgets, hydration, selection
  // and the undo slot in one move. Nothing is exported from layout.ts for the
  // test's sake.
  adoptSnapshot({ class: CLASS, scene: LESSON, members: [], widgets: [A] });
  saveError.value = false;
});

afterEach(async () => {
  saveFails = false;
  await flushPending();
  designSession.value = null;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ── 1. Flush before swap, BOTH ways ─────────────────────────────────────────

describe("the flush order — the round's most dangerous line", () => {
  it("writes the LESSON's pending edit before it borrows the board", async () => {
    // A debounced edit of the screen on the wall, still unwritten.
    widgets.value = [A, B];
    saveSoon();
    expect(saves()).toEqual([]);

    await enterDesign(DESIGN);

    // The order is the assertion. A borrow that swapped first would leave the
    // lesson's edit queued behind it, and the persister — which reads
    // `activeScene` at WRITE time — would have filed it under the DESIGN
    // scene: the teacher's board, written into a screen she is preparing.
    expect(calls).toEqual([
      { op: "save", sceneId: LESSON.id, ids: ["a", "b"] },
      { op: "load", sceneId: DESIGN.id },
    ]);
  });

  it("writes the DESIGN scene's pending edit before it hands the board back", async () => {
    await enterDesign(DESIGN);
    const mark = calls.length;

    // Typing in a text widget on the little board: debounced, unwritten.
    widgets.value = [D1, D2];
    saveSoon();
    expect(saves(mark)).toEqual([]);

    await exitDesign();

    // The write that was in the air belongs to the screen it was made on. A
    // restore-then-flush would have put `[d1, d2]` into `default-c1` — the
    // lesson's own screen, replaced by someone else's widgets, in silence.
    expect(saves(mark)).toEqual([{ sceneId: DESIGN.id, ids: ["d1", "d2"] }]);
    expect(activeScene.value?.id).toBe(LESSON.id);
  });
});

// ── 2. Write isolation ──────────────────────────────────────────────────────

describe("write isolation: every save in the session is the design scene's", () => {
  it("never writes the lesson's id between enter and exit", async () => {
    await enterDesign(DESIGN);
    const mark = calls.length;

    widgets.value = [D1, D2];
    saveNow();
    await flushPending();
    widgets.value = [D2];
    saveNow();
    await flushPending();

    const inSession = saves(mark);
    expect(inSession.length).toBeGreaterThan(0);
    expect(inSession.every((s) => s.sceneId === DESIGN.id)).toBe(true);

    await exitDesign();
    expect(saves(mark).every((s) => s.sceneId === DESIGN.id)).toBe(true);

    // …and the assertion is not vacuous: the very same door writes the
    // LESSON's id the moment the board is back.
    const after = calls.length;
    widgets.value = [A];
    saveNow();
    await flushPending();
    expect(saves(after)).toEqual([{ sceneId: LESSON.id, ids: ["a"] }]);
  });
});

// ── 3. Pointer isolation ────────────────────────────────────────────────────

describe("pointer isolation: a crash mid-session lands on the lesson", () => {
  it("writes no settings at all across a whole session", async () => {
    await enterDesign(DESIGN);
    widgets.value = [D1, D2];
    saveNow();
    await flushPending();
    await exitDesign();

    // Nothing repointed `settings.activeSceneId`, so there is nothing for a
    // next boot to recover FROM: `class_ensure_active` lands on the screen the
    // lesson was already using, structurally rather than by tidying up.
    expect(calls.some((c) => c.op === "settings")).toBe(false);
    expect(settingsSave).not.toHaveBeenCalled();
    expect(settingsSetWindow).not.toHaveBeenCalled();
  });
});

// ── 4. A failed load aborts ─────────────────────────────────────────────────

describe("a load that fails opens nothing", () => {
  it("leaves the board, the scene and the session exactly as they were", async () => {
    loadFails = true;
    const before = widgets.value;

    await enterDesign(DESIGN);

    expect(designSession.value).toBe(null);
    expect(activeScene.value).toBe(LESSON);
    expect(widgets.value).toBe(before);
    // The whole of funn S#4: borrowing a scene we failed to read, then saving
    // once, is a replace-all that wipes it. No save may carry that id — ever.
    expect(saves().some((s) => s.sceneId === DESIGN.id)).toBe(false);
  });
});

// ── 5. Same-scene mode ──────────────────────────────────────────────────────

describe("designing the screen that is already on the board", () => {
  it("borrows nothing, restores nothing, and «Ferdig» KEEPS the work", async () => {
    await enterDesign(LESSON);

    const session = designSession.value;
    expect(session?.returnTo).toBe(null);
    expect(loadCount()).toBe(0);
    expect(activeScene.value).toBe(LESSON);

    // Editing here IS editing the board — which is why there is no restore.
    widgets.value = [A, B];
    saveNow();
    await flushPending();
    await exitDesign();

    expect(designSession.value).toBe(null);
    expect(activeScene.value).toBe(LESSON);
    // A restore in this mode would have thrown the edit away on the press of
    // a button called «Ferdig».
    expect(widgets.value).toEqual([A, B]);
    expect(saves().every((s) => s.sceneId === LESSON.id)).toBe(true);
  });
});

// ── 6. The restore is from memory ───────────────────────────────────────────

describe("the way home is held in memory", () => {
  it("re-reads nothing on the way out", async () => {
    widgets.value = [A, B];
    await enterDesign(DESIGN);
    expect(loadCount()).toBe(1);
    expect(widgets.value).toEqual([D1]);

    widgets.value = [D1, D2];
    await exitDesign();

    // The lesson's rows on disk were never touched, so a re-read could only
    // add a second chance to fail at something that cannot have changed.
    expect(loadCount()).toBe(1);
    expect(activeScene.value).toBe(LESSON);
    expect(widgets.value).toEqual([A, B]);
  });

  it("hands back a board that was never READ as one that was never read", async () => {
    // The lesson's own load failed at boot: the store is blocking every save.
    layoutHydrated.value = false;

    await enterDesign(DESIGN);
    // The design scene DID load, so its own edits save normally.
    expect(layoutHydrated.value).toBe(true);

    await exitDesign();

    // Handing it back as hydrated would unblock replace-all writes against a
    // layout nobody read — funn S#4 arrived at from the other end.
    expect(layoutHydrated.value).toBe(false);
    const mark = calls.length;
    widgets.value = [A, B];
    saveNow();
    await flushPending();
    expect(saves(mark)).toEqual([]);
  });
});

// ── 7. The view state never crosses a board swap ────────────────────────────

describe("selection, focus and the pending undo never cross the borrow", () => {
  it("clears all three on the way in AND on the way out", async () => {
    selectedWidgetId.value = "a";
    focusedWidgetId.value = "a";
    undoSlot.value = { widget: B };

    await enterDesign(DESIGN);

    // `undoRemove` writes into whatever scene is active NOW (R3-funn 3.2): an
    // Undo tapped after the borrow would have put the lesson's card into the
    // screen being designed, and saved it there.
    expect(selectedWidgetId.value).toBe(null);
    expect(focusedWidgetId.value).toBe(null);
    expect(undoSlot.value).toBe(null);

    selectedWidgetId.value = "d1";
    focusedWidgetId.value = "d1";
    undoSlot.value = { widget: D2 };

    await exitDesign();

    expect(selectedWidgetId.value).toBe(null);
    expect(focusedWidgetId.value).toBe(null);
    expect(undoSlot.value).toBe(null);
  });

  it("clears them in same-scene mode too", async () => {
    selectedWidgetId.value = "a";
    focusedWidgetId.value = "a";
    undoSlot.value = { widget: B };

    await enterDesign(LESSON);

    // The board is about to be drawn at a fraction of its size inside a panel;
    // an enlarged card and a selection carried into that are noise at best.
    expect(selectedWidgetId.value).toBe(null);
    expect(focusedWidgetId.value).toBe(null);
    expect(undoSlot.value).toBe(null);
  });
});

// ── 8. Re-entry ─────────────────────────────────────────────────────────────

describe("a second enterDesign while one is open", () => {
  it("does nothing at all", async () => {
    await enterDesign(DESIGN);
    const mark = calls.length;

    await enterDesign(OTHER);

    // Two «Design»-buttons on the same panel are one mis-aimed click apart.
    // A nested borrow would overwrite `returnTo` with the DESIGN board — the
    // way home replaced by where we already are, and the lesson's screen only
    // recoverable by rebooting.
    expect(designSession.value?.scene.id).toBe(DESIGN.id);
    expect(designSession.value?.returnTo?.scene).toBe(LESSON);
    expect(calls.slice(mark)).toEqual([]);
  });
});

// ── The failed write, which must not trap the projector ─────────────────────

describe("a save that fails on the way out", () => {
  it("leaves the chip standing and hands the board back anyway", async () => {
    await enterDesign(DESIGN);
    saveFails = true;
    widgets.value = [D1, D2];
    saveSoon();

    await exitDesign();

    // The house never fabricates a success: `saveError` is the shell's sticky
    // chip and it stays up. But refusing to give the projector its screen back
    // because a save failed would turn one lost edit into a lesson spent
    // looking at the wrong board.
    expect(saveError.value).toBe(true);
    expect(designSession.value).toBe(null);
    expect(activeScene.value).toBe(LESSON);
    expect(widgets.value).toEqual([A]);
  });
});
