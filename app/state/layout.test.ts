// The persister's three load-bearing pieces, tested directly.
//
// `app/state/layout.ts` is 296 lines of persistence logic with no unit test
// of its own, and the two pieces that carry promise 4 — «en skriving som
// feiler REJECTER» — are exactly the ones no other tier can reach:
//
//   - the GUARD (F9-funn S#4): while the stored board has not been read,
//     every save is refused. A replace-all against a layout we never loaded
//     is a one-edit wipe.
//   - the FLAG (F9-funn U#1): a refused write sets `saveError`, which is the
//     shell's sticky chip — the only place a failed save is ever VISIBLE.
//   - the CHAIN (F9-funn S#2): writes are serialised, and each one reads the
//     board at WRITE time, so two replace-alls can never commit out of order
//     and resurrect a deletion.
//
// Node environment, like every unit test in this repo (never jsdom): nothing
// here needs a DOM — `window.api` is stubbed, and the store is pure signals.
//
// ## The test that cannot be written
//
// «Resolve write 1 LAST and check the argument order» is impossible by
// construction: `flush()` builds each write as `inflight.then(...)`, so write
// 2 does not EXIST until write 1 has settled. The serialisation is asserted
// from the other side instead — while write 1 hangs, a second `saveNow()`
// produces no second call at all.
//
// ## Module state outlives a test
//
// `inflight` and `debounceTimer` are module-private and survive from one test
// to the next, so `afterEach` drains them (`flushPending`) after releasing
// whatever the test left deferred, and `beforeEach` re-seeds the signals
// through the store's own door, `adoptSnapshot`.

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
  adoptSnapshot,
  flushPending,
  layoutHydrated,
  saveError,
  saveNow,
  saveSoon,
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
const B = textWidget("b");

/** One `layout_save` whose fate the test decides — the slow disk. */
interface Deferred {
  resolve: () => void;
  reject: (e: unknown) => void;
}
const pending: Deferred[] = [];

/** While true a save lands immediately. Used only to DRAIN the queue in
 *  `afterEach`; a test that left a write deferred would otherwise hang
 *  `flushPending` forever. */
let autoSettle = false;

const layoutSave = vi.fn((_sceneId: string, _widgets: WidgetInstance[]) => {
  if (autoSettle) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    pending.push({ resolve: () => resolve(), reject });
  });
});

// `flush()` reads `window.api` at WRITE time, so stubbing here — after the
// module graph has been imported — is enough. Nothing in the store's import
// chain touches `window` while loading.
vi.stubGlobal("window", { api: { layoutSave } });

/** Let the already-queued microtasks run; the write chain hops a few. */
async function microtasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Wait until the store has actually CALLED save `n` times — a queued write
 *  only becomes a call one microtask later. */
async function untilCalls(n: number): Promise<void> {
  for (let i = 0; i < 100 && layoutSave.mock.calls.length < n; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  layoutSave.mockClear();
  pending.length = 0;
  autoSettle = false;
  // The store's own seeding door, and the one every switch runs through:
  // class, scene, widgets, `layoutHydrated`, the selection and the undo slot
  // in one move. Nothing new is exported from layout.ts for the test's sake.
  adoptSnapshot({ class: CLASS, scene: SCENE, members: [], widgets: [] });
  // `adoptSnapshot` deliberately does NOT touch the error flag — it is about
  // the STORE, not the board — so a previous test's failure would leak in.
  saveError.value = false;
});

afterEach(async () => {
  autoSettle = true;
  for (const d of pending.splice(0)) d.resolve();
  await flushPending();
  autoSettle = false;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the guard: a board that was never read is never written", () => {
  it("refuses every save while the load has not landed", async () => {
    // Nothing should reach the disk here, so let a write — if one escapes —
    // land at once. The failure then reads as the assertion it is, instead of
    // a `flushPending` that hangs on a write that should never have existed.
    autoSettle = true;
    // The state after `initLayout`'s catch: widgets emptied, hydration false.
    layoutHydrated.value = false;
    widgets.value = [A];

    // Both doors, and the explicit drain — a refusal that only held until the
    // next flush would still wipe the stored board.
    saveNow();
    await flushPending();
    saveSoon();
    await flushPending();

    expect(layoutSave).not.toHaveBeenCalled();

    // …and the assertion is not vacuous: the same edit through the same door
    // writes the moment the load HAS landed.
    layoutHydrated.value = true;
    saveNow();
    await untilCalls(1);
    expect(layoutSave).toHaveBeenCalledTimes(1);
  });
});

describe("the flag: a failed save is visible, and stops being visible", () => {
  it("raises `saveError` on a refusal and lowers it on the next success", async () => {
    expect(saveError.value).toBe(false);

    widgets.value = [A];
    saveNow();
    await untilCalls(1);
    pending[0].reject(new Error("database is locked"));
    await flushPending();
    // This is the whole of «Klarte ikke å lagre tavla …» in the shell.
    expect(saveError.value).toBe(true);

    widgets.value = [A, B];
    saveNow();
    await untilCalls(2);
    pending[1].resolve();
    await flushPending();
    // A sticky chip that never unsticks is its own lie: the next write that
    // lands has to clear it.
    expect(saveError.value).toBe(false);
  });
});

describe("the chain: writes are serialised", () => {
  it("queues the second write behind the first and writes the board as it is then", async () => {
    // Write 1 is on the wire (a slow disk) and has read `[A]`.
    widgets.value = [A];
    saveNow();
    await untilCalls(1);
    expect(layoutSave.mock.calls[0][0]).toBe(SCENE.id);
    expect(layoutSave.mock.calls[0][1]).toEqual([A]);

    // The teacher edits again while it hangs. The second write is CHAINED
    // onto the first, so it does not exist yet — this is the serialisation,
    // asserted from the only side it can be asserted from.
    widgets.value = [A, B];
    saveNow();
    await microtasks();
    expect(layoutSave).toHaveBeenCalledTimes(1);

    // The disk answers; the queued write runs now, and carries the board.
    pending[0].resolve();
    await untilCalls(2);
    expect(layoutSave).toHaveBeenCalledTimes(2);
    expect(layoutSave.mock.calls[1][1]).toEqual([A, B]);
  });

  it("reads the widgets at WRITE time, so a queued write cannot resurrect a deletion", async () => {
    // The same shape, with the edit that makes the difference visible: a
    // widget REMOVED after the second save was queued. Capturing the list at
    // QUEUE time would write `[A, B]` back over the removal — a replace-all
    // resurrecting a card the teacher already deleted (F9-funn S#2).
    widgets.value = [A];
    saveNow();
    await untilCalls(1);

    widgets.value = [A, B];
    saveNow();
    await microtasks();
    expect(layoutSave).toHaveBeenCalledTimes(1);

    widgets.value = [B];
    pending[0].resolve();
    await untilCalls(2);
    expect(layoutSave.mock.calls[1][1]).toEqual([B]);
  });
});
