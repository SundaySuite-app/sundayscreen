// The toast store — the missing half of the honesty pipeline (gransking F9,
// funn U#2): the shim's rate-limited failure toasts ended in console.error
// because no surface existed.
//
// EVERY toast self-dismisses, errors included — the error simply gets twice
// as long (R4-funn F7). The old rule said errors were sticky, "the one message
// you cannot afford to miss must not vanish while you look away", and that
// sentence was about the wrong thing: a toast here is a RECEIPT for one action
// that just failed («Del inn» did nothing, the draw did not land, the
// auto-switch could not run). What the teacher cannot afford to miss is a
// STATE — the database did not open, the layout will not save — and states do
// not live here at all, they live in the shell's chip, which stays until the
// state changes. So the sticky rule bought nothing and cost the top-right
// corner of the board for the rest of the day: on a projector, in front of a
// class, a red plate from 09:12 was still sitting on the enlarged card's
// collapse button at 14:00.

import { signal } from "@preact/signals";

import type { ShimToastKind } from "@lib/shim-notifier-core";

export interface ToastEntry {
  id: number;
  kind: ShimToastKind;
  msg: string;
}

export const toasts = signal<ToastEntry[]>([]);

const AUTO_DISMISS_MS = 6000;

/** Longer for a failure: it is still a receipt, but it is the one the teacher
 *  may have to read twice, and «Del inn» failing is not something she was
 *  watching for. Not forever — see the note at the top. */
const ERROR_DISMISS_MS = 12000;

let nextId = 1;

export function toast(kind: ShimToastKind, msg: string): void {
  const entry: ToastEntry = { id: nextId++, kind, msg };
  toasts.value = [...toasts.value, entry];
  setTimeout(
    () => dismissToast(entry.id),
    kind === "error" ? ERROR_DISMISS_MS : AUTO_DISMISS_MS,
  );
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
