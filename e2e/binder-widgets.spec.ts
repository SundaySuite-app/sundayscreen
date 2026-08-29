import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// «Dagens time» and «Dagen i dag»: planned in the planner in advance, shown
// on the board by the widgets — the round's core promise.

test("plan a lesson, see it in both widgets, check off an activity", async ({
  page,
}) => {
  await installFixtures(page);
  // A Monday, 08:35 — INSIDE the lesson we are about to plan.
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });
  await page.goto("/?goto=planner:periods");
  // A fresh dev server can push one vite full-reload shortly after boot
  // (dependency optimization); let it land BEFORE we start interacting, or
  // it wipes the panel mid-journey.
  await page.waitForLoadState("networkidle");

  // Template: one lesson 08:30–09:15.
  await page.getByRole("button", { name: "Legg til time" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  // Week: Monday × Time 1 = 7B Norsk.
  await page.getByRole("button", { name: "Ukeplan" }).click();
  await page.locator("button:has-text('—')").first().click();
  await page
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await page.getByLabel("Fag").fill("Norsk");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();

  // Today: two activities + a message.
  await page.getByRole("button", { name: "I dag", exact: true }).click();
  await page.getByRole("button", { name: "Legg til aktivitet" }).click();
  await page.getByPlaceholder("Hva skal skje …").fill("Gjennomgang");
  await page.getByLabel("min").fill("10");
  await page.getByRole("button", { name: "Lagre agenda" }).click();
  await page.getByRole("button", { name: "Legg til beskjed" }).click();
  await page.getByPlaceholder("Beskjed til klassen …").fill("Husk gymtøy");
  await page.getByRole("button", { name: "Lagre beskjeder" }).click();
  // Both receipts (agenda + notes) — the saves' re-renders are DONE, so the
  // close click below cannot be swallowed by a node swap mid-dispatch.
  await expect(page.getByText("Lagret")).toHaveCount(2);
  await page.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);

  // «Dagens time» shows the planned lesson, live.
  await addWidget(page, "Dagens time");
  const agenda = page.locator('[data-widget-kind="agenda"]');
  await expect(agenda).toContainText("Norsk");
  await expect(agenda).toContainText("7B");
  await expect(agenda).toContainText("Gjennomgang");
  await expect(agenda).toContainText("08:30");

  // Check the activity off — and it SURVIVES a reload (stored in the plan).
  await agenda.getByRole("button", { name: "Merk gjort" }).click();
  await expect(
    agenda.getByRole("button", { name: "Merk gjort" }),
  ).toHaveAttribute("aria-pressed", "true");
  // A plain goto, not reload(): reload keeps ?goto=planner in the URL and
  // the boot wiring would reopen the panel over the board.
  await page.goto("/");
  await expect(
    page
      .locator('[data-widget-kind="agenda"]')
      .getByRole("button", { name: "Merk gjort" }),
  ).toHaveAttribute("aria-pressed", "true");

  // «Dagen i dag» shows the weekday, the timetable and the message.
  await addWidget(page, "Dagen i dag");
  const today = page.locator('[data-widget-kind="today"]');
  await expect(today).toContainText("mandag");
  await expect(today).toContainText("08:30");
  await expect(today).toContainText("Norsk");
  await expect(today).toContainText("Husk gymtøy");
});

test("manual mode works without any plan", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Dagens time");
  const agenda = page.locator('[data-widget-kind="agenda"]');
  await expect(agenda).toContainText("Ingen timeplan satt opp ennå");

  // Planner mode offers three settings; manual mode offers two. «Tider»
  // derives start times from `durationMin`, which is ALWAYS null on manual
  // items — a control that cannot do anything teaches a teacher that the
  // row is unreliable. The choice itself stays in the config.
  await agenda.hover();
  await expect(agenda.locator("[data-settings-row] button")).toHaveCount(3);
  await agenda.getByRole("button", { name: "Manuell" }).click();
  await expect(agenda.locator("[data-settings-row] button")).toHaveCount(2);

  await agenda.getByLabel("Ny aktivitet …").fill("Lese stille");
  await agenda.getByLabel("Ny aktivitet …").press("Enter");
  await expect(agenda).toContainText("Lese stille");

  // The manual list lives in the widget config — reload restores it.
  await page.reload();
  await expect(page.locator('[data-widget-kind="agenda"]')).toContainText(
    "Lese stille",
  );
});

test("«ingen time nå» and «ingen timeplan» are different days", async ({
  page,
}) => {
  await installFixtures(page);
  // A SATURDAY. The day a weekday-indexed planner goes blind on, and the day
  // where the two sentences below are genuinely different facts.
  await page.clock.install({ time: new Date("2026-09-05T10:00:00") });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await addWidget(page, "Dagens time");
  await addWidget(page, "Dagen i dag");
  const agenda = page.locator('[data-widget-kind="agenda"]');
  const today = page.locator('[data-widget-kind="today"]');

  // Nothing is set up at all — and this is the state a first-evening teacher
  // is actually in. NOT «ingen time nå», which would be an answer about a
  // timetable she has not made yet.
  await expect(agenda).toContainText("Ingen timeplan satt opp ennå");
  await expect(today).toContainText("Ingen timeplan satt opp ennå");

  // In the agenda the sentence is a DOOR, and it opens a planner that is
  // READY: setting `plannerPanelOpen` alone would open one with
  // `plannerHydrated === false`, i.e. every editor blocked for a teacher who
  // did nothing wrong.
  await agenda
    .getByRole("button", { name: "Ingen timeplan satt opp ennå" })
    .click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toBeVisible();
  await page.getByRole("button", { name: "Timeoppsett", exact: true }).click();
  await page.getByRole("button", { name: "Legg til time" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();
  await page.getByRole("button", { name: "Lukk" }).click();

  // Same Saturday, now WITH a day template and still no lesson in it: both
  // widgets change their answer, and neither claims the timetable is missing.
  await expect(agenda).toContainText("Ingen time nå");
  await expect(today).toContainText("Ingen timer i dag");
  await expect(today).not.toContainText("Ingen timeplan");
});
