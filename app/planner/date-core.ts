// Date and clock-time primitives for the planner — pure over an injected
// Date/now, node-testable. JS owns the LOCAL wall clock (the backend treats
// dates as opaque keys); arithmetic goes through NOON to be immune to DST
// transitions shifting a day boundary.

/** Local wall date as the planner's `YYYY-MM-DD` key. */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO weekday 1 (Monday) .. 7 (Sunday). */
export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** The date `n` days away from a `YYYY-MM-DD` key, as a new key. */
export function addDays(date: string, n: number): string {
  const d = dateAtNoon(date);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** ISO weekday of a `YYYY-MM-DD` key. */
export function weekdayOf(date: string): number {
  return isoWeekday(dateAtNoon(date));
}

/** Parse the planner's date key at LOCAL noon (never midnight — DST). */
export function dateAtNoon(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

/** Minutes since local midnight for a Date. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** "08:30" → 510; null for anything that is not HH:MM inside a day. */
export function parseTime(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 510 → "08:30". */
export function formatMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
