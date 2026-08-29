// The layout store: the active class, its widgets, and the persister.
//
// The signals are the WORKING TRUTH; `layout_save` mirrors them to SQLite as
// a replace-all in one transaction. Discrete commits (add, delete, a click
// that changes config) save IMMEDIATELY; streaming edits (typing in the text
// widget) debounce 500 ms.
//
// Three F9 hardenings live here:
//   - writes are SERIALIZED (funn S#2/U#8): each starts only after the
//     previous settled, and reads the freshest state at write time, so two
//     replace-alls can never commit out of order and resurrect a deletion;
//   - a FAILED load blocks saving (funn S#4): a tolerant `[]` fallback plus
//     replace-all writes was a one-edit wipe of the stored layout;
//   - a FAILED save is VISIBLE (funn U#1): the sticky `saveError` chip, not
//     a console line.

import { signal } from "@preact/signals";

import type { Class } from "../bindings/Class";
import type { ClassSnapshot } from "../bindings/ClassSnapshot";
import type { Scene } from "../bindings/Scene";
import type { NormRect } from "../bindings/NormRect";
import type { WidgetConfig } from "../bindings/WidgetConfig";
import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t } from "../i18n";
import { offsetRect, placeNew } from "../screen/coords-core";
import { WIDGET_REGISTRY, type WidgetKind } from "../widgets/registry";
import { settings } from "./settings";
import { surfaceSize } from "./surface";

export const activeClass = signal<Class | null>(null);
/** The scene on screen — the write key for every layout save. */
export const activeScene = signal<Scene | null>(null);
export const widgets = signal<WidgetInstance[]>([]);
export const selectedWidgetId = signal<string | null>(null);

/** Did the stored layout actually LOAD? While false, every save is refused —
 *  a replace-all against a layout we never read would wipe it. */
export const layoutHydrated = signal(false);

/** Is the store refusing/failing to persist right now? Drives the sticky
 *  error chip in the shell. */
export const saveError = signal(false);

/** Load (or bootstrap) the active class and its layout. Called once on boot,
 *  AFTER the locale is set — the default class name is translated copy. */
export async function initLayout(): Promise<void> {
  const ctx = await window.api.classEnsureActive(t("class.defaultName"));
  activeClass.value = ctx.class;
  activeScene.value = ctx.scene;
  // Keep the settings signal's pointers in step (F9-funn S#1): every
  // whole-object settings save carries these fields, and a stale copy would
  // quietly repoint the backend at the previous class/scene.
  const s = settings.peek();
  if (s.activeClassId !== ctx.class.id || s.activeSceneId !== ctx.scene.id) {
    settings.value = {
      ...s,
      activeClassId: ctx.class.id,
      activeSceneId: ctx.scene.id,
    };
  }
  try {
    widgets.value = await window.api.layoutLoad(ctx.scene.id);
    layoutHydrated.value = true;
  } catch (e) {
    console.warn("[layout] layout_load failed — saving is blocked", e);
    widgets.value = [];
    layoutHydrated.value = false;
  }
}

/** Adopt a switch snapshot: class, scene and widgets in one move.
 *
 *  The pending UNDO dies with the old board (R3-funn 3.2): the slot holds a
 *  widget that belonged to the scene we just left, and `undoRemove` writes
 *  into whatever scene is active NOW — so an Undo tapped after a class or
 *  scene switch would resurrect a card into the WRONG screen and save it
 *  there. Clearing it here is also what makes a longer [`UNDO_MS`] safe. */
export function adoptSnapshot(snap: ClassSnapshot): void {
  activeClass.value = snap.class;
  activeScene.value = snap.scene;
  widgets.value = snap.widgets;
  layoutHydrated.value = true;
  selectedWidgetId.value = null;
  clearUndo();
}

/** The next z on top of the current stack — NOT the list length: deletions
 *  leave holes and length-based z collided with survivors (F9-funn S#3). */
function nextZ(): number {
  return widgets.value.reduce((max, w) => Math.max(max, w.z), -1) + 1;
}

export function addWidget(kind: WidgetKind): void {
  const def = WIDGET_REGISTRY[kind];
  const rect = placeNew(
    widgets.value.map((w) => w.rect),
    def.defaultSizePx,
    def.minSizePx,
    surfaceSize.value,
  );
  const inst: WidgetInstance = {
    id: crypto.randomUUID(),
    rect,
    z: nextZ(),
    config: def.defaultConfig(),
  };
  widgets.value = [...widgets.value, inst];
  selectedWidgetId.value = inst.id;
  saveNow();
}

/**
 * Copy a widget: the same SIZE and the same settings, nudged clear of the
 * original. Two work symbols, two deadlines, a second checklist — all of
 * them are "the one I just set up, again", and rebuilding one from the add
 * menu throws away every choice.
 *
 * `structuredClone`, NOT a spread. A `WidgetConfig` carries arrays and
 * objects (`items`, `manualItems`, `lastResult`, `lastRoll`, `extra`); a
 * shallow copy would leave the two cards sharing them, which turns "no
 * widget mutates its config in place" from a convention into a load-bearing
 * assumption spread across twelve folders. It also breaks promise 2 the
 * moment one is violated: tick an item on the copy, and the original's
 * stored config changed without ever being saved.
 */
export function duplicateWidget(id: string): void {
  const source = widgets.value.find((w) => w.id === id);
  if (!source) return;
  const inst: WidgetInstance = {
    id: crypto.randomUUID(),
    rect: offsetRect(source.rect, surfaceSize.value),
    z: nextZ(),
    config: structuredClone(source.config),
  };
  widgets.value = [...widgets.value, inst];
  selectedWidgetId.value = inst.id;
  saveNow();
}

/** How long the undo snackbar stays. Fifteen seconds, not five: the teacher
 *  who deletes the wrong card looks at the board, THEN at the message —
 *  five seconds ran out while she was still working out what vanished. Safe
 *  only because `adoptSnapshot` clears the slot, so a longer window can
 *  never span a class or scene switch. */
export const UNDO_MS = 15000;

/** The most recently removed widget, restorable for [`UNDO_MS`]. No confirm
 *  dialog — a dialog slows the teacher forty times to prevent one mistake;
 *  the snackbar fixes the one mistake instead. */
export const undoSlot = signal<{ widget: WidgetInstance } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

/** Drop the pending undo and its timer. */
function clearUndo(): void {
  undoSlot.value = null;
  if (undoTimer !== undefined) {
    clearTimeout(undoTimer);
    undoTimer = undefined;
  }
}

export function removeWidget(id: string): void {
  const removed = widgets.value.find((w) => w.id === id);
  // Re-index densely so no later add can collide with a survivor's z.
  widgets.value = widgets.value
    .filter((w) => w.id !== id)
    .slice()
    .sort((a, b) => a.z - b.z)
    .map((w, i) => ({ ...w, z: i }));
  if (selectedWidgetId.value === id) selectedWidgetId.value = null;
  if (removed) {
    undoSlot.value = { widget: removed };
    if (undoTimer !== undefined) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      undoSlot.value = null;
    }, UNDO_MS);
  }
  saveNow();
}

/** Put the removed widget back, on top. */
export function undoRemove(): void {
  const slot = undoSlot.value;
  if (!slot) return;
  clearUndo();
  widgets.value = [...widgets.value, { ...slot.widget, z: nextZ() }];
  saveNow();
}

/** Commit a finished drag/resize (pointerup) — an immediate save. */
export function commitWidgetRect(id: string, rect: NormRect): void {
  widgets.value = widgets.value.map((w) => (w.id === id ? { ...w, rect } : w));
  saveNow();
}

/** Select and raise a widget. Saves only when the stacking actually
 *  changed — a plain select-click writes nothing. */
export function bringToFront(id: string): void {
  selectedWidgetId.value = id;
  const list = widgets.value;
  const target = list.find((w) => w.id === id);
  const maxZ = list.reduce((max, w) => Math.max(max, w.z), -1);
  if (!target || target.z === maxZ) return;
  const rest = [...list].filter((w) => w.id !== id).sort((a, b) => a.z - b.z);
  widgets.value = [
    ...rest.map((w, i) => ({ ...w, z: i })),
    { ...target, z: rest.length },
  ];
  saveNow();
}

export function updateWidgetConfig(
  id: string,
  config: WidgetConfig,
  opts: { debounce?: boolean } = {},
): void {
  widgets.value = widgets.value.map((w) =>
    w.id === id ? { ...w, config } : w,
  );
  if (opts.debounce) saveSoon();
  else saveNow();
}

/**
 * Config update at the END of something async (a draw's spin, a roll's
 * scramble, a split's round-trip): the updater receives the widget's
 * CURRENT config, so an edit made during the wait is merged, not reverted
 * (F9-funn S#6) — and a widget deleted meanwhile is a clean no-op.
 */
export function updateWidgetConfigBy(
  id: string,
  update: (config: WidgetConfig) => WidgetConfig,
  opts: { debounce?: boolean } = {},
): void {
  const current = widgets.value.find((w) => w.id === id);
  if (!current) return;
  updateWidgetConfig(id, update(current.config), opts);
}

// ── The persister ───────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> = Promise.resolve();

/** How long a streaming edit may sit unwritten. */
export const SAVE_DEBOUNCE_MS = 500;

/** Queue one write AFTER every earlier one, reading the freshest class and
 *  widget state at WRITE time (replace-all is idempotent, so the latest
 *  state is always the right thing to write). */
function flush(): Promise<void> {
  const write = inflight.then(async () => {
    if (!layoutHydrated.peek()) return;
    const scene = activeScene.peek();
    if (!scene) return;
    try {
      await window.api.layoutSave(scene.id, widgets.peek());
      saveError.value = false;
    } catch (e) {
      console.warn("[layout] layout_save failed", e);
      saveError.value = true;
    }
  });
  inflight = write;
  return write;
}

/** Save immediately (a discrete commit: pointerup, add, delete, a click). */
export function saveNow(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  void flush();
}

/** Save soon (a streaming edit: typing). Collapses bursts into one write. */
export function saveSoon(): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void flush();
  }, SAVE_DEBOUNCE_MS);
}

/** Resolve once every scheduled/in-flight write has landed — the class-switch
 *  sequencing seam (flush the OLD class before swapping to the new one). */
export async function flushPending(): Promise<void> {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    await flush();
  }
  await inflight;
}
