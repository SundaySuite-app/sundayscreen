// The textarea ↔ name-list seam — pure, and the mirror of
// `sundayscreen-core::members::clean_name` (trim, drop empties, cap length
// and count). The backend cleans again on save; this half exists so the
// COUNT the panel shows is the count that will actually be stored.

export const NAME_MAX_CHARS = 120;
export const MEMBERS_MAX = 1000;

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
