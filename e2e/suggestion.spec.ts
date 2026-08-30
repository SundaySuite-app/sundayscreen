import { expect, test, type Page } from "@playwright/test";

import { installFixtures } from "./harness";

// The lesson-start banner + the opt-in auto-switch. Time is always driven
// by the mocked clock — never wall time.

async function planMondayLesson(page: Page) {
  await page.goto("/?goto=planner:periods");
  await page.getByRole("button", { name: "Legg til time" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await page.getByRole("button", { name: "Ukeplan" }).click();
  await page.locator("button:has-text('—')").first().click();
  await page
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "8A" });
  await page.getByLabel("Fag").fill("Norsk");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
}

/**
 * A week plan that ALREADY EXISTS when the process starts, written straight
 * into the fixture store. `planMondayLesson` cannot serve this journey: it
 * builds the plan through the panel, i.e. after boot, and the whole point
 * here is a lesson that was under way before the app ever ran.
 *
 * Monday carries a midday lesson (12:00–12:45) for 8A, Tuesday a morning one
 * (08:30–09:15). The board starts on 7B, so either one is a real switch away,
 * and the automation is on from the first tick.
 */
async function seedTwoDayWeekPlan(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const DB_KEY = "__e2e_db__";
    // addInitScript re-runs on every navigation — seed only an empty store,
    // or a reload would erase whatever the journey has done since.
    if (localStorage.getItem(DB_KEY) != null) return;
    localStorage.setItem(
      DB_KEY,
      JSON.stringify({
        classes: [
          { id: "c1", name: "7B", sortIndex: 0, createdAt: 1 },
          { id: "c2", name: "8A", sortIndex: 1, createdAt: 2 },
        ],
        scenes: [
          {
            id: "default-c1",
            classId: "c1",
            name: "7B",
            sortIndex: 0,
            createdAt: 1,
          },
          {
            id: "default-c2",
            classId: "c2",
            name: "8A",
            sortIndex: 1,
            createdAt: 2,
          },
        ],
        activeClassId: "c1",
        activeSceneId: "default-c1",
        members: { c1: [], c2: [] },
        layouts: { "default-c1": [], "default-c2": [] },
        drawn: {},
        settings: {
          language: "no",
          activeClassId: "c1",
          activeSceneId: "default-c1",
          snapEnabled: true,
          window: null,
          updateChannel: "stable",
          // Opt-in automation, already opted in: this journey is about what
          // it does once a teacher has said yes.
          autoSwitchScenes: true,
        },
        periods: [
          {
            id: "p-morning",
            label: "Time 1",
            startMin: 510,
            endMin: 555,
            kind: "lesson",
            sortIndex: 0,
          },
          {
            id: "p-midday",
            label: "Time 4",
            startMin: 720,
            endMin: 765,
            kind: "lesson",
            sortIndex: 1,
          },
        ],
        slots: {
          "1:p-midday": { classId: "c2", subject: "Norsk", sceneId: null },
          "2:p-morning": { classId: "c2", subject: "Matte", sceneId: null },
        },
        nextId: 100,
      }),
    );
  });
}

test("the banner suggests, one click switches class and scene", async ({
  page,
}) => {
  await installFixtures(page);
  // Monday 08:20 — before the 08:30 lesson's five-minute window.
  await page.clock.install({ time: new Date("2026-08-31T08:20:00") });
  await page.goto("/");

  // A second class the lesson belongs to.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  // Back on 7B so the banner has something to suggest away from.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();

  await planMondayLesson(page);
  await expect(page.locator('[data-status="suggestion"]')).toHaveCount(0);

  // Cross into the window (08:26) — the 30 s planner tick re-evaluates.
  await page.clock.fastForward(6 * 60_000);
  const banner = page.locator('[data-status="suggestion"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("8A");
  await expect(banner).toContainText("Norsk");

  await banner.getByRole("button", { name: "Bytt til timen" }).click();
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "8A",
  );
  // On target now — the banner stands down.
  await expect(banner).toHaveCount(0);
});

test("«Ikke nå» silences the lesson", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:20:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await planMondayLesson(page);

  await page.clock.fastForward(6 * 60_000);
  const banner = page.locator('[data-status="suggestion"]');
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Ikke nå" }).click();
  await expect(banner).toHaveCount(0);

  // Still silent later in the same lesson.
  await page.clock.fastForward(10 * 60_000);
  await expect(banner).toHaveCount(0);
});

test("auto-switch flips the board when the lesson starts", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:20:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await planMondayLesson(page);

  // Turn the automation on (Timeoppsett tab footer).
  await page.getByRole("button", { name: "Planlegger" }).click();
  await page.getByRole("button", { name: "Timeoppsett" }).click();
  await page
    .getByRole("checkbox", {
      name: "Bytt skjerm automatisk når timen starter",
    })
    .check();
  await page.getByRole("button", { name: "Lukk" }).click();

  // Before start: nothing moves by itself.
  const size = page.viewportSize()!;
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "7B",
  );
  // Cross the start (08:30) and let the tick land. The chrome auto-hides
  // during the fast-forward (U#9: hidden is also out of the a11y tree), so
  // reach for it before reading the toolbar.
  await page.clock.fastForward(11 * 60_000);
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "8A",
  );
});

test("auto-switch leaves a manual mid-lesson switch alone (F-funn B3)", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:20:00") });
  await page.goto("/");
  // Plan 7B's own lesson, so the board is ALREADY on target at start.
  await page.goto("/?goto=planner:periods");
  await page.getByRole("button", { name: "Legg til time" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await page.getByRole("button", { name: "Ukeplan" }).click();
  await page.locator("button:has-text('—')").first().click();
  await page
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await page.getByLabel("Fag").fill("Norsk");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await page.getByRole("button", { name: "Timeoppsett" }).click();
  await page
    .getByRole("checkbox", {
      name: "Bytt skjerm automatisk når timen starter",
    })
    .check();
  await page.getByRole("button", { name: "Lukk" }).click();

  // The lesson starts while we are already on 7B's default screen.
  await page.clock.fastForward(11 * 60_000);

  // Mid-lesson the teacher deliberately shows a library scene. The chrome
  // auto-hid during the fast-forward — reach for it, like a teacher would.
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Video");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Video",
  );

  // Several ticks later the automation must NOT have yanked the board back.
  await page.clock.fastForward(3 * 60_000);
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Video",
  );
});

/**
 * The day after (R4-funn 3.4). Classroom machines SLEEP rather than shut
 * down, so the process that started at 12:40 is still the one running the
 * next morning. The "already running when we booted" guard therefore has to
 * expire with its day: an undated boot stamp settles every lesson starting
 * before 12:40 — every morning, in silence, for as long as the app lives.
 */
test("the boot guard expires with its day — tomorrow's first lesson still switches", async ({
  page,
}) => {
  await installFixtures(page);
  await seedTwoDayWeekPlan(page);
  // DAY 1: Monday 12:40. The 12:00 lesson has been running for forty minutes
  // before this process ever existed.
  await page.clock.install({ time: new Date("2026-08-31T12:40:00") });
  await page.goto("/");

  const size = page.viewportSize()!;
  const classBtn = page.getByRole("button", { name: "Bytt klasse" });
  const banner = page.locator('[data-status="suggestion"]');
  await expect(classBtn).toContainText("7B");

  // Today's CORRECT behaviour, unchanged: a lesson already under way at boot
  // keeps the restored board (promise #2). The banner still offers it.
  await page.clock.fastForward(60_000);
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("8A");
  await expect(classBtn).toContainText("7B");

  // The lid closes. 12:41 → 00:02 the next day: the date rolls over and the
  // ticker re-fetches (the plan is now Tuesday's).
  await page.clock.fastForward(11 * 60 * 60_000 + 21 * 60_000);
  // ... and on to 08:31, past the start of Tuesday's first lesson. The
  // automation only acts once a lesson is RUNNING, never in its lead window.
  await page.clock.fastForward(8 * 60 * 60_000 + 29 * 60_000);

  // DAY 2 is not boot day, so Monday's 12:40 stamp says nothing about a
  // Tuesday 08:30 lesson: the board follows the plan.
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(classBtn).toContainText("8A");
  // On target now — the banner stands down.
  await expect(banner).toHaveCount(0);
});
