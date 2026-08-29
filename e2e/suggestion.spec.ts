import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The lesson-start banner + the opt-in auto-switch. Time is always driven
// by the mocked clock — never wall time.

async function planMondayLesson(page: import("@playwright/test").Page) {
  await page.goto("/?goto=planner:periods");
  await page.getByRole("button", { name: "Legg til økt" }).click();
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

  await banner.getByRole("button", { name: "Bytt skjerm" }).click();
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
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "7B",
  );
  // Cross the start (08:30) and let the tick land.
  await page.clock.fastForward(11 * 60_000);
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "8A",
  );
});
