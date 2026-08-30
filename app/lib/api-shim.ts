// `window.api` — the ONE door into the backend.
//
// Every `invoke()` in the app goes through this module: the fixture seam
// covers them with one hook, every failure lands in the bounded failure ring,
// and outside Tauri each command degrades to its typed fallback so the whole
// shell boots in a plain browser (which is what makes the Playwright tier
// possible with no backend at all).

import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import type { AppInfo } from "../bindings/AppInfo";
import type { BootFault } from "../bindings/BootFault";
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
import type { DrawManyResult } from "../bindings/DrawManyResult";
import type { GroupMode } from "../bindings/GroupMode";
import type { ImportReceipt } from "../bindings/ImportReceipt";
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

/**
 * Invoke a WRITE: remember the failure, then let the rejection travel.
 *
 * The third shape, and the one that was missing. `call()` answers a
 * fabricated success, which is illegal for a write (promise 4); a bare
 * `invoke` is honest but INVISIBLE — the failure never reaches the ring, so
 * «Siste IPC-feil» cannot see it and the pattern behind a bad afternoon
 * (a locked database, a full disk) is unreadable. Every failed draw, round
 * reset and split went that way, into a `console.warn` nobody in a classroom
 * has open (funn U#7, filed as fixed for a year without being fixed).
 *
 * No toast here, deliberately: the caller stands next to a button the teacher
 * just pressed and can say something better than "something in the
 * background did not answer".
 */
async function write<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[api-shim] ${cmd} failed → rejecting`, e);
    recordFailure(ipcFailures, cmd, ipcErrText(e), Date.now());
    throw e;
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
   * Did the boot go wrong? A READ with a typed fallback, and the fallback has
   * to be `null`: in a plain browser (and in every fixtureless test) there IS
   * no boot fault, and a chip claiming one would be the loudest lie the shell
   * can tell. `boot_fault` is one of the three commands that do NOT take
   * `State<Db>`, which is what lets it answer on the very boot it describes.
   */
  bootFault: async (): Promise<BootFault | null> =>
    call<BootFault | null>("boot_fault", undefined, null),

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

  // A READ whose rejection TRAVELS, for the same reason `layoutLoad`'s does:
  // the member list sits behind `members_set`, a REPLACE-ALL write. A
  // tolerant `[]` made a failed read look exactly like a class with no
  // pupils — and the manage panel seeded its textarea from that emptiness,
  // so one click on «Lagre navneliste» wrote the emptiness back and deleted
  // the class's names (R4-spor 3.1). `state/classes.ts` catches it and marks
  // the list UNREAD instead.
  membersGet: async (classId: string): Promise<Member[]> =>
    invoke<Member[]>("members_get", { classId }),

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
  // the widgets can say "no names yet" instead of fabricating a pupil, and
  // they go through `write()` so the failure is also REMEMBERED (a fallback
  // here would be a name on the board that was never drawn).
  //
  // `today` is the LOCAL wall date, `YYYY-MM-DD` (ADR-009: JS owns the wall
  // clock, Rust validates the shape). It decides who is marked away — mint
  // it at CALL time, never at module load: a machine left on overnight would
  // otherwise deal yesterday's absences into today's lesson.
  //
  // ONE command for one name and for five: the draw is a single decision, so
  // it is a single transaction. A frontend loop over a one-name command
  // would draw the same pupil twice whenever the round ran dry mid-loop,
  // swallow all but the last `reshuffled`, and leave the first names
  // recorded when a later one failed.
  pickerDrawMany: async (
    classId: string,
    noRepeat: boolean,
    n: number,
    today: string,
  ): Promise<DrawManyResult> =>
    write<DrawManyResult>("picker_draw_many", { classId, noRepeat, n, today }),

  pickerReset: async (classId: string): Promise<void> =>
    write<void>("picker_reset", { classId }),

  groupsSplit: async (
    classId: string,
    mode: GroupMode,
    n: number,
    today: string,
  ): Promise<Member[][]> =>
    write<Member[][]>("groups_split", { classId, mode, n, today }),

  // WRITE — rejection travels: a chip must never dim on a write that did not
  // land. Answers with the whole updated member list, so the panel renders
  // from what was actually stored.
  attendanceSet: async (
    classId: string,
    memberId: string,
    absent: boolean,
    today: string,
  ): Promise<Member[]> =>
    invoke<Member[]>("attendance_set", { classId, memberId, absent, today }),

  // WRITE-ish (window management) — rejection travels so the chrome can
  // revert its optimistic flag in a plain browser.
  windowSetFullscreen: async (fullscreen: boolean): Promise<void> =>
    invoke<void>("window_set_fullscreen", { fullscreen }),

  // A READ, so the typed fallback is legal: in a plain browser there is no
  // window to measure and `false` is simply true. Asking the BACKEND rather
  // than `win.isFullscreen()` is the point — on macOS the JS answer is
  // `false` during simple fullscreen, which would seed the wrong flag.
  windowIsFullscreen: async (): Promise<boolean> =>
    call<boolean>("window_is_fullscreen", undefined, false),

  // The manual update check answers with a STATUS (errors included) — the
  // panel shows it; only a broken IPC rejects. Install is a WRITE: a
  // successful install restarts the app (never resolves); the one non-
  // restart outcome is "the feed emptied since the check" — an honest
  // status, not a fabricated success.
  updateCheck: async (): Promise<UpdateStatus> =>
    invoke<UpdateStatus>("update_check"),

  updateInstall: async (): Promise<UpdateStatus> =>
    invoke<UpdateStatus>("update_install"),

  // ── «Flytt oppsettet» (eksport/import) ──────────────────────────────────
  //
  // Both are WRITES, and both go through `write()`: one writes a FILE, the
  // other writes rows. A `call()` fallback would be the worst possible shape
  // here — a receipt for an export that never reached the disk, or an
  // "imported nothing" answer for an import that actually failed.
  //
  // The dialog TITLE travels in as an argument (and the export's suggested
  // filename with it): the file dialog is native and opened in Rust, so this
  // is the same rule `classEnsureActive(defaultName)` follows — the backend
  // never owns a sentence a teacher reads.

  /** Write the whole setup to a file the teacher picks. Answers with the
   *  path written, or `null` when she closed the dialog (not a failure). */
  transferExport: async (
    dialogTitle: string,
    suggestedName: string,
  ): Promise<string | null> =>
    write<string | null>("transfer_export", { dialogTitle, suggestedName }),

  /** Read a setup file the teacher picks and ADD what is in it. Always
   *  answers with a receipt — the refusals (not our file, too new, too big)
   *  are OUTCOMES, because each is a different sentence and none of them
   *  wrote anything. Only a real storage failure rejects. */
  transferImport: async (dialogTitle: string): Promise<ImportReceipt> =>
    write<ImportReceipt>("transfer_import", { dialogTitle }),

  /** What the SILENT boot check found, or `null` while it has not answered
   *  (and forever, offline). A READ with a `null` fallback for the same
   *  reason as `bootFault`: no answer must never render as an answer. */
  updatePending: async (): Promise<UpdateStatus | null> =>
    call<UpdateStatus | null>("update_pending", undefined, null),
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
