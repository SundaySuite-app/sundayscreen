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

export function renameItem(
  items: ChecklistItem[],
  id: string,
  text: string,
): ChecklistItem[] {
  return items.map((i) => (i.id === id ? { ...i, text } : i));
}
