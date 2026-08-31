// The textarea ↔ name-list seam — pure, and the mirror of
// `sundayscreen-core::members::clean_name` (trim, drop empties, cap length
// and count). The backend cleans again on save; this half exists so the
// COUNT the panel shows is the count that will actually be stored.

import { LIMITS } from "@lib/limits.generated";

export const NAME_MAX_CHARS = LIMITS.NAME_MAX_CHARS;
export const MEMBERS_MAX = LIMITS.MEMBERS_MAX;

/** How many names the teacher actually TYPED — before the cap. The capped
 *  `parseNameList` mirrors what the backend would store, which makes a
 *  `parsed.length > MEMBERS_MAX` check structurally impossible (the cap ran
 *  first). The refusal in the panel needs the raw truth. */
export function rawNameCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

/** One name per line → cleaned list. Keeps duplicates (identity is the row
 *  id, never the name). */
export function parseNameList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => [...line].slice(0, NAME_MAX_CHARS).join(""))
    .slice(0, MEMBERS_MAX);
}

/** Names → textarea content. */
export function namesToText(names: readonly string[]): string {
  return names.join("\n");
}
