// `window.api` — the ONE door into the backend.
//
// Every `invoke()` in the app goes through this module: the fixture seam
// covers them with one hook, every failure lands in the bounded failure ring,
// and outside Tauri each command degrades to its typed fallback so the whole
// shell boots in a plain browser (which is what makes the Playwright tier
// possible with no backend at all).

import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import type { AppInfo } from "../bindings/AppInfo";
import type { Settings } from "../bindings/Settings";
import {
  FIXTURE_GLOBAL,
  FIXTURE_QUERY_PARAM,
  fixturesHonored,
  lookupFixture,
  readFixture,
  type FixtureGate,
  type FixtureMap,
} from "./fixtures-core";
import { t } from "./i18n";
import {
  createIpcFailureState,
  recentFailures,
  recordFailure,
  type IpcFailure,
} from "./ipc-failures-core";
import { SETTINGS_DEFAULTS } from "./settings-defaults";
import { createNotifierSlot, type ShimNotifier } from "./shim-notifier-core";

// ── Host services (toast / navigate / translate) ────────────────────────────
//
// The defaults are what is TRUE before a host installs its own surfaces:
// there is no toast stack and no router yet, so the only honest thing to do
// with a message is put it in the console, and the only honest thing to do
// with a navigation is decline it loudly. `app/main.tsx` installs the shell's
// surfaces as its second act.
const notifier = createNotifierSlot({
  toast: (kind, msg) => {
    console[kind === "error" ? "error" : "warn"](`[api-shim] ${kind}: ${msg}`);
  },
  navigate: (page) => {
    console.warn(
      `[api-shim] navigate(${page}) before a host installed a router — ignored`,
    );
  },
  t,
});

/**
 * Install host-provided toast/navigate/translate services. Call it BEFORE the
 * first backend call so an early failure is surfaced by the right shell; a
 * partial override keeps the default for whatever it leaves out, and `null`
 * restores the defaults.
 */
export function setShimNotifier(override: Partial<ShimNotifier> | null): void {
  notifier.set(override);
}

// ── The fixture seam ────────────────────────────────────────────────────────
const FIXTURE_GATE: FixtureGate = {
  inTauri: isTauri(),
  // Vite inlines this as the literal `false` in a production build, so a
  // shipped SundayScreen cannot be driven by fixtures.
  devBuild: !!import.meta.env?.DEV,
  requested: new URLSearchParams(location.search).has(FIXTURE_QUERY_PARAM),
};
const FIXTURES_HONORED = fixturesHonored(FIXTURE_GATE);

/** The installed fixture map, read fresh on every call so a test can swap the
 *  canned answers mid-journey. */
function installedFixtures(): FixtureMap | undefined {
  if (!FIXTURES_HONORED) return undefined;
  return (window as unknown as Record<string, unknown>)[FIXTURE_GLOBAL] as
    FixtureMap | undefined;
}

/** `invoke`, with the fixture seam in front of it. */
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const found = lookupFixture(installedFixtures(), cmd);
  if (found.hit) {
    // `Promise.resolve` inside try/catch, not an async fn: a fixture that
    // throws SYNCHRONOUSLY must still reject the promise.
    try {
      return Promise.resolve(readFixture(found.value, args) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return tauriInvoke<T>(cmd, args);
}

/** Every IPC failure this session, bounded, plus the toast rate-limit state. */
const ipcFailures = createIpcFailureState();

/** Human-readable message from a rejected `invoke`. Tauri serializes our
 *  `AppError` to `{ code, message }` (NOT an `Error` instance). */
function ipcErrText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.code === "string" && o.code) return o.code;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Invoke a command, falling back to `fallback` on any error so the UI never
 *  throws while the backend is partially wired. The failure is remembered in
 *  the ring either way; the first of a burst is toasted — but only inside
 *  Tauri, because in a plain browser every wired command legitimately
 *  rejects. */
async function call<T>(
  cmd: string,
  args: Record<string, unknown> | undefined,
  fallback: T,
): Promise<T> {
  try {
    return (await invoke<T>(cmd, args)) as T;
  } catch (e) {
    console.warn(`[api-shim] ${cmd} failed → fallback`, e);
    const surface = recordFailure(ipcFailures, cmd, ipcErrText(e), Date.now());
    if (surface && isTauri()) {
      const n = notifier.current();
      n.toast(
        "error",
        `${n.t("error.ipcFailed", "Noe i bakgrunnen svarte ikke, så denne visningen kan være ufullstendig.")} (${cmd})`,
      );
    }
    return fallback;
  }
}

// ── The surface ─────────────────────────────────────────────────────────────

const api = {
  // "Siste IPC-feil" for the diagnose surface. Synchronous and local — it
  // still answers when the backend is the thing that is broken.
  getRecentIpcFailures: (): IpcFailure[] => recentFailures(ipcFailures),

  appInfo: async (): Promise<AppInfo> =>
    call("app_info", undefined, { name: "SundayScreen", version: "—" }),

  /**
   * `settings_get`, with the one shim-side responsibility: make a FAILED read
   * loud through the ring rather than silent. The fallback is
   * `SETTINGS_DEFAULTS` so the UI still renders — but a broken settings store
   * rendered as "everything is default" is a quiet lie, so
   * `state/settings.ts` asks the ring whether this read failed and raises the
   * hydrate banner.
   */
  getSettings: async (): Promise<Settings> => {
    try {
      return await invoke<Settings>("settings_get");
    } catch (e) {
      console.warn("[api-shim] settings_get failed → defaults", e);
      recordFailure(ipcFailures, "settings_get", ipcErrText(e), Date.now());
      return { ...SETTINGS_DEFAULTS };
    }
  },

  // WRITE — bare invoke, rejection travels (the house rule: a write that
  // fails must REJECT, never answer a fabricated success — the "saved" chip
  // stays honest).
  saveSettings: async (settings: Settings): Promise<Settings> =>
    invoke<Settings>("settings_save", { settings }),
};

export type Api = typeof api;

declare global {
  interface Window {
    api: Api;
  }
}

window.api = api;
