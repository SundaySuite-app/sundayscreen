import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The first canvas journey: add a widget, see it, RELOAD, still see it. The
// fixture layout store is localStorage-backed (see harness.ts), so the
// reload exercises the same load→render path a real SQLite boot does.

test("an added text widget survives a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tekst");
  await expect(page.getByText("Skriv en beskjed …")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Skriv en beskjed …")).toBeVisible();
});

test("typing into the text widget persists across a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tekst");
  await page.getByText("Skriv en beskjed …").click();
  await page.locator("textarea").fill("Husk gymtøy i morgen!");
  // Blur commits with the immediate save.
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(page.getByText("Husk gymtøy i morgen!")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Husk gymtøy i morgen!")).toBeVisible();
});

test("a class switch keeps a GLOBAL screen but not a class default", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  // Somewhere to switch to.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();

  // A global library screen, built in 7B.
  await addWidget(page, "Trafikklys");
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Morgensamling");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Morgensamling",
  );

  // ADR-009: a screen is a LAYOUT and the class is the DATA, so a global
  // screen follows the teacher to 9B instead of dumping her on a default.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "8A" }).click();
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "8A",
  );
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Morgensamling",
  );
  await expect(page.locator('[data-widget-kind="trafficlight"]')).toHaveCount(
    1,
  );

  // From a CLASS DEFAULT, the switch must NOT drag 8A's own screen along.
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Standard — 8A" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Standard",
  );
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "7B",
  );
});

test("a removed widget stays removed after a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tekst");
  const widget = page.locator('[data-widget-kind="text"]');
  await expect(widget).toBeVisible();

  await widget.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(widget).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(0);
});
