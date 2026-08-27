import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The two signal widgets: a click IS the state change, and the state is
// config — the board says the same thing after a restart.

test("the traffic light switches lamps and survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Trafikklys" }).click();
  const light = page.locator('[data-widget-kind="trafficlight"]');
  // Red is the honest classroom default.
  await expect(light.locator("[data-active]")).toHaveAttribute(
    "data-active",
    "red",
  );

  await light.getByRole("button", { name: "Grønt lys — samarbeid" }).click();
  await expect(light.locator("[data-active]")).toHaveAttribute(
    "data-active",
    "green",
  );

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="trafficlight"] [data-active]'),
  ).toHaveAttribute("data-active", "green");
});

test("the work symbol changes mode and survives a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Arbeidssymbol" }).click();
  const symbol = page.locator('[data-widget-kind="worksymbol"]');
  await expect(symbol.getByText("Stille arbeid")).toBeVisible();

  await symbol.hover();
  await symbol.getByRole("button", { name: "Rekk opp hånda" }).click();
  await expect(symbol.getByText("Rekk opp hånda")).toBeVisible();

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="worksymbol"]').getByText("Rekk opp hånda"),
  ).toBeVisible();
});
