import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The chrome: the toolbar slips away after four idle seconds, comes back
// when the pointer reaches for it, and Escape peels one layer at a time.

test("the toolbar auto-hides on idle and the handle brings it back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  const toolbar = page.locator("footer");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");

  await page.clock.fastForward(6_000);
  await expect(toolbar).toHaveAttribute("data-hidden", "true");

  // The handle pill is the visual cue — and REACHING for it is the gesture:
  // the pointer entering the bottom zone reveals before any click could land
  // (clicking it would race its own unmount, by design).
  await expect(
    page.getByRole("button", { name: "Vis verktøylinja" }),
  ).toBeVisible();
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");
  await expect(
    page.getByRole("button", { name: "Vis verktøylinja" }),
  ).toHaveCount(0);
});

test("reaching for the bottom edge wakes the toolbar", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  const toolbar = page.locator("footer");
  await page.clock.fastForward(6_000);
  await expect(toolbar).toHaveAttribute("data-hidden", "true");

  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 5);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");
});

test("an open manage panel pins the chrome and Escape closes layers in order", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();

  // Pinned: idle time passes, the toolbar stays.
  await page.clock.fastForward(10_000);
  await expect(page.locator("footer")).not.toHaveAttribute(
    "data-hidden",
    "true",
  );

  // Escape closes the panel (one layer)…
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Lukk" })).toHaveCount(0);

  // …and with the class menu open, Escape closes THAT first.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Administrer klasser …" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "Administrer klasser …" }),
  ).toHaveCount(0);
});

test("Escape in a text field only leaves the field", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  const area = page.getByPlaceholder(/Ett navn per linje/);
  await area.click();
  await page.keyboard.press("Escape");

  // The panel is still open — only the focus left the field.
  await expect(page.getByRole("button", { name: "Lukk" })).toBeVisible();
  await expect(area).not.toBeFocused();
});

test("an open add menu pins the chrome and Escape closes it first", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  const toolbar = page.locator("footer");
  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toBeVisible();

  // Idle does NOT hide the toolbar while its own menu is open.
  await page.clock.fastForward(6_000);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");

  // Escape peels the add menu (innermost) — the toolbar is still up.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toHaveCount(0);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");
});

test("adding from the menu closes it and lands the widget", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await page.getByRole("menuitem", { name: "Trafikklys" }).click();
  await expect(page.getByRole("menuitem", { name: "Trafikklys" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Rødt lys — stille" }),
  ).toBeVisible();
});

test("the toolbar stays ONE row at 1280×800 with every control", async ({
  page,
}) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  // Brand, add menu, planner, scene switcher, class switcher, fullscreen and
  // the version all fit on one line — the whole point of the R2 redesign.
  // (An absolutely positioned box at left:50% only gets the right half of
  // the screen as available width, which used to force a wrap.)
  const box = await page.locator("footer").boundingBox();
  expect(box!.height).toBeLessThan(70);
  await expect(page.getByRole("button", { name: "Planlegger" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toBeVisible();
});
