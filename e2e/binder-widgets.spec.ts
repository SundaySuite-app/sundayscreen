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
  await page.getByRole("button", { name: "Legg til økt" }).click();
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
  await expect(agenda).toContainText("Ingen time nå");

  await agenda.getByRole("button", { name: "Manuell" }).click();
  await agenda.getByLabel("Ny aktivitet …").fill("Lese stille");
  await agenda.getByLabel("Ny aktivitet …").press("Enter");
  await expect(agenda).toContainText("Lese stille");

  // The manual list lives in the widget config — reload restores it.
  await page.reload();
  await expect(page.locator('[data-widget-kind="agenda"]')).toContainText(
    "Lese stille",
  );
});
