import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The manage panel's update surface — statuses only; the real feed is the
// backend's (unit-tested URL logic + the suite Worker's contract tests).

async function openPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
}

test("a manual check reports up to date", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Du har nyeste versjon")).toBeVisible();
});

test("an available update offers the install button", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oppdater og start på nytt" }),
  ).toBeVisible();
});

test("a failed check is an honest status, not a crash", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "error", message: "offline" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText(/Fikk ikke sjekket nå/)).toBeVisible();
});

test("the channel toggle flips and saves", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  const beta = page.getByRole("button", { name: "Beta", exact: true });
  const stable = page.getByRole("button", { name: "Stabil", exact: true });
  await expect(stable).toHaveAttribute("data-current", "true");
  await beta.click();
  await expect(beta).toHaveAttribute("data-current", "true");
  await expect(stable).not.toHaveAttribute("data-current", "true");
});
