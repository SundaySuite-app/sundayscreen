// The layout store: the active class, its widgets, and the persister.
//
// The signals are the WORKING TRUTH; `layout_save` mirrors them to SQLite as
// a replace-all in one transaction. Discrete commits (add, delete, a click
// that changes config) save IMMEDIATELY; streaming edits (typing in the text
// widget) debounce 500 ms. `flushPending` is the class-switch seam (F3): it
// resolves once nothing is waiting to be written.

import { signal } from "@preact/signals";

import type { Class } from "../bindings/Class";
import type { WidgetConfig } from "../bindings/WidgetConfig";
import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t } from "../i18n";
import { placeNew } from "../screen/coords-core";
import { WIDGET_REGISTRY, type WidgetKind } from "../widgets/registry";
import { surfaceSize } from "./surface";

export const activeClass = signal<Class | null>(null);
export const widgets = signal<WidgetInstance[]>([]);
export const selectedWidgetId = signal<string | null>(null);

/** Load (or bootstrap) the active class and its layout. Called once on boot,
 *  AFTER the locale is set — the default class name is translated copy. */
export async function initLayout(): Promise<void> {
  const cls = await window.api.classEnsureActive(t("class.defaultName"));
  activeClass.value = cls;
  widgets.value = await window.api.layoutLoad(cls.id);
}

export function addWidget(kind: WidgetKind): void {
  const def = WIDGET_REGISTRY[kind];
  const rect = placeNew(
    widgets.value.length,
    def.defaultSizePx,
    surfaceSize.value,
  );
  const inst: WidgetInstance = {
    id: crypto.randomUUID(),
    rect,
    z: widgets.value.length,
    config: def.defaultConfig(),
  };
  widgets.value = [...widgets.value, inst];
  selectedWidgetId.value = inst.id;
  saveNow();
}

export function removeWidget(id: string): void {
  widgets.value = widgets.value.filter((w) => w.id !== id);
  if (selectedWidgetId.value === id) selectedWidgetId.value = null;
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

// ── The persister ───────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> = Promise.resolve();

/** How long a streaming edit may sit unwritten. */
export const SAVE_DEBOUNCE_MS = 500;

function flush(): Promise<void> {
  const cls = activeClass.peek();
  if (!cls) return Promise.resolve();
  const snapshot = widgets.peek();
  const write = window.api.layoutSave(cls.id, snapshot).catch((e) => {
    // A failed save must not crash the shell — but it is never silent:
    // the shim's failure ring remembers it, and the console says so.
    console.warn("[layout] layout_save failed", e);
  });
  inflight = inflight.then(() => write);
  return write.then(() => undefined);
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
