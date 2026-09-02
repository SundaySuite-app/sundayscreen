// The design session's CONSUMER side: the three guards that live outside
// `design-session.ts` because the things they guard live outside it.
//
// `design-session.test.ts` proves the session keeps its own promises. This
// file proves nothing else can break them from the outside — the automation
// that fires on a timer, the lesson jump every switch funnels through, and
// the panel the session lives inside. All three are in state the teacher
// never sees, so all three are asserted the same way the session's own tests
// are: against a stubbed `window.api` and an ORDERED call log.
//
// Node environment, like every unit test here (never jsdom).
//
// ## Two pieces of module state outlive a test
//
//   * the persister's `inflight`/`debounceTimer` (drained in `afterEach`);
//   * `maybeAutoSwitch`'s `autoSettledKeys`, which is private, permanent and
//     keyed on `date:periodId`. Every test below therefore builds its plan on
//     its OWN date — a shared one would let the first test that fires settle
//     the key for the rest of the file, and the guard would then look like it
//     was working when nothing was being tested at all.
//
// Time is faked for `Date` ONLY (`toFake: ["Date"]`): the plan's window has to
// cover "now", but `setTimeout` belongs to the persister's debounce and to the
// microtask drains below, and freezing it would deadlock both.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Class } from "../bindings/Class";
import type { ClassSnapshot } from "../bindings/ClassSnapshot";
import type { DayPlan } from "../bindings/DayPlan";
import type { Scene } from "../bindings/Scene";
import type { WidgetInstance } from "../bindings/WidgetInstance";
import { designSession, enterDesign, exitDesign } from "./design-session";
import {
  activeScene,
  adoptSnapshot,
  flushPending,
  saveSoon,
  widgets,
} from "./layout";
import {
  closePlanner,
  maybeAutoSwitch,
  plannerNowMs,
  plannerPanelOpen,
  todayPlan,
} from "./planner";
import { switchLesson } from "./scenes";
import { settings } from "./settings";

const CLASS: Class = { id: "c1", name: "7B", sortIndex: 0, createdAt: 0 };

/** The screen on the projector — the lesson in progress. */
const LESSON: Scene = {
  id: "default-c1",
  classId: "c1",
  name: "7B",
  sortIndex: 0,
  createdAt: 0,
  theme: "standard",
};
/** The screen being prepared for a later lesson. */
const DESIGN: Scene = {
  id: "s-design",
  classId: null,
  name: "Morgensamling",
  sortIndex: 1,
  createdAt: 0,
  theme: "papir",
};
/** What the auto-switch is supposed to land on when it is allowed to run. */
const NEXT_SCENE: Scene = { ...DESIGN, id: "s-next", name: "Stasjoner" };

function textWidget(id: string): WidgetInstance {
  return {
    id,
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    z: 0,
    config: { kind: "text", content: id, fontScale: 1, align: "left" },
  };
}
const A = textWidget("a");
const D1 = textWidget("d1");
const D2 = textWidget("d2");

/**
 * One 08:30–09:15 lesson for class `c2` on `date`, with the clock at 08:35 —
 * inside the window, so the automation has something it WANTS to do. The
 * active pointers below are `c1`/`default-c1`, i.e. never on target.
 */
function planWithLessonAt(date: string): DayPlan {
  return {
    date,
    weekday: 1,
    entries: [
      {
        period: {
          id: "p1",
          label: "1. time",
          startMin: 510,
          endMin: 555,
          kind: "lesson",
          sortIndex: 0,
        },
        lesson: {
          classId: "c2",
          className: "8A",
          subject: "Norsk",
          sceneId: NEXT_SCENE.id,
          sceneName: NEXT_SCENE.name,
          title: "",
          overridden: false,
        },
        agenda: [],
      },
    ],
    notes: [],
  };
}

// ── The stub, with one ordered log ──────────────────────────────────────────

type Call =
  | { op: "load"; sceneId: string }
  /** `panelOpen` travels with every write: «did the panel outlive the
   *  session's last save?» is an ordering question, and ordering questions
   *  are only answerable from inside the call. */
  | { op: "save"; sceneId: string; ids: string[]; panelOpen: boolean }
  | { op: "switch"; classId: string; sceneId: string | null };

const calls: Call[] = [];

const layoutLoad = vi.fn(async (sceneId: string) => {
  calls.push({ op: "load", sceneId });
  return [D1];
});

const layoutSave = vi.fn(async (sceneId: string, list: WidgetInstance[]) => {
  calls.push({
    op: "save",
    sceneId,
    ids: list.map((w) => w.id),
    panelOpen: plannerPanelOpen.peek(),
  });
});

const lessonSwitch = vi.fn(
  async (classId: string, sceneId: string | null): Promise<ClassSnapshot> => {
    calls.push({ op: "switch", classId, sceneId });
    return {
      class: { ...CLASS, id: classId },
      scene: sceneId === NEXT_SCENE.id ? NEXT_SCENE : LESSON,
      members: [],
      widgets: [],
    };
  },
);

const settingsSave = vi.fn(async () => undefined);
const settingsSetWindow = vi.fn(async () => undefined);

vi.stubGlobal("window", {
  api: {
    layoutLoad,
    layoutSave,
    lessonSwitch,
    settingsSave,
    settingsSetWindow,
  },
});

/** Let every queued promise settle — the automation is `void`-ed on purpose
 *  (a timer tick has nobody to report to), so its work is only observable
 *  after the microtask queue has drained. */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function switches(): { classId: string; sceneId: string | null }[] {
  return calls
    .filter((c): c is Extract<Call, { op: "switch" }> => c.op === "switch")
    .map(({ classId, sceneId }) => ({ classId, sceneId }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  calls.length = 0;
  layoutLoad.mockClear();
  layoutSave.mockClear();
  lessonSwitch.mockClear();
  designSession.value = null;
  plannerPanelOpen.value = false;
  adoptSnapshot({ class: CLASS, scene: LESSON, members: [], widgets: [A] });
  settings.value = {
    ...settings.peek(),
    activeClassId: CLASS.id,
    activeSceneId: LESSON.id,
    autoSwitchScenes: true,
  };
});

afterEach(async () => {
  await flushPending();
  designSession.value = null;
  plannerPanelOpen.value = false;
  todayPlan.value = null;
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Put the clock inside the plan's lesson and hand the plan to the widgets. */
function nowInsideLesson(date: string): void {
  vi.setSystemTime(new Date(`${date}T08:35:00`));
  todayPlan.value = planWithLessonAt(date);
  plannerNowMs.value = Date.now();
}

// ── 1. The automation does not fire into a borrowed board ───────────────────

describe("maybeAutoSwitch during a design session", () => {
  it("stays silent — and does NOT settle the key, so it fires after «Ferdig»", async () => {
    nowInsideLesson("2026-08-31");
    await enterDesign(DESIGN);

    // The 30 s tick, three times, while the teacher is arranging Wednesday's
    // screen. A switch here would swap `activeScene` out from under the
    // session: the next debounced write reads it at WRITE time, so the
    // widgets on the little board would be filed into the RUNNING lesson's
    // scene, with the class in front of it.
    maybeAutoSwitch();
    maybeAutoSwitch();
    maybeAutoSwitch();
    await drain();
    expect(switches()).toEqual([]);

    await exitDesign();

    // The other half of the guard, and the reason it is the FIRST line of the
    // function rather than a branch further down: the key was never settled,
    // so the automation still has its one say. A guard placed after
    // `autoSettledKeys.add(key)` would have consumed the lesson silently, and
    // the teacher would come out of the panel to a board that never switched
    // and never will.
    maybeAutoSwitch();
    await drain();
    expect(switches()).toEqual([{ classId: "c2", sceneId: NEXT_SCENE.id }]);
  });

  it("fires on the very next tick when no session is running", async () => {
    // The control: same plan, same clock, no borrow. Without this the test
    // above passes just as well on a plan the automation never wanted.
    nowInsideLesson("2026-09-01");
    maybeAutoSwitch();
    await drain();
    expect(switches()).toEqual([{ classId: "c2", sceneId: NEXT_SCENE.id }]);
  });
});

// ── 2. The belt on the lesson jump ──────────────────────────────────────────

describe("switchLesson while the board is borrowed", () => {
  it("ends the session — and writes the design edit under the DESIGN scene", async () => {
    nowInsideLesson("2026-09-02");
    await enterDesign(DESIGN);
    const mark = calls.length;

    // A card dragged onto the little board, debounced, still unwritten.
    widgets.value = [D1, D2];
    saveSoon();

    await switchLesson("c2", NEXT_SCENE.id);

    // The ORDER is the assertion. `exitDesign` flushes first, so the pending
    // write lands under `s-design`; only then do the globals go back and the
    // jump proceed. A jump that swapped first would have filed `[d1, d2]`
    // into whatever scene the switch had just landed on.
    expect(calls.slice(mark)).toEqual([
      {
        op: "save",
        sceneId: DESIGN.id,
        ids: ["d1", "d2"],
        panelOpen: false,
      },
      { op: "switch", classId: "c2", sceneId: NEXT_SCENE.id },
    ]);
    expect(designSession.value).toBeNull();
    // And the board the jump chose is the one on screen — the session's
    // restore ran BEFORE the switch, so it cannot have overwritten it.
    expect(activeScene.value?.id).toBe(NEXT_SCENE.id);
  });

  it("is a plain flush-then-swap when no session is running", async () => {
    // The belt costs nothing on the path everything else takes.
    widgets.value = [A];
    saveSoon();
    await switchLesson("c2", NEXT_SCENE.id);
    expect(calls).toEqual([
      { op: "save", sceneId: LESSON.id, ids: ["a"], panelOpen: false },
      { op: "switch", classId: "c2", sceneId: NEXT_SCENE.id },
    ]);
  });
});

// ── 3. One door out of the panel ────────────────────────────────────────────

describe("closePlanner", () => {
  it("hands the board back BEFORE the panel goes away", async () => {
    plannerPanelOpen.value = true;
    await enterDesign(DESIGN);
    const mark = calls.length;
    widgets.value = [D1, D2];
    saveSoon();

    await closePlanner();

    // `panelOpen: true` on the save is the ordering claim, made from inside
    // the write: the session's last edit was still being flushed while the
    // panel stood. Dropping the flag first would have left the projector
    // rendering the design scene for as long as the write took — and, if the
    // restore had been skipped with it, for the rest of the lesson.
    expect(calls.slice(mark)).toEqual([
      { op: "save", sceneId: DESIGN.id, ids: ["d1", "d2"], panelOpen: true },
    ]);
    expect(designSession.value).toBeNull();
    expect(plannerPanelOpen.value).toBe(false);
    expect(activeScene.value?.id).toBe(LESSON.id);
    expect(widgets.value).toEqual([A]);
  });

  it("just closes the panel when no session was open", async () => {
    plannerPanelOpen.value = true;
    await closePlanner();
    expect(plannerPanelOpen.value).toBe(false);
    expect(calls).toEqual([]);
  });
});
