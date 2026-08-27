// The toast store — the missing half of the honesty pipeline (gransking F9,
// funn U#2): the shim's rate-limited failure toasts ended in console.error
// because no surface existed. Errors are STICKY (the one message you cannot
// afford to miss must not vanish while you look away); the rest self-dismiss.

import { signal } from "@preact/signals";

import type { ShimToastKind } from "@lib/shim-notifier-core";

export interface ToastEntry {
  id: number;
  kind: ShimToastKind;
  msg: string;
}

export const toasts = signal<ToastEntry[]>([]);

const AUTO_DISMISS_MS = 6000;
let nextId = 1;

export function toast(kind: ShimToastKind, msg: string): void {
  const entry: ToastEntry = { id: nextId++, kind, msg };
  toasts.value = [...toasts.value, entry];
  if (kind !== "error") {
    setTimeout(() => dismissToast(entry.id), AUTO_DISMISS_MS);
  }
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
