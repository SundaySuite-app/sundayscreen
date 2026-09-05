// The thumbnail cache, against a hand-driven `layout_load`.
//
// The module was the only new one in R6 without a test file, and the bug the
// granskeren found lived exactly there (R6-F5): an entry could be left in
// `loading` FOREVER, because the write-guard that discards a stale answer
// returned before undoing the `loading` it had written — and `ensureThumb`
// no-ops on an entry of any kind, so nothing ever asked again.
//
// Every load below is DEFERRED and settled by hand. A cache with a race in it
// cannot be tested with promises that resolve on their own: the whole question
// is what happens between the call and the answer.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WidgetInstance } from "../bindings/WidgetInstance";
import {
  ensureThumb,
  invalidateAllThumbs,
  invalidateThumb,
  thumbCache,
} from "./scene-thumbs";

function widget(id: string): WidgetInstance {
  return {
    id,
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    z: 0,
    config: { kind: "clock", showSeconds: false } as WidgetInstance["config"],
  };
}

/** One in-flight `layout_load`, settled from the test body. */
interface Pending {
  sceneId: string;
  resolve: (items: WidgetInstance[]) => void;
  reject: (e: unknown) => void;
}

let pending: Pending[] = [];

const layoutLoad = vi.fn(
  (sceneId: string) =>
    new Promise<WidgetInstance[]>((resolve, reject) => {
      pending.push({ sceneId, resolve, reject });
    }),
);

vi.stubGlobal("window", { api: { layoutLoad } });

/** The oldest un-settled load for `sceneId`, removed from the queue. */
function take(sceneId: string): Pending {
  const i = pending.findIndex((p) => p.sceneId === sceneId);
  expect(i, `no in-flight layout_load for ${sceneId}`).toBeGreaterThanOrEqual(
    0,
  );
  return pending.splice(i, 1)[0];
}

/** Let the microtask queue drain so a settled load has run its `.then`. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const entry = (sceneId: string) => thumbCache.value.get(sceneId);

beforeEach(() => {
  pending = [];
  layoutLoad.mockClear();
  invalidateAllThumbs();
});

describe("ensureThumb", () => {
  it("asks once, and the answer becomes the picture", async () => {
    void ensureThumb("a");
    // Synchronously, BEFORE the await: the cell has something to draw and the
    // next render has a reason not to ask again.
    expect(entry("a")).toEqual({ status: "loading" });

    take("a").resolve([widget("w1")]);
    await flush();
    expect(entry("a")).toEqual({ status: "ready", items: [widget("w1")] });

    // A second call is a no-op — this is the forty-cells-one-read contract.
    await ensureThumb("a");
    expect(layoutLoad).toHaveBeenCalledTimes(1);
  });

  it("a failed read is REMEMBERED as an error, never as an empty board", async () => {
    void ensureThumb("a");
    take("a").reject(new Error("database is locked"));
    await flush();
    // F13: `{ items: [] }` here would tell the teacher the screen is empty on
    // the strength of a read that never landed.
    expect(entry("a")).toEqual({ status: "error" });

    // And it is not retried on every render — forty cells retrying a dead
    // backend is a spin, not a recovery.
    await ensureThumb("a");
    expect(layoutLoad).toHaveBeenCalledTimes(1);
  });

  it("a stale answer is discarded rather than written", async () => {
    void ensureThumb("a");
    // «Ferdig» on a design session: the board changed under the read.
    invalidateThumb("a");
    take("a").resolve([widget("before-the-edits")]);
    await flush();
    // The pre-edit picture is NOT what the planner shows.
    expect(entry("a")).toBeUndefined();

    // …and the next render reads again and gets the new one.
    void ensureThumb("a");
    take("a").resolve([widget("after-the-edits")]);
    await flush();
    expect(entry("a")).toEqual({
      status: "ready",
      items: [widget("after-the-edits")],
    });
    expect(layoutLoad).toHaveBeenCalledTimes(2);
  });
});

// ── R6-F5: the two probes that proved the bug ───────────────────────────────

describe("an invalidation never leaves an absorbing «loading»", () => {
  it("PROBE 1 — a load discarded by ANOTHER screen's invalidation heals", async () => {
    // The scenario the granskeren reproduced: two cells in the week grid, one
    // of them invalidated while the other's read is in the air. The guard is
    // global, so A's answer is discarded too — which is fine and cheap. What
    // was NOT fine is that A's `loading` stayed behind: `ensureThumb` no-ops
    // on an entry of any kind, so nothing asked again and the cell showed a
    // placeholder for the rest of the session.
    void ensureThumb("a");
    void ensureThumb("b");
    expect(entry("a")).toEqual({ status: "loading" });

    invalidateThumb("b");
    take("a").resolve([widget("w1")]);
    await flush();

    // NOT `{ status: "loading" }` — that was the bug, and it was permanent.
    expect(entry("a")).toBeUndefined();

    // The next render of the cell asks again, and now it draws.
    void ensureThumb("a");
    take("a").resolve([widget("w1")]);
    await flush();
    expect(entry("a")).toEqual({ status: "ready", items: [widget("w1")] });
  });

  it("PROBE 2 — a FAILED load discarded that way still reaches «error»", async () => {
    // The same shape, one step worse: the read failed, so the honest answer is
    // `error` — the state the module's own header promises and the one
    // `SceneThumb` draws its dashed frame for. Stuck in `loading` it read as
    // «still working on it», forever, about a backend that had already said no.
    void ensureThumb("a");
    void ensureThumb("b");
    invalidateThumb("b");
    take("a").reject(new Error("database is locked"));
    await flush();
    expect(entry("a")).toBeUndefined();

    void ensureThumb("a");
    take("a").reject(new Error("database is locked"));
    await flush();
    expect(entry("a")).toEqual({ status: "error" });
  });

  it("a discarded load does not evict its SUCCESSOR's entry", async () => {
    // Dropping the stale entry is what heals the cell — but only the load that
    // wrote it may drop it. Between the invalidation and the land there may
    // already be a newer read holding a `loading` of its own for the same
    // screen, and taking that one away would put the cell back to «no entry»
    // and start a third read: the spin the cache exists to prevent.
    void ensureThumb("a");
    const first = take("a");
    invalidateThumb("a");

    void ensureThumb("a"); // the successor
    expect(layoutLoad).toHaveBeenCalledTimes(2);

    first.resolve([widget("stale")]);
    await flush();
    // The successor's `loading` survived …
    expect(entry("a")).toEqual({ status: "loading" });
    expect(layoutLoad).toHaveBeenCalledTimes(2);

    // … and it is the one that answers.
    take("a").resolve([widget("fresh")]);
    await flush();
    expect(entry("a")).toEqual({ status: "ready", items: [widget("fresh")] });
  });
});

describe("invalidateAllThumbs", () => {
  it("is the retry for every screen whose read failed", async () => {
    void ensureThumb("a");
    take("a").reject(new Error("database is locked"));
    await flush();
    expect(entry("a")).toEqual({ status: "error" });

    // The planner opening — «open it again» IS the retry.
    invalidateAllThumbs();
    expect(thumbCache.value.size).toBe(0);

    void ensureThumb("a");
    take("a").resolve([widget("w1")]);
    await flush();
    expect(entry("a")).toEqual({ status: "ready", items: [widget("w1")] });
  });
});
