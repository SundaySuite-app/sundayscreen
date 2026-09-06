// One object URL per picture, reference-counted — the whole `URL.revokeObject`
// discipline in ONE place.
//
// ## Why it has to be a cache and not a `useEffect`
//
// A picture crosses the IPC boundary as base64: a 10 MiB photograph is ~13 MiB
// of JSON per load. Two cards showing the same picture — an ordinary thing
// after `scene_duplicate`, which copies configs raw — would fetch it twice and
// hold two copies of the bytes. And an object URL that is never revoked keeps
// its blob alive for the lifetime of the document, so a teacher who swaps the
// picture on a card twenty times in a lesson leaks twenty blobs.
//
// So: one entry per `imageId`, `acquire`/`release` around it, and the URL is
// revoked when the picture is let go — but not the INSTANT it is, see the
// retention budget below.
//
// ## Why the URL factory is injected
//
// Vitest runs in NODE (never jsdom — CLAUDE.md), so `URL.createObjectURL` does
// not exist there. Passing the two functions in makes the refcounting testable
// as what it is: bookkeeping. The component passes the real pair.

import { LIMITS } from "@lib/limits.generated";

/** The two browser calls this module is disciplined about. */
export interface UrlFactory {
  create(blob: Blob): string;
  revoke(url: string): void;
}

/** The real pair, for the component. */
export const browserUrls: UrlFactory = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

// ── Decoding what the backend sent ──────────────────────────────────────────

/** base64 in, bytes out. Injected so BOTH implementations below are node
 *  testable, on a runtime that has only one of them. */
export type Base64Decoder = (b64: string) => Uint8Array;

/**
 * The decoder every runtime has: `atob` plus a copy loop.
 *
 * It is a byte-at-a-time loop across ~13 MiB for a picture at the ceiling
 * (`IMAGE_FILE_MAX_BYTES`), and it runs on the MAIN thread — measured at 50 ms
 * on a fast Mac and 166 ms with the CPU throttled to a 6-year-old classroom
 * PC. That is the board frozen mid-lesson, so it is the fallback and not the
 * first choice.
 */
export function decodeBase64Loop(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Just the part of the `Uint8Array` constructor this module asks about. It is
 *  described here rather than declared into the global lib on purpose: the
 *  method is newer than the TypeScript version this repo pins, and a global
 *  declaration would make it look present to every other file. */
export interface Base64Capable {
  fromBase64?: (b64: string) => Uint8Array;
}

/** The real constructor, seen through that hole. */
const UINT8: Base64Capable = Uint8Array as unknown as Base64Capable;

/**
 * The decoder THIS runtime can offer, chosen once.
 *
 * `Uint8Array.fromBase64` does the same work inside the engine — measured 8×
 * faster on the same 10 MiB picture — but it is recent (Safari 18.2, Chromium
 * 133), and SundayScreen ships into whatever WKWebView/WebView2 the school's
 * machine has. So it is FEATURE-DETECTED, never assumed, and the loop above
 * stays as the answer for an older webview rather than as dead code.
 *
 * The constructor is a parameter so a node test can drive both branches: the
 * unit gate's own runtime has whichever one it has, which is precisely the
 * thing a feature detect must not be tested against.
 */
export function base64Decoder(ctor: Base64Capable = UINT8): Base64Decoder {
  const fast = ctor.fromBase64;
  return fast ? (b64) => fast.call(ctor, b64) : decodeBase64Loop;
}

const decodeBase64 = base64Decoder();

/**
 * The backend's answer, turned into something a `<img>` can show.
 *
 * The MIME type comes from the BYTES (Rust sniffs them on the way out), never
 * from a file name — and it is not decoration: a `Blob` with an empty type
 * leaves the browser guessing at what to render.
 *
 * Throws on base64 that does not decode. That is deliberate and it is caught
 * one level up, where it becomes «kunne ikke lese bildet» — NOT «bildet
 * mangler». The distinction is the teacher's remedy: bytes that are there and
 * will not decode are not a picture she can go and find again, and sending her
 * to re-pick a file that is fine costs her the lesson.
 */
export function decodeStoredImage(
  stored: {
    mime: string;
    bytesBase64: string;
  },
  decode: Base64Decoder = decodeBase64,
): Blob {
  return new Blob([decode(stored.bytesBase64)], { type: stored.mime });
}

// ── The cache ───────────────────────────────────────────────────────────────

/**
 * What a claim on a picture ANSWERED. Three states, because the card has three
 * honest things to say and they have three different remedies:
 *
 *   - `ok` — here is the object URL;
 *   - `missing` — the backend HAS no such picture (an imported setup whose
 *     pictures did not all fit in the file lands here). Nothing to retry;
 *   - `unreadable` — the read itself failed. The picture is not gone, we did
 *     not get it THIS time, and asking again is exactly the right move.
 *
 * The last one used to be folded into `missing` (R7-funn L9): a single IPC
 * hiccup told the teacher her picture was lost, with the wrong remedy, for the
 * rest of the card's life.
 */
export type ImageOutcome =
  { state: "ok"; url: string } | { state: "missing" } | { state: "unreadable" };

const MISSING: ImageOutcome = { state: "missing" };
const UNREADABLE: ImageOutcome = { state: "unreadable" };

interface Entry {
  /** How many mounted cards are showing this picture right now. */
  refs: number;
  /** The object URL, once the load has landed and found something. */
  url: string | null;
  /** Decoded size behind `url` — the currency of the retention budget. */
  bytes: number;
  /**
   * The load — in flight, or already settled. Kept AFTER it settles on
   * purpose: that is what makes a MISS cached too. A picture the backend does
   * not have is a fact about this session, and a second card asking for the
   * same missing id must not send the same question again.
   */
  result: Promise<ImageOutcome> | null;
  /** Has `result` come back? Decides whether `release` may drop the entry or
   *  must leave the clean-up to the load's own continuation. */
  settled: boolean;
  /**
   * Did the settled load fail to READ? A failure is never the cached answer to
   * a new question — the next `acquire` asks again — while the entry itself
   * stays, so the refcount keeps its meaning for the cards still holding it.
   */
  failed: boolean;
}

const cache = new Map<string, Entry>();

/**
 * Ids whose last card has let go, oldest FIRST (a `Map` keeps insertion
 * order). Their blobs are still alive, on the bet that the board is coming
 * back.
 */
const retained = new Map<string, number>();
let retainedBytes = 0;

/**
 * How many bytes of let-go pictures may stay alive.
 *
 * Three pictures at the file ceiling, expressed as the ceiling times three
 * rather than as a round number: the two are the same quantity, and a
 * hand-written "32 MiB" would drift the day the ceiling moves.
 *
 * Why keep anything at all (R7-ytelse funn 1): a picture was re-fetched and
 * re-decoded on EVERY return to its screen — five s1↔s2 round trips measured
 * five full `image_load`s, ~13 MiB of JSON each, and the decode on the main
 * thread. Switching screens is what the planner's auto-switch does FOR her at
 * the start of every lesson.
 *
 * Why not keep everything: an object URL pins its blob for the life of the
 * document, and «the teacher swapped the picture twenty times» is the leak
 * this module exists to prevent. Three is the depth of a real rotation (the
 * lesson's screen, the one she flips to, and the one before that); past that,
 * the oldest goes.
 */
export const RETAINED_BYTES_MAX = LIMITS.IMAGE_FILE_MAX_BYTES * 3;

/** Drop retained pictures, oldest first, until the budget holds. */
function evict(urls: UrlFactory): void {
  for (const [id, bytes] of retained) {
    if (retainedBytes <= RETAINED_BYTES_MAX) return;
    retained.delete(id);
    retainedBytes -= bytes;
    const entry = cache.get(id);
    if (entry?.url) urls.revoke(entry.url);
    cache.delete(id);
  }
}

/**
 * Claim a picture. Answers with one of the three [`ImageOutcome`]s.
 *
 * `load` is called at most once per id while anything holds a reference — and
 * once more, later, if that load could not READ the picture.
 *
 * Every caller MUST pair this with exactly one [`release`], including when the
 * answer was `missing`: the reference was taken before the load was attempted,
 * and a caller that skipped `release` on the miss would pin the entry forever.
 */
export async function acquire(
  imageId: string,
  load: () => Promise<Blob | null>,
  urls: UrlFactory,
): Promise<ImageOutcome> {
  let entry = cache.get(imageId);
  if (!entry) {
    entry = {
      refs: 0,
      url: null,
      bytes: 0,
      result: null,
      settled: false,
      failed: false,
    };
    cache.set(imageId, entry);
  }
  // Back in someone's hands, so it is no longer spending the retention budget.
  const held = retained.get(imageId);
  if (held !== undefined) {
    retained.delete(imageId);
    retainedBytes -= held;
  }
  entry.refs += 1;
  if (entry.result && !entry.failed) return entry.result;

  const settle = (blob: Blob | null, failed: boolean): ImageOutcome => {
    const live = cache.get(imageId);
    // The card unmounted while the bytes were in flight. Make the URL,
    // revoke it immediately and answer honestly — the alternative is an
    // entry with a live blob and no owner, which is the leak this module
    // exists to prevent. Nothing is retained here on purpose: retention is a
    // bet that a board is coming back, and this board has already left.
    if (!live || live.refs === 0) {
      if (blob) urls.revoke(urls.create(blob));
      cache.delete(imageId);
      return failed ? UNREADABLE : MISSING;
    }
    live.settled = true;
    live.failed = failed;
    if (failed) return UNREADABLE;
    if (!blob) return MISSING;
    live.url = urls.create(blob);
    live.bytes = blob.size;
    return { state: "ok", url: live.url };
  };

  entry.settled = false;
  entry.failed = false;
  const result = load()
    .then((blob) => settle(blob, false))
    .catch((e: unknown) => {
      console.warn("[image] loading a picture failed", e);
      return settle(null, true);
    });
  entry.result = result;
  return result;
}

/**
 * Let go of a picture.
 *
 * The last holder does NOT revoke: the entry moves into the retention queue
 * with its object URL intact, so the next `acquire` — the same board switched
 * back to — answers from memory with no IPC and no decode. What falls out of
 * the queue when the budget is spent IS revoked, and an entry with nothing to
 * show (a miss, a failed read) is dropped outright: it costs nothing to keep
 * and a failed read must never be the answer to the next mount.
 *
 * Releasing something that was never acquired is a no-op rather than a throw:
 * an effect cleanup running after a hot reload must not be able to break the
 * board.
 */
export function release(imageId: string, urls: UrlFactory): void {
  const entry = cache.get(imageId);
  if (!entry) return;
  // A release with nothing left to release is the SAME no-op as one for an
  // id never acquired — and it must be, because the fall-through below charges
  // the retention budget: a second release of an already-retained picture
  // would book its bytes twice, and the next screen switch would evict a
  // picture that was within budget (R7 sluttgransking S3-2).
  if (entry.refs <= 0) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  // Still loading: the entry stays so the in-flight continuation can see
  // `refs === 0` and clean up after itself. Nothing to revoke yet.
  if (entry.result && !entry.settled) return;
  if (!entry.url) {
    cache.delete(imageId);
    return;
  }
  // `acquire` always takes an id back OUT of the queue, so an entry reaching
  // refs 0 is never already in it.
  retained.set(imageId, entry.bytes);
  retainedBytes += entry.bytes;
  evict(urls);
}

/** How many cards hold this picture — for the tests, and for nothing else. */
export function refCount(imageId: string): number {
  return cache.get(imageId)?.refs ?? 0;
}

/** Drop everything, revoking what is live. Tests only. */
export function resetBlobCache(urls: UrlFactory): void {
  for (const [, entry] of cache) {
    if (entry.url) urls.revoke(entry.url);
  }
  cache.clear();
  retained.clear();
  retainedBytes = 0;
}
