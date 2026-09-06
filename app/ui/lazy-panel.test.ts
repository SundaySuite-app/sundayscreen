// The two promises the panel boundary makes about a chunk (ADR-019), with the
// loader INJECTED so both are decided in the node pass: the module is fetched
// once per session, and a failure is not remembered.
//
// The component half is deliberately absent — it is four lines of `useState` +
// `useEffect` over exactly this, and asserting it would need a DOM. What a
// running shell has to prove instead (no request before the first open, one
// request per session, Escape during the load window) is in
// `e2e/lazy-panels.spec.ts`, where the real bundler and the real network are.

import { describe, expect, it } from "vitest";

import { chunkCache } from "./lazy-panel";

/** A loader whose settling this test decides, plus a call count. */
function deferredLoader<T>() {
  const calls: {
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const load = () =>
    new Promise<T>((resolve, reject) => calls.push({ resolve, reject }));
  return { load, calls };
}

describe("chunkCache", () => {
  it("fetches the chunk ONCE however many times it is asked for", async () => {
    const { load, calls } = deferredLoader<string>();
    const cache = chunkCache(load);

    const a = cache.load();
    const b = cache.load();
    expect(calls).toHaveLength(1);

    calls[0].resolve("panel");
    expect(await a).toBe("panel");
    expect(await b).toBe("panel");

    // …and once it has landed, a third ask is not a fetch either.
    expect(await cache.load()).toBe("panel");
    expect(calls).toHaveLength(1);
  });

  it("answers SYNCHRONOUSLY once the chunk has landed", async () => {
    const { load, calls } = deferredLoader<string>();
    const cache = chunkCache(load);

    // Before: nothing to render, and asking must not have started a load.
    expect(cache.ready()).toBeNull();

    const p = cache.load();
    expect(cache.ready()).toBeNull();
    calls[0].resolve("panel");
    await p;

    // After: the second open mounts in the click's own commit rather than a
    // tick later, which is the whole reason this is not just a promise.
    expect(cache.ready()).toBe("panel");
  });

  it("FORGETS a failure, so the next open really retries", async () => {
    const { load, calls } = deferredLoader<string>();
    const cache = chunkCache(load);

    const first = cache.load();
    calls[0].reject(new Error("disk"));
    await expect(first).rejects.toThrow("disk");
    // Nothing was learned: not a cached failure, not a half-ready module.
    expect(cache.ready()).toBeNull();

    const second = cache.load();
    expect(calls).toHaveLength(2);
    calls[1].resolve("panel");
    expect(await second).toBe("panel");
    expect(cache.ready()).toBe("panel");
  });

  it("does not cache a loader that throws SYNCHRONOUSLY either", async () => {
    let attempts = 0;
    const cache = chunkCache<string>(() => {
      attempts++;
      if (attempts === 1) throw new Error("resolver blew up");
      return Promise.resolve("panel");
    });

    // A synchronous throw must come back as a rejection — the caller has one
    // failure path, not two — and must leave the slot as empty as an
    // asynchronous one does.
    await expect(cache.load()).rejects.toThrow("resolver blew up");
    expect(cache.ready()).toBeNull();

    expect(await cache.load()).toBe("panel");
    expect(attempts).toBe(2);
  });
});
