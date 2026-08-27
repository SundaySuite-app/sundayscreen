// `?goto=<page>[:<tab>]` — the PARSE half, pure and node-testable.
//
// Dev/verification hook that has grown into test infrastructure: the
// Playwright harness boots every spec through `/?goto=…`, so these
// normalisation rules are what the browser tier navigates by.
//
//   `?goto=manage`            → { page: "manage" }
//   `?goto=manage:classes`    → { page: "manage", tab: "manage-classes" }
//   `?goto=manage:manage-classes` → same thing; an already-qualified tab id
//                               is passed through rather than doubled
//   no param, or `?goto=` (empty) → null

/** Where a `?goto=` wants the app to land. */
export interface GotoTarget {
  /** Page id, e.g. `screen`, `manage`. */
  page: string;
  /** Fully-qualified inner tab id, when one was asked for. */
  tab?: string;
}

/**
 * Parse a location search string (`location.search`, with or without the
 * leading `?`). Returns `null` when there is nothing to do — no param, or an
 * empty one.
 */
export function parseGoto(search: string): GotoTarget | null {
  const raw = new URLSearchParams(search).get("goto");
  if (!raw) return null;
  // Anything after a second `:` is ignored rather than being an error.
  const [page, rawTab] = raw.split(":");
  if (!rawTab) return { page };
  const tab = rawTab.startsWith(`${page}-`) ? rawTab : `${page}-${rawTab}`;
  return { page, tab };
}
