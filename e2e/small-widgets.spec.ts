import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// «Frist» and «Sjekkliste»: configure → show → reload → exactly restored.

test("the deadline counts days to a date and survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/");

  await addWidget(page, "Frist");
  const deadline = page.locator('[data-widget-kind="deadline"]');
  await expect(deadline).toContainText("Velg dato");

  // Pick a date 5 days out (16:00 school-day deadline → 5 days, some hours).
  await deadline.hover();
  await deadline.getByLabel("Velg dato").fill("2026-09-05");
  await expect(deadline).toContainText("dager igjen");
  await expect(deadline.locator('[data-urgency="calm"]')).toBeVisible();

  // Name it via the title line. The click may race the save's re-render
  // (node swap mid-dispatch) — retry until the editor actually opened.
  await expect(async () => {
    await deadline
      .getByRole("button", { name: "Hva er fristen?" })
      .click({ timeout: 1000 });
    await expect(
      page.getByRole("textbox", { name: "Hva er fristen?" }),
    ).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await page
    .getByRole("textbox", { name: "Hva er fristen?" })
    .fill("Innlevering");
  await page.keyboard.press("Enter");
  await expect(deadline).toContainText("Innlevering");

  await page.reload();
  const after = page.locator('[data-widget-kind="deadline"]');
  await expect(after).toContainText("Innlevering");
  await expect(after).toContainText("dager igjen");
});

test("the deadline turns critical inside 24 hours and honest past due", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/");

  await addWidget(page, "Frist");
  const deadline = page.locator('[data-widget-kind="deadline"]');
  await deadline.hover();
  // Today 16:00 → inside the critical band.
  await deadline.getByLabel("Velg dato").fill("2026-08-31");
  await expect(deadline.locator('[data-urgency="critical"]')).toBeVisible();

  // Two days later the honest state is «passert», not negative numbers.
  await page.clock.fastForward(2 * 24 * 3_600_000);
  await expect(deadline).toContainText("Fristen er passert");
});

test("checklist items check off and the state survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Sjekkliste");
  const list = page.locator('[data-widget-kind="checklist"]');
  await expect(list).toContainText("Ingen punkter ennå");

  await list.getByLabel("Nytt punkt …").fill("Matpakke-lapp");
  await list.getByLabel("Nytt punkt …").press("Enter");
  await list.getByLabel("Nytt punkt …").fill("Innlevering");
  await list.getByLabel("Nytt punkt …").press("Enter");
  await expect(list).toContainText("Matpakke-lapp");
  await expect(list).toContainText("Innlevering");

  await list.getByRole("button", { name: "Merk gjort" }).first().click();
  await expect(
    list.getByRole("button", { name: "Merk gjort" }).first(),
  ).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  const after = page.locator('[data-widget-kind="checklist"]');
  await expect(after).toContainText("Matpakke-lapp");
  await expect(
    after.getByRole("button", { name: "Merk gjort" }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});
