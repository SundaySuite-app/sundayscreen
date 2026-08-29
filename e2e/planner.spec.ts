import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The planner journey: define the day template, fill a weekly slot, override
// a date, plan an agenda — and everything survives a reload.

test("template → week → override → agenda, all persisted", async ({ page }) => {
  await installFixtures(page);
  // A Monday, so the week plan's first column is "today".
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/?goto=planner:periods");

  // ── Timeoppsett: one lesson + a break + another lesson.
  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.getByRole("button", { name: "Legg til økt" }).click();
  const rows = page.locator("input[aria-label='Navn']");
  await expect(rows).toHaveCount(2);
  // Adjust the second row to be a break 09:15–09:30.
  await rows.nth(1).fill("Friminutt");
  await page.locator("input[aria-label='Start']").nth(1).fill("09:15");
  await page.locator("input[aria-label='Slutt']").nth(1).fill("09:30");
  await page.getByRole("button", { name: "Time", exact: true }).nth(1).click();
  // First row: Time 1 08:30–09:15.
  await page.locator("input[aria-label='Start']").nth(0).fill("08:30");
  await page.locator("input[aria-label='Slutt']").nth(0).fill("09:15");
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  // ── Ukeplan: fill Monday × Time 1.
  await page.getByRole("button", { name: "Ukeplan" }).click();
  await expect(page.getByText("Mandag")).toBeVisible();
  await page.locator("button:has-text('—')").first().click();
  await page
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await page.getByLabel("Fag").fill("Norsk");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page.getByRole("button", { name: "7B Norsk" })).toBeVisible();

  // ── I dag: the Monday lesson is there; override it and add an agenda.
  await page.getByRole("button", { name: "I dag", exact: true }).click();
  // The key lives in a data attribute; the teacher sees «mandag 31. august».
  await expect(page.locator('[data-date="2026-08-31"]')).toBeVisible();
  await expect(page.getByText("Norsk")).toBeVisible();

  await page.getByRole("button", { name: "Overstyr" }).click();
  await page.getByLabel("Tittel").fill("Prøve");
  await page.getByLabel("Fag").fill("Matte");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page.getByText("Avvik", { exact: true })).toBeVisible();
  await expect(page.getByText("Prøve")).toBeVisible();

  await page.getByRole("button", { name: "Legg til aktivitet" }).click();
  await page.getByPlaceholder("Hva skal skje …").fill("Del ut prøven");
  await page.getByLabel("min").fill("5");
  await page.getByRole("button", { name: "Lagre agenda" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  // ── Beskjeder.
  await page.getByRole("button", { name: "Legg til beskjed" }).click();
  await page.getByPlaceholder("Beskjed til klassen …").fill("Husk gymtøy");
  await page.getByRole("button", { name: "Lagre beskjeder" }).click();

  // ── Reload: everything is still there.
  await page.reload();
  await page.goto("/?goto=planner:day");
  await expect(page.getByText("Prøve")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Hva skal skje …" }),
  ).toHaveValue("Del ut prøven");
  await expect(
    page.getByRole("textbox", { name: "Beskjed til klassen …" }),
  ).toHaveValue("Husk gymtøy");
});

test("overlapping periods are refused with an honest error", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/?goto=planner:periods");

  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.locator("input[aria-label='Start']").nth(0).fill("08:30");
  await page.locator("input[aria-label='Slutt']").nth(0).fill("09:20");
  await page.locator("input[aria-label='Start']").nth(1).fill("09:10");
  await page.locator("input[aria-label='Slutt']").nth(1).fill("10:00");
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Øktene overlapper hverandre.")).toBeVisible();
});

// ── Granskingsfunn, R11 ────────────────────────────────────────────────────

test("the planner opens on a WEEKEND instead of locking (F-funn B1)", async ({
  page,
}) => {
  await installFixtures(page);
  // Saturday 2026-09-05 — the day a teacher actually plans the week.
  await page.clock.install({ time: new Date("2026-09-05T18:00:00") });
  await page.goto("/?goto=planner:periods");

  // Editing is available, not blocked.
  await expect(page.getByText("redigering er sperret")).toHaveCount(0);
  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  // Weekend days hold no weekly lesson, but notes work.
  await page.getByRole("button", { name: "I dag", exact: true }).click();
  await page.getByRole("button", { name: "Legg til beskjed" }).click();
  await page.getByPlaceholder("Beskjed til klassen …").fill("Rette prøver");
  await page.getByRole("button", { name: "Lagre beskjeder" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();
});

test("an unsaved note does NOT follow you to the next day (F-funn F2)", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/?goto=planner:periods");
  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await page.getByRole("button", { name: "I dag", exact: true }).click();

  // Type a note WITHOUT saving, then move to the next day.
  await page.getByRole("button", { name: "Legg til beskjed" }).click();
  await page.getByPlaceholder("Beskjed til klassen …").fill("Mandagsbeskjed");
  await page.getByRole("button", { name: "Neste dag" }).click();

  // Tuesday must be empty — the draft belonged to Monday.
  await expect(
    page.getByRole("textbox", { name: "Beskjed til klassen …" }),
  ).toHaveCount(0);
});

test("clicking another week cell does not carry the previous lesson (F-funn F1)", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/?goto=planner:periods");
  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await page.getByRole("button", { name: "Ukeplan" }).click();

  // Fill Monday.
  await page.locator("button:has-text('—')").first().click();
  await page
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await page.getByLabel("Fag").fill("Norsk");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();

  // Open Tuesday: the editor must be EMPTY, not pre-filled with Monday's.
  await page.locator("button:has-text('—')").first().click();
  await expect(page.getByLabel("Fag")).toHaveValue("");
  await expect(page.getByLabel("Klasse", { exact: true })).toHaveValue("");
});

test("an empty period name is refused, not silently deleted (F-funn F3)", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/?goto=planner:periods");
  await page.getByRole("button", { name: "Legg til økt" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  await page.locator("input[aria-label='Navn']").first().fill("");
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Alle økter må ha et navn.")).toBeVisible();
  // The period is still there.
  await expect(page.locator("input[aria-label='Navn']")).toHaveCount(1);
});
