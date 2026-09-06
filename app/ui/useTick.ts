// Repaint on a wall-clock interval — the ONE copy.
//
// Three widgets carried this hook by hand (clock, «Dagen i dag», «Frist»),
// which is one past the house's threshold for a shared contract. Nothing here
// is a counter: every widget that uses it DERIVES what it shows from
// `Date.now()` at paint time, so a throttled tab, a sleeping laptop or a
// missed interval can make the screen briefly stale but never wrong. That is
// the same rule the timer's target-epoch model is built on (ADR-003), and it
// is why forcing a render is all this has to do.

import { useEffect, useState } from "preact/hooks";

/**
 * Re-render this component every `ms` milliseconds.
 *
 * The interval is cleared on unmount, and RESTARTED when `ms` changes — a
 * widget that switches cadence must not leave the old timer running.
 */
export function useTick(ms: number): void {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** One minute: the cadence for anything counting in days or minutes. */
export const MINUTE_TICK_MS = 60_000;

/** One second: the clock face with seconds showing. */
export const SECOND_TICK_MS = 1_000;
