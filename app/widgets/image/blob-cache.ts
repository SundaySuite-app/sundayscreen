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
// revoked the moment the last card lets go.
//
// ## Why the URL factory is injected
//
// Vitest runs in NODE (never jsdom — CLAUDE.md), so `URL.createObjectURL` does
// not exist there. Passing the two functions in makes the refcounting testable
// as what it is: bookkeeping. The component passes the real pair.

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

/**
 * The backend's answer, turned into something a `<img>` can show.
 *
 * The MIME type comes from the BYTES (Rust sniffs them on the way out), never
 * from a file name — and it is not decoration: a `Blob` with an empty type
 * leaves the browser guessing at what to render.
 *
 * Throws on base64 that does not decode. That is deliberate and it is caught
 * one level up, where it becomes the same honest «bildet mangler» a missing
 * file gets: from the board's point of view, bytes that are not a picture and
 * no bytes at all are the same fact.
 */
export function decodeStoredImage(stored: {
  mime: string;
  bytesBase64: string;
}): Blob {
  const binary = atob(stored.bytesBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: stored.mime });
}

interface Entry {
  /** How many mounted cards are showing this picture right now. */
  refs: number;
  /** The object URL, once the load has landed and found something. */
  url: string | null;
  /**
   * The load — in flight, or already settled. Kept AFTER it settles on
   * purpose: that is what makes a MISS cached too. A picture the backend does
   * not have is a fact about this session, and a second card asking for the
   * same missing id must not send the same question again.
   */
  result: Promise<string | null> | null;
  /** Has `result` come back? Decides whether `release` may drop the entry or
   *  must leave the clean-up to the load's own continuation. */
  settled: boolean;
}

const cache = new Map<string, Entry>();

/**
 * Claim a picture. Answers with an object URL, or `null` when the backend has
 * no such picture (the honest «bildet mangler» state — see `api.imageLoad`).
 *
 * `load` is called at most once per id while anything holds a reference.
 *
 * Every caller MUST pair this with exactly one [`release`], including when the
 * answer was `null`: the reference was taken before the load was attempted,
 * and a caller that skipped `release` on the miss would pin the entry forever.
 */
export async function acquire(
  imageId: string,
  load: () => Promise<Blob | null>,
  urls: UrlFactory,
): Promise<string | null> {
  let entry = cache.get(imageId);
  if (!entry) {
    entry = { refs: 0, url: null, result: null, settled: false };
    cache.set(imageId, entry);
  }
  entry.refs += 1;
  if (entry.result) return entry.result;

  const settle = (
    live: Entry | undefined,
    blob: Blob | null,
  ): string | null => {
    // The card unmounted while the bytes were in flight. Make the URL,
    // revoke it immediately and answer honestly — the alternative is an
    // entry with a live blob and no owner, which is the leak this module
    // exists to prevent.
    if (!live || live.refs === 0) {
      if (blob) urls.revoke(urls.create(blob));
      cache.delete(imageId);
      return null;
    }
    live.settled = true;
    if (!blob) return null;
    live.url = urls.create(blob);
    return live.url;
  };

  const result = load()
    .then((blob) => settle(cache.get(imageId), blob))
    .catch((e: unknown) => {
      console.warn("[image] loading a picture failed", e);
      return settle(cache.get(imageId), null);
    });
  entry.result = result;
  return result;
}

/**
 * Let go of a picture. The object URL is revoked — and the entry forgotten —
 * when the last holder releases it, so the next `acquire` loads fresh.
 *
 * Releasing something that was never acquired is a no-op rather than a throw:
 * an effect cleanup running after a hot reload must not be able to break the
 * board.
 */
export function release(imageId: string, urls: UrlFactory): void {
  const entry = cache.get(imageId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.refs = 0;
  // Still loading: the entry stays so the in-flight continuation can see
  // `refs === 0` and clean up after itself. Nothing to revoke yet.
  if (entry.result && !entry.settled) return;
  if (entry.url) urls.revoke(entry.url);
  cache.delete(imageId);
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
}
