// The checklist's list operations — pure; ids are injected for purity.

import type { ChecklistItem } from "../../bindings/ChecklistItem";

export function toggleItem(
  items: ChecklistItem[],
  id: string,
): ChecklistItem[] {
  return items.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
}

export function addItem(
  items: ChecklistItem[],
  text: string,
  id: string,
): ChecklistItem[] {
  const trimmed = text.trim();
  if (trimmed === "") return items;
  return [...items, { id, text: trimmed, done: false }];
}

export function removeItem(
  items: ChecklistItem[],
  id: string,
): ChecklistItem[] {
  return items.filter((i) => i.id !== id);
}

/**
 * Clear every check, keep every row — the Monday-morning move on a list that
 * is the same each day. Returns the SAME array when nothing was checked, so
 * the caller can render `disabled` from the same fact it would act on and no
 * save is queued for a press that changes nothing.
 */
export function resetAll(items: ChecklistItem[]): ChecklistItem[] {
  if (!items.some((i) => i.done)) return items;
  return items.map((i) => (i.done ? { ...i, done: false } : i));
}

export function renameItem(
  items: ChecklistItem[],
  id: string,
  text: string,
): ChecklistItem[] {
  return items.map((i) => (i.id === id ? { ...i, text } : i));
}
