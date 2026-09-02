// The thumbnail cache: one `layout_load` per screen the planner shows, and
// an honest answer when that read fails.
//
// ## Why a cache at all
//
// A week grid is 5 × 8 cells and every cell may point at a screen. Rendering
// them straight from `layout_load` would be forty reads per keystroke in the
// planner. So the rows are read ONCE per screen and held here until something
// says they are stale.
//
// ## Why «error» is a stored state, not a missing entry
//
// A read that failed and a screen with no widgets on it produce the same
// picture — an empty board — and one of them is a lie. That is F13, and it is
// the reason this module never collapses `error` into `{ items: [] }`. The
// entry keeps the failure, `SceneThumb` draws a neutral placeholder for it,
// and nobody is told a screen is empty on the strength of a read that never
// landed.
//
// It is also why a failure is REMEMBERED rather than retried on every render:
// forty cells each retrying a dead backend is a spin, not a recovery. The way
// back is `invalidateAllThumbs()` when the planner opens — the teacher's own
// «open it again» IS the retry.
//
// ## Ownership
//
// This module only READS. It never writes a layout, never touches
// `activeScene`, and is therefore safe to call while a design session has
// borrowed the board (state/design-session.ts): `layout_load` takes an
// arbitrary scene id and changes nothing.

import { signal } from "@preact/signals";

import type { WidgetInstance } from "../bindings/WidgetInstance";

/** What is known about one screen's picture. */
export type ThumbEntry =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: WidgetInstance[] };

/**
 * scene id → what we know about it. A screen with NO entry has not been asked
 * about yet; `SceneThumb` asks on mount.
 *
 * The map is replaced, never mutated, on every write: a signal compares by
 * identity, and an in-place `Map.set` would update the cache without
 * re-rendering a single cell.
 */
export const thumbCache = signal<ReadonlyMap<string, ThumbEntry>>(new Map());

/**
 * Bumped by every invalidation. A load that resolves after its own generation
 * was invalidated is DISCARDED rather than written.
 *
 * The race is real and quiet: the teacher designs «Morgensamling», presses
 * «Ferdig» (invalidate), and a `layout_load` that started before the edits
 * lands after them — the planner would then show the pre-edit board, and it
 * would keep showing it, because from the cache's point of view that entry is
 * perfectly fresh. Dropping the answer costs one re-read; keeping it costs the
 * teacher's trust in the picture.
 */
let generation = 0;

function put(sceneId: string, entry: ThumbEntry): void {
  const next = new Map(thumbCache.peek());
  next.set(sceneId, entry);
  thumbCache.value = next;
}

/**
 * Make sure `sceneId`'s picture is known, or is on its way.
 *
 * A no-op when the screen already has an entry of ANY kind — including
 * `error`, see the header. Callers fire and forget: the answer arrives through
 * the signal, and the rejection is handled here rather than travelling (a
 * thumbnail that cannot be drawn is not a failed action the teacher took —
 * it is a picture that stays a placeholder).
 */
export async function ensureThumb(sceneId: string): Promise<void> {
  if (thumbCache.peek().has(sceneId)) return;

  const mine = generation;
  put(sceneId, { status: "loading" });

  try {
    const items = await window.api.layoutLoad(sceneId);
    if (generation !== mine) return;
    put(sceneId, { status: "ready", items });
  } catch (e) {
    console.warn("[thumbs] layout_load failed for", sceneId, e);
    if (generation !== mine) return;
    put(sceneId, { status: "error" });
  }
}

/** Forget one screen's picture — it was just edited, duplicated or created.
 *  The next render of a cell pointing at it reads it again. */
export function invalidateThumb(sceneId: string): void {
  generation++;
  const before = thumbCache.peek();
  if (!before.has(sceneId)) return;
  const next = new Map(before);
  next.delete(sceneId);
  thumbCache.value = next;
}

/** Forget everything. The planner opening is the one moment where a stale
 *  picture is both likely (anything may have happened on the board since it
 *  was last open) and cheap to fix — and it is the retry for every screen
 *  whose read failed last time. */
export function invalidateAllThumbs(): void {
  generation++;
  if (thumbCache.peek().size === 0) return;
  thumbCache.value = new Map();
}
