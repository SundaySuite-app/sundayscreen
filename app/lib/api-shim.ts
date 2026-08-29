// `window.api` — the ONE door into the backend.
//
// Every `invoke()` in the app goes through this module: the fixture seam
// covers them with one hook, every failure lands in the bounded failure ring,
// and outside Tauri each command degrades to its typed fallback so the whole
// shell boots in a plain browser (which is what makes the Playwright tier
// possible with no backend at all).

import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import type { AppInfo } from "../bindings/AppInfo";
import type { Class } from "../bindings/Class";
import type { Scene } from "../bindings/Scene";
import type { AgendaItem } from "../bindings/AgendaItem";
import type { AgendaItemSpec } from "../bindings/AgendaItemSpec";
import type { DayNote } from "../bindings/DayNote";
import type { DayPlan } from "../bindings/DayPlan";
import type { NoteSpec } from "../bindings/NoteSpec";
import type { OverrideSpec } from "../bindings/OverrideSpec";
import type { Period } from "../bindings/Period";
import type { PeriodSpec } from "../bindings/PeriodSpec";
import type { SlotSpec } from "../bindings/SlotSpec";
import type { WeekSlot } from "../bindings/WeekSlot";
import type { ActiveContext } from "../bindings/ActiveContext";
import type { ClassSnapshot } from "../bindings/ClassSnapshot";
import type { DrawResult } from "../bindings/DrawResult";
import type { GroupMode } from "../bindings/GroupMode";
import type { Member } from "../bindings/Member";
import type { Settings } from "../bindings/Settings";
import type { UpdateStatus } from "../bindings/UpdateStatus";
import type { WidgetInstance } from "../bindings/WidgetInstance";
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

/** Re-exported so the SHIM stays the one file that touches
 *  `@tauri-apps/api/core` (the reachability gate holds it to exactly one). */
export { isTauri };

// ── The fixture seam ────────────────────────────────────────────────────────
const FIXTURE_GATE: FixtureGate = {
  inTauri: isTauri(),
  // Vite inlines this as the literal `false` in a production build, so a
  // shipped SundayScreen cannot be driven by fixtures.
  devBuild: !!import.meta.env?.DEV,
  // `typeof location` guard: the node unit gate imports this module
  // transitively (state/chrome → here) and has no DOM.
  requested:
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).has(FIXTURE_QUERY_PARAM),
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

  // ── Classes / layout ─────────────────────────────────────────────────────
  // Read-or-bootstrap: outside Tauri there is nothing to bootstrap IN, so
  // the fallback is an ephemeral in-memory class — the shell renders, and
  // saves against it reject honestly.
  classEnsureActive: async (defaultName: string): Promise<ActiveContext> =>
    call(
      "class_ensure_active",
      { defaultName },
      {
        class: {
          id: "browser-fallback",
          name: defaultName,
          sortIndex: 0,
          createdAt: 0,
        },
        scene: {
          id: "browser-fallback-scene",
          classId: "browser-fallback",
          name: defaultName,
          sortIndex: 0,
          createdAt: 0,
        },
      },
    ),

  // A READ whose rejection TRAVELS (unlike the call()-family): the layout
  // store must know the load failed and block saving — a tolerant `[]` here
  // plus replace-all writes was a one-edit wipe of the stored layout
  // (F9-funn S#4).
  layoutLoad: async (sceneId: string): Promise<WidgetInstance[]> =>
    invoke<WidgetInstance[]>("layout_load", { sceneId }),

  // WRITE — rejection travels (see saveSettings).
  layoutSave: async (
    sceneId: string,
    widgets: WidgetInstance[],
  ): Promise<void> => invoke<void>("layout_save", { sceneId, widgets }),

  // ── Scenes (the screen library) ─────────────────────────────────────────
  sceneList: async (): Promise<Scene[]> => call("scene_list", undefined, []),

  sceneCreate: async (name: string): Promise<Scene> =>
    invoke<Scene>("scene_create", { name }),

  sceneRename: async (sceneId: string, name: string): Promise<Scene> =>
    invoke<Scene>("scene_rename", { sceneId, name }),

  sceneDelete: async (sceneId: string): Promise<void> =>
    invoke<void>("scene_delete", { sceneId }),

  sceneDuplicate: async (sceneId: string, name: string): Promise<Scene> =>
    invoke<Scene>("scene_duplicate", { sceneId, name }),

  /** THE switch: class + scene in one atomic pointer move + snapshot.
   *  `sceneId = null` lands on the class's default scene. */
  lessonSwitch: async (
    classId: string,
    sceneId: string | null,
  ): Promise<ClassSnapshot> => invoke("lesson_switch", { classId, sceneId }),

  // ── Planner ─────────────────────────────────────────────────────────────
  // The editor reads REJECT (S#4 lesson): a panel that replace-alls over a
  // silently-empty read would wipe the plan. state/planner.ts catches and
  // blocks edits instead.
  plannerPeriodsGet: async (): Promise<Period[]> =>
    invoke<Period[]>("planner_periods_get"),

  plannerPeriodsSet: async (periods: PeriodSpec[]): Promise<Period[]> =>
    invoke<Period[]>("planner_periods_set", { periods }),

  plannerWeekGet: async (): Promise<WeekSlot[]> =>
    invoke<WeekSlot[]>("planner_week_get"),

  plannerSlotSet: async (
    weekday: number,
    periodId: string,
    slot: SlotSpec | null,
  ): Promise<void> =>
    invoke<void>("planner_slot_set", { weekday, periodId, slot }),

  plannerOverrideSet: async (
    date: string,
    periodId: string,
    ovr: OverrideSpec | null,
  ): Promise<void> =>
    invoke<void>("planner_override_set", { date, periodId, ovr }),

  plannerDayGet: async (date: string, weekday: number): Promise<DayPlan> =>
    invoke<DayPlan>("planner_day_get", { date, weekday }),

  plannerAgendaSet: async (
    date: string,
    periodId: string,
    items: AgendaItemSpec[],
  ): Promise<AgendaItem[]> =>
    invoke<AgendaItem[]>("planner_agenda_set", { date, periodId, items }),

  plannerAgendaCheck: async (itemId: string, done: boolean): Promise<void> =>
    invoke<void>("planner_agenda_check", { itemId, done }),

  plannerNotesSet: async (
    date: string,
    notes: NoteSpec[],
  ): Promise<DayNote[]> =>
    invoke<DayNote[]>("planner_notes_set", { date, notes }),

  classList: async (): Promise<Class[]> => call("class_list", undefined, []),

  membersGet: async (classId: string): Promise<Member[]> =>
    call<Member[]>("members_get", { classId }, []),

  // The rest are WRITES — rejections travel, so the manage panel can say
  // what actually went wrong instead of fabricating success.
  classCreate: async (name: string): Promise<Class> =>
    invoke<Class>("class_create", { name }),

  classRename: async (classId: string, name: string): Promise<Class> =>
    invoke<Class>("class_rename", { classId, name }),

  classDelete: async (classId: string): Promise<void> =>
    invoke<void>("class_delete", { classId }),

  classSwitch: async (classId: string): Promise<ClassSnapshot> =>
    invoke<ClassSnapshot>("class_switch", { classId }),

  membersSet: async (classId: string, names: string[]): Promise<Member[]> =>
    invoke<Member[]>("members_set", { classId, names }),

  // Draw/split are WRITES against the round state — rejections travel, so
  // the widgets can say "no names yet" instead of fabricating a pupil.
  pickerDraw: async (classId: string, noRepeat: boolean): Promise<DrawResult> =>
    invoke<DrawResult>("picker_draw", { classId, noRepeat }),

  pickerReset: async (classId: string): Promise<void> =>
    invoke<void>("picker_reset", { classId }),

  groupsSplit: async (
    classId: string,
    mode: GroupMode,
    n: number,
  ): Promise<Member[][]> =>
    invoke<Member[][]>("groups_split", { classId, mode, n }),

  // WRITE-ish (window management) — rejection travels so the chrome can
  // revert its optimistic flag in a plain browser.
  windowSetFullscreen: async (fullscreen: boolean): Promise<void> =>
    invoke<void>("window_set_fullscreen", { fullscreen }),

  // The manual update check answers with a STATUS (errors included) — the
  // panel shows it; only a broken IPC rejects. Install is a WRITE: a
  // successful install restarts the app (never resolves); the one non-
  // restart outcome is "the feed emptied since the check" — an honest
  // status, not a fabricated success.
  updateCheck: async (): Promise<UpdateStatus> =>
    invoke<UpdateStatus>("update_check"),

  updateInstall: async (): Promise<UpdateStatus> =>
    invoke<UpdateStatus>("update_install"),
};

export type Api = typeof api;

declare global {
  interface Window {
    api: Api;
  }
}

// Same node-gate guard as above: in the browser this ALWAYS runs.
if (typeof window !== "undefined") {
  window.api = api;
}
