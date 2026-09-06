import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RETAINED_BYTES_MAX,
  acquire,
  base64Decoder,
  decodeBase64Loop,
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

/** A blob of a stated SIZE and nothing else. The retention budget is counted
 *  in bytes, and allocating tens of megabytes to prove arithmetic would be a
 *  slow way to test the one property that is read (`.size`). */
const sizedBlob = (bytes: number) =>
  ({ size: bytes, type: "image/png" }) as unknown as Blob;

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

    expect(a).toEqual({ state: "ok", url: f.created[0] });
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

  it("keeps nothing alive while a card still holds it", async () => {
    const load = async () => someBlob();
    await acquire("pic", load, f.urls);
    await acquire("pic", load, f.urls);

    release("pic", f.urls);
    expect(f.revoked).toHaveLength(0);
    expect(refCount("pic")).toBe(1);
  });

  // ── The retention budget (R7-ytelse funn 1) ───────────────────────────────

  it("the LAST release keeps the URL, so coming back to the screen costs nothing", async () => {
    // The measured bug: five s1↔s2 round trips were five full `image_load`s,
    // ~13 MiB of JSON and a main-thread decode each — on a switch the
    // planner's auto-switch performs for her at every lesson start.
    const load = vi.fn(async () => someBlob());
    const first = await acquire("pic", load, f.urls);
    release("pic", f.urls);
    expect(f.revoked).toHaveLength(0);

    const again = await acquire("pic", load, f.urls);
    expect(again).toEqual(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(f.created).toHaveLength(1);

    // …and it is a real claim again, not a lucky read of a dead entry.
    expect(refCount("pic")).toBe(1);
  });

  it("a second release of the same card charges the budget once, not twice", async () => {
    // Three pictures at a third of the budget each fit exactly. Releasing the
    // first one TWICE used to book its bytes twice, so the third arrival
    // pushed the total over and evicted a picture that was within budget —
    // the very reload the retention queue exists to avoid.
    const third = RETAINED_BYTES_MAX / 3;
    const first = await acquire("a", async () => sizedBlob(third), f.urls);
    release("a", f.urls);
    release("a", f.urls);
    for (const id of ["b", "c"]) {
      await acquire(id, async () => sizedBlob(third), f.urls);
      release(id, f.urls);
    }
    expect(f.revoked).toHaveLength(0);

    const reload = vi.fn(async () => sizedBlob(third));
    expect(await acquire("a", reload, f.urls)).toEqual(first);
    expect(reload).not.toHaveBeenCalled();
  });

  it("evicts the OLDEST retained picture when the budget is spent, and revokes it", async () => {
    // Three pictures at half the budget each: retaining the third pushes the
    // total to 1.5×, so exactly one — the oldest — has to go.
    const half = RETAINED_BYTES_MAX / 2;
    const urls: string[] = [];
    for (const id of ["one", "two", "three"]) {
      const got = await acquire(id, async () => sizedBlob(half), f.urls);
      urls.push(got.state === "ok" ? got.url : "");
      release(id, f.urls);
    }

    expect(f.revoked).toEqual([urls[0]]);

    // The two survivors answer from memory; the evicted one loads again.
    const reload = vi.fn(async () => sizedBlob(half));
    await acquire("three", reload, f.urls);
    await acquire("two", reload, f.urls);
    expect(reload).not.toHaveBeenCalled();
    await acquire("one", reload, f.urls);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a picture bigger than the whole budget is not kept", async () => {
    const big = RETAINED_BYTES_MAX + 1;
    const got = await acquire("huge", async () => sizedBlob(big), f.urls);
    release("huge", f.urls);
    expect(f.revoked).toEqual([got.state === "ok" ? got.url : ""]);
  });

  it("a reset drops the retained pictures too", async () => {
    await acquire("pic", async () => someBlob(), f.urls);
    release("pic", f.urls);
    expect(f.live()).toBe(1);

    resetBlobCache(f.urls);
    expect(f.live()).toBe(0);

    // …and the budget went with them: the next release retains from zero.
    const load = vi.fn(async () => sizedBlob(RETAINED_BYTES_MAX));
    await acquire("pic", load, f.urls);
    release("pic", f.urls);
    await acquire("pic", load, f.urls);
    expect(load).toHaveBeenCalledTimes(1);
  });

  // ── The three outcomes (R7-funn L9) ───────────────────────────────────────

  it("answers «mangler» for a picture the backend does not have, and takes no URL", async () => {
    const load = vi.fn(async () => null);
    expect(await acquire("gone", load, f.urls)).toEqual({ state: "missing" });
    expect(f.created).toHaveLength(0);

    // A second card asking for the same missing picture does NOT re-ask —
    // the entry is alive for as long as something holds it.
    expect(await acquire("gone", load, f.urls)).toEqual({ state: "missing" });
    expect(load).toHaveBeenCalledTimes(1);

    release("gone", f.urls);
    release("gone", f.urls);
    expect(f.revoked).toHaveLength(0);
  });

  it("a load that REJECTS says «kunne ikke lese», never «mangler»", async () => {
    // The two used to be the same answer, which told the teacher her picture
    // was lost — the wrong sentence AND the wrong remedy — for one IPC
    // hiccup.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = async () => {
      throw new Error("ipc died");
    };
    expect(await acquire("boom", load, f.urls)).toEqual({
      state: "unreadable",
    });
    release("boom", f.urls);
    expect(refCount("boom")).toBe(0);
    expect(f.live()).toBe(0);
    warn.mockRestore();
  });

  it("a failed read is never the cached answer to the next mount", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<Blob | null>>()
      .mockRejectedValueOnce(new Error("ipc died"))
      .mockResolvedValue(someBlob());

    expect(await acquire("pic", load, f.urls)).toEqual({
      state: "unreadable",
    });
    // The remount («Prøv å lese på nytt» is a release-then-acquire).
    release("pic", f.urls);
    expect(await acquire("pic", load, f.urls)).toEqual({
      state: "ok",
      url: f.created[0],
    });
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a second card asking after a failure re-asks rather than inheriting it", async () => {
    // The entry STAYS while the first card holds it — the refcount has to
    // keep its meaning — but the failure is not an answer, so the new claim
    // is a new question.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<Blob | null>>()
      .mockRejectedValueOnce(new Error("ipc died"))
      .mockResolvedValue(someBlob());

    expect(await acquire("pic", load, f.urls)).toEqual({
      state: "unreadable",
    });
    expect(await acquire("pic", load, f.urls)).toEqual({
      state: "ok",
      url: f.created[0],
    });
    expect(refCount("pic")).toBe(2);

    release("pic", f.urls);
    release("pic", f.urls);
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

    expect(await pending).toEqual({ state: "missing" });
    expect(f.live()).toBe(0);
    expect(refCount("slow")).toBe(0);

    // …and the next mount starts clean.
    const again = await acquire("slow", async () => someBlob(), f.urls);
    expect(again).toEqual({
      state: "ok",
      url: f.created[f.created.length - 1],
    });
  });

  it("releasing something never acquired does nothing at all", () => {
    release("never", f.urls);
    expect(refCount("never")).toBe(0);
    expect(f.revoked).toHaveLength(0);
  });

  it("keeps two different pictures apart", async () => {
    const a = await acquire("one", async () => someBlob(), f.urls);
    const b = await acquire("two", async () => someBlob(), f.urls);
    expect(a).not.toEqual(b);

    release("one", f.urls);
    // Retained, not revoked — but still nothing to do with «two».
    expect(f.revoked).toHaveLength(0);
    expect(refCount("two")).toBe(1);
    expect(refCount("one")).toBe(0);
  });
});

describe("decoding what the backend sent", () => {
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

  it("throws on base64 that does not decode — the caller turns it into «kunne ikke lese»", () => {
    expect(() =>
      decodeStoredImage({ mime: "image/png", bytesBase64: "not base64 ###" }),
    ).toThrow();
  });

  it("the fast path and the loop agree, byte for byte", async () => {
    // The whole risk in a feature-detected fast path: the two produce
    // different bytes on some input and the picture is subtly wrong on
    // exactly the machines that have the new engine. A photograph is
    // arbitrary bytes, so the case table is arbitrary bytes — including the
    // three padding shapes, which is where a hand-rolled decoder goes wrong.
    const cases = [
      "",
      "AA==",
      "AAE=",
      "AAECAw==",
      "/w==",
      "//79/A==",
      Buffer.from(
        Uint8Array.from({ length: 3000 }, (_, i) => (i * 37) % 256),
      ).toString("base64"),
    ];
    // Node 24 has no `Uint8Array.fromBase64`, so the engine's own decoder
    // stands in for it — what is under test is that `decodeStoredImage`
    // honours the injected decoder and that the LOOP agrees with a decoder
    // written by somebody else.
    const fast = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
    for (const b64 of cases) {
      const viaLoop = await decodeStoredImage(
        { mime: "image/png", bytesBase64: b64 },
        decodeBase64Loop,
      ).arrayBuffer();
      const viaFast = await decodeStoredImage(
        { mime: "image/png", bytesBase64: b64 },
        fast,
      ).arrayBuffer();
      expect(new Uint8Array(viaLoop), b64).toEqual(new Uint8Array(viaFast));
    }
  });

  it("picks the engine's decoder when there is one, and the loop when there is not", () => {
    // The detect cannot be tested against the gate's own runtime — that is
    // what a feature detect is FOR — so the constructor is injected.
    const fromBase64 = vi.fn(() => new Uint8Array([1, 2, 3]));
    expect(base64Decoder({ fromBase64 })("AQID")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(fromBase64).toHaveBeenCalledWith("AQID");

    expect(base64Decoder({})).toBe(decodeBase64Loop);
  });
});
