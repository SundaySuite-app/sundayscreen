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

test("a preset sets the length in ONE click, and it persists", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await expect(timer.getByText("05:00")).toBeVisible();

  // «Dere får tjue minutter» used to be fifteen clicks in front of a
  // waiting class.
  await timer.hover();
  await timer.getByRole("button", { name: "Sett til 20 minutter" }).click();
  await expect(timer.getByText("20:00")).toBeVisible();
  await expect(
    timer.getByRole("button", { name: "Sett til 20 minutter" }),
  ).toHaveAttribute("data-current", "true");

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="timer"]').getByText("20:00"),
  ).toBeVisible();
});

test("«two more minutes» moves the finish line, and the amber stops lying", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Start" }).click();

  // Inside the last minute: the class can see it is nearly over.
  await page.clock.fastForward(4 * 60_000 + 30_000);
  await expect(timer.getByText("00:30")).toBeVisible();
  await expect(timer.locator('[data-tone="warn"]')).toHaveCount(1);

  // The extension is possible AT ALL now — before, the only way to give two
  // more minutes was to reset the countdown the class was watching.
  await timer.hover();
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await expect(timer.getByText("02:30")).toBeVisible();
  // Free with it: the colour stops claiming there is a hurry.
  await expect(timer.locator('[data-tone="calm"]')).toHaveCount(1);

  await timer.getByRole("button", { name: "Ett minutt mindre" }).click();
  await expect(timer.getByText("01:30")).toBeVisible();

  // The countdown was never restarted — it keeps running from where it was.
  await page.clock.fastForward(30_000);
  await expect(timer.getByText("01:00")).toBeVisible();

  // And the two groups never stand together: the presets are gone while the
  // clock runs, the ± is gone while it is idle.
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(0);
  await timer.getByRole("button", { name: "Nullstill" }).click();
  await timer.hover();
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(5);
  await expect(
    timer.getByRole("button", { name: "Ett minutt til" }),
  ).toHaveCount(0);
});

test("at its SMALLEST the timer keeps the five presets on one line", async ({
  page,
}) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();

  // Drag the SE handle far past the minimum; `minSizePx` (260×180) stops it.
  const hb = (await timer
    .getByRole("button", { name: "Endre størrelse" })
    .boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 500, hb.y - 500, { steps: 10 });
  await page.mouse.up();

  const box = (await timer.boundingBox())!;
  expect(Math.round(box.width)).toBe(260);
  expect(Math.round(box.height)).toBe(180);

  // The row WRAPS at this width — it is allowed to. What it must not do is
  // break up in the middle of the digits, which is the reason there are five
  // pills and not six.
  await timer.hover();
  const tops = await timer
    .getByRole("button", { name: /^Sett til/ })
    .evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
  expect(tops).toHaveLength(5);
  expect(new Set(tops).size).toBe(1);
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
