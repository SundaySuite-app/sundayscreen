// The IPC-failure memory and its toast rate limit — pure, no DOM, no Tauri.
//
// The shim's `call()` never lets a rejected invoke crash the shell — but a
// failure must not be INVISIBLE either: a crashed backend rendered as an
// empty list looks exactly like "no data". So every failure lands in a
// bounded ring (the diagnose surface reads the pattern), and the FIRST of a
// burst may toast — deduped per command and rate-limited overall, so a
// polling command against a dead backend cannot stack a hundred toasts over
// the UI.

/** One remembered failure. */
export interface IpcFailure {
  cmd: string;
  message: string;
  at: number;
}

/** How many failures the ring remembers. */
export const RING_MAX = 50;

/** One toast per command per this window. */
export const TOAST_PER_CMD_MS = 60_000;

/** At most this many toasts per rolling minute, across all commands. */
export const TOASTS_PER_MINUTE = 3;

export interface IpcFailureState {
  ring: IpcFailure[];
  lastToastPerCmd: Map<string, number>;
  toastTimes: number[];
}

export function createIpcFailureState(): IpcFailureState {
  return { ring: [], lastToastPerCmd: new Map(), toastTimes: [] };
}

/**
 * Remember a failure. Returns whether the caller should SURFACE it (toast) —
 * the ring is filled unconditionally either way, because the diagnose panel
 * wants the pattern, not whichever failure happened to win the rate limit.
 */
export function recordFailure(
  state: IpcFailureState,
  cmd: string,
  message: string,
  now: number,
): boolean {
  state.ring.push({ cmd, message, at: now });
  if (state.ring.length > RING_MAX)
    state.ring.splice(0, state.ring.length - RING_MAX);

  const last = state.lastToastPerCmd.get(cmd);
  if (last !== undefined && now - last < TOAST_PER_CMD_MS) return false;

  state.toastTimes = state.toastTimes.filter((t) => now - t < 60_000);
  if (state.toastTimes.length >= TOASTS_PER_MINUTE) return false;

  state.lastToastPerCmd.set(cmd, now);
  state.toastTimes.push(now);
  return true;
}

/** The remembered failures, oldest first. A copy — callers cannot mutate the
 *  ring through it. */
export function recentFailures(state: IpcFailureState): IpcFailure[] {
  return [...state.ring];
}
