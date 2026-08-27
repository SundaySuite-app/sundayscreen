// The fixture seam's precedence rules — pure, no DOM, no Tauri.
//
// The unit gate is node-env-only, so the rendered shell's coverage comes from
// the Playwright tier — which needs a way to answer a Tauri command with
// canned data, without a backend and without reaching into the shell's
// internals. That is this seam: an injectable fixture source
// (`window.__SUNDAYSCREEN_FIXTURES__`), consulted by the ONE `invoke` wrapper
// in `api-shim.ts`, keyed by Tauri command name.
//
// The precedence, in one sentence:
//
//   an HONOURED fixture  >  the real `invoke`  >  the command's fallback.
//
// The load-bearing property: with no fixtures installed, every path through
// this module is a no-op — `lookupFixture` misses and the wrapper is a
// straight pass-through.
//
// When a fixture is honoured:
//   - OUTSIDE Tauri (a plain browser, the Playwright tier): ALWAYS. There is
//     no backend there, so a fixture shadows nothing.
//   - INSIDE Tauri: only in a DEV build AND only with `?fixtures=1`. Vite
//     replaces `import.meta.env.DEV` with the literal `false` in a production
//     build, so a shipped SundayScreen cannot be driven by fixtures.
//
// A fixture may be a function; if it throws, the rejection propagates exactly
// like a real `invoke` rejection — which is how a test drives the failure
// path without breaking a backend.

/** A fixture that computes its answer from the invoke args. May throw to
 *  simulate a rejected command. */
export type FixtureFn = (args?: Record<string, unknown>) => unknown;

/** A canned answer for one command: the value itself, or a function of the
 *  invoke args. `undefined` is a legitimate value (void commands), which is
 *  why presence is decided by key ownership, never by `!== undefined`. */
export type FixtureValue = unknown | FixtureFn;

/** `Tauri command name` → canned answer. Installed on `window`. */
export type FixtureMap = Record<string, FixtureValue>;

/** The `window` property the shell reads fixtures from. */
export const FIXTURE_GLOBAL = "__SUNDAYSCREEN_FIXTURES__";

/** The query param that opts an in-Tauri DEV build into honouring fixtures. */
export const FIXTURE_QUERY_PARAM = "fixtures";

/** The three inputs the honour decision is made from. */
export interface FixtureGate {
  /** `isTauri()` — is there a real backend behind `invoke`? */
  inTauri: boolean;
  /** `import.meta.env.DEV` — a dev build, not a shipped bundle. */
  devBuild: boolean;
  /** Was the page opened with `?fixtures=1`? */
  requested: boolean;
}

/** Whether fixtures are allowed to override at all in this boot. */
export function fixturesHonored(gate: FixtureGate): boolean {
  if (!gate.inTauri) return true;
  return gate.devBuild && gate.requested;
}

/** Whether a fixture short-circuits `invoke` for this command. */
export function fixtureWins(gate: FixtureGate, hasFixture: boolean): boolean {
  return hasFixture && fixturesHonored(gate);
}

/** A fixture lookup result. Split from the value because `undefined` is a
 *  perfectly good canned answer. */
export interface FixtureLookup {
  hit: boolean;
  value: FixtureValue;
}

/**
 * Look `cmd` up in the installed map. Own-key ownership, not
 * `map[cmd] !== undefined`: a fixture may legitimately BE `undefined`, and a
 * `{}` map inherits `toString` from Object.prototype.
 */
export function lookupFixture(
  map: FixtureMap | undefined,
  cmd: string,
): FixtureLookup {
  if (!map || typeof map !== "object") return { hit: false, value: undefined };
  if (!Object.prototype.hasOwnProperty.call(map, cmd))
    return { hit: false, value: undefined };
  return { hit: true, value: map[cmd] };
}

/**
 * Turn a fixture into its answer: call it with the invoke args if it is a
 * function, otherwise hand back the value as-is. Throwing is deliberate — a
 * fixture function that throws simulates a rejected command.
 */
export function readFixture(
  value: FixtureValue,
  args?: Record<string, unknown>,
): unknown {
  return typeof value === "function" ? (value as FixtureFn)(args) : value;
}
