import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquire,
  decodeStoredImage,
  refCount,
  release,
  resetBlobCache,
  type UrlFactory,
} from "./blob-cache";

/** A stand-in for the two browser calls: node has neither, and what is under
 *  test is the bookkeeping around them, not the browser. */
function fakeUrls() {
  const created: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  const urls: UrlFactory = {
    create: () => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    },
    revoke: (url) => void revoked.push(url),
  };
  return {
    urls,
    created,
    revoked,
    live: () => created.length - revoked.length,
  };
}

const someBlob = () => new Blob(["bytes"], { type: "image/png" });

describe("blob-cache", () => {
  let f: ReturnType<typeof fakeUrls>;

  beforeEach(() => {
    // Reset with a SILENT factory before the counting one is installed —
    // otherwise the previous test's leftovers are revoked through this
    // test's recorder and every count starts one high.
    resetBlobCache({ create: () => "", revoke: () => {} });
    f = fakeUrls();
  });

  it("loads once and hands the same URL to every card showing the picture", async () => {
    const load = vi.fn(async () => someBlob());
    const a = await acquire("pic", load, f.urls);
    const b = await acquire("pic", load, f.urls);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refCount("pic")).toBe(2);
    expect(f.created).toHaveLength(1);
  });

  it("two cards mounting TOGETHER still fetch once", async () => {
    // The real shape: both effects run in the same tick, so the second
    // `acquire` sees an in-flight load rather than a finished one.
    const load = vi.fn(async () => someBlob());
    const [a, b] = await Promise.all([
      acquire("pic", load, f.urls),
      acquire("pic", load, f.urls),
    ]);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refCount("pic")).toBe(2);
  });

  it("revokes only when the LAST card lets go", async () => {
    const load = async () => someBlob();
    await acquire("pic", load, f.urls);
    await acquire("pic", load, f.urls);

    release("pic", f.urls);
    expect(f.revoked).toHaveLength(0);
    expect(refCount("pic")).toBe(1);

    release("pic", f.urls);
    expect(f.revoked).toEqual(f.created);
    expect(f.live()).toBe(0);
  });

  it("loads fresh after the last release, so a re-mount is not a stale URL", async () => {
    const load = vi.fn(async () => someBlob());
    await acquire("pic", load, f.urls);
    release("pic", f.urls);
    await acquire("pic", load, f.urls);

    expect(load).toHaveBeenCalledTimes(2);
    expect(f.created).toHaveLength(2);
    expect(f.revoked).toEqual([f.created[0]]);
  });

  it("answers null for a picture the backend does not have, and takes no URL", async () => {
    const load = vi.fn(async () => null);
    expect(await acquire("gone", load, f.urls)).toBeNull();
    expect(f.created).toHaveLength(0);

    // A second card asking for the same missing picture does NOT re-ask —
    // the entry is alive for as long as something holds it.
    expect(await acquire("gone", load, f.urls)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);

    release("gone", f.urls);
    release("gone", f.urls);
    expect(f.revoked).toHaveLength(0);
  });

  it("a load that REJECTS answers null and leaves nothing behind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = async () => {
      throw new Error("ipc died");
    };
    expect(await acquire("boom", load, f.urls)).toBeNull();
    release("boom", f.urls);
    expect(refCount("boom")).toBe(0);
    expect(f.live()).toBe(0);
    warn.mockRestore();
  });

  it("a card that unmounts mid-load leaks nothing", async () => {
    // The race this module exists for: the teacher drags a card away (or
    // swaps the picture) while 13 MiB of base64 is still in flight. The blob
    // arrives with nobody to hold it, and must not stay alive.
    let settle: (blob: Blob) => void = () => {};
    const load = () =>
      new Promise<Blob | null>((resolve) => {
        settle = resolve;
      });

    const pending = acquire("slow", load, f.urls);
    release("slow", f.urls);
    settle(someBlob());

    expect(await pending).toBeNull();
    expect(f.live()).toBe(0);
    expect(refCount("slow")).toBe(0);

    // …and the next mount starts clean.
    const again = await acquire("slow", async () => someBlob(), f.urls);
    expect(again).toBe(f.created[f.created.length - 1]);
  });

  it("releasing something never acquired does nothing at all", () => {
    release("never", f.urls);
    expect(refCount("never")).toBe(0);
    expect(f.revoked).toHaveLength(0);
  });

  it("decodes what the backend sent, carrying the sniffed type across", async () => {
    // «PNG» as base64 — the shape matters, not the picture.
    const blob = decodeStoredImage({
      mime: "image/png",
      bytesBase64: "iVBORw0KGgo=",
    });
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it("throws on base64 that does not decode — the caller turns it into «missing»", () => {
    expect(() =>
      decodeStoredImage({ mime: "image/png", bytesBase64: "not base64 ###" }),
    ).toThrow();
  });

  it("keeps two different pictures apart", async () => {
    const a = await acquire("one", async () => someBlob(), f.urls);
    const b = await acquire("two", async () => someBlob(), f.urls);
    expect(a).not.toBe(b);

    release("one", f.urls);
    expect(f.revoked).toEqual([a]);
    expect(refCount("two")).toBe(1);
  });
});
