import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The timer under a MOCKED clock (Playwright's page.clock fakes Date and
// every timer), so the journeys are deterministic and instant.

test("a countdown runs, warns near zero, and finishes", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await expect(timer.getByText("05:00")).toBeVisible();

  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("04:00")).toBeVisible();
  await expect(timer.locator('[data-tone="calm"]')).toHaveCount(1);

  // Inside the last minute the tone shifts to warn.
  await page.clock.fastForward(3 * 60_000 + 30_000);
  await expect(timer.getByText("00:30")).toBeVisible();
  await expect(timer.locator('[data-tone="warn"]')).toHaveCount(1);

  await page.clock.fastForward(31_000);
  await expect(timer.getByText("00:00")).toBeVisible();
  await expect(timer.locator('[data-tone="done"]')).toHaveCount(1);
});

test("pause freezes the derived remainder; resume continues", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(90_000);
  await timer.getByRole("button", { name: "Pause" }).click();
  await expect(timer.getByText("03:30")).toBeVisible();

  // Paused: the wall clock keeps moving, the timer does not.
  await page.clock.fastForward(10 * 60_000);
  await expect(timer.getByText("03:30")).toBeVisible();

  await timer.getByRole("button", { name: "Fortsett" }).click();
  await page.clock.fastForward(30_000);
  await expect(timer.getByText("03:00")).toBeVisible();
});

test("the stopwatch counts up and banks across pauses", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();
  await timer.getByRole("button", { name: "Stoppeklokke" }).click();
  await expect(timer.getByText("00:00")).toBeVisible();

  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(65_000);
  await expect(timer.getByText("01:05")).toBeVisible();

  await timer.getByRole("button", { name: "Pause" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("01:05")).toBeVisible();

  await timer.getByRole("button", { name: "Fortsett" }).click();
  await page.clock.fastForward(55_000);
  await expect(timer.getByText("02:00")).toBeVisible();
});

test("duration buttons adjust the config and it persists", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await expect(timer.getByText("07:00")).toBeVisible();

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="timer"]').getByText("07:00"),
  ).toBeVisible();
});

test("the clock shows the mocked time, digital and analog", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:37:00") });
  await page.goto("/");

  await addWidget(page, "Klokke");
  const clock = page.locator('[data-widget-kind="clock"]');
  await expect(clock.getByText("10:37")).toBeVisible();

  await clock.hover();
  await clock.getByRole("button", { name: "Analog" }).click();
  await expect(clock.getByRole("img")).toBeVisible();
  await expect(clock.getByText("10:37")).toHaveCount(0);

  await clock.getByRole("button", { name: "Dato" }).click();
  await expect(clock.getByText(/august/)).toBeVisible();
});
