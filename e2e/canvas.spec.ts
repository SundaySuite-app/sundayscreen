import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The first canvas journey: add a widget, see it, RELOAD, still see it. The
// fixture layout store is localStorage-backed (see harness.ts), so the
// reload exercises the same load→render path a real SQLite boot does.

test("an added text widget survives a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Tekst" }).click();
  await expect(page.getByText("Skriv en beskjed …")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Skriv en beskjed …")).toBeVisible();
});

test("typing into the text widget persists across a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Tekst" }).click();
  await page.getByText("Skriv en beskjed …").click();
  await page.locator("textarea").fill("Husk gymtøy i morgen!");
  // Blur commits with the immediate save.
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(page.getByText("Husk gymtøy i morgen!")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Husk gymtøy i morgen!")).toBeVisible();
});

test("a removed widget stays removed after a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Tekst" }).click();
  const widget = page.locator('[data-widget-kind="text"]');
  await expect(widget).toBeVisible();

  await widget.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(widget).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(0);
});
