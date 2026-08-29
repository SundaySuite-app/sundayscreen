import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The chrome: the toolbar slips away after four idle seconds, comes back
// when the pointer reaches for it, and Escape peels one layer at a time.
//
// Every auto-hide journey puts a widget on the board first: an EMPTY board
// holds the chrome open by design (4.1), so idling on one proves nothing.

test("the toolbar auto-hides on idle and the handle brings it back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

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
  await addWidget(page, "Tekst");

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
  // A widget on the board, so the pin under test is the MENU's and not the
  // empty board's.
  await addWidget(page, "Tekst");
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

test("an empty board keeps the toolbar up and points the way", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  // After the splash: a title, one pointing line, one door.
  await expect(page.getByText("Tavla er tom")).toBeVisible();
  await expect(
    page.getByText("Verktøylinja ligger langs nederste kant."),
  ).toBeVisible();

  // The way forward does NOT slide off the screen four seconds later.
  await page.clock.fastForward(10_000);
  await expect(page.locator("footer")).not.toHaveAttribute(
    "data-hidden",
    "true",
  );

  // The one door opens the same menu the toolbar's button does…
  await page.getByRole("button", { name: "Velg et verktøy" }).click();
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Klokke" }).click();

  // …and once there is something on the board, the empty state is gone and
  // the toolbar resumes its ordinary auto-hide.
  await expect(page.getByText("Tavla er tom")).toHaveCount(0);
  await page.clock.fastForward(6_000);
  await expect(page.locator("footer")).toHaveAttribute("data-hidden", "true");
});

test("deleting the LAST widget mid-lesson brings the chrome back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  await page.clock.fastForward(6_000);
  await expect(page.locator("footer")).toHaveAttribute("data-hidden", "true");

  // Wake the chrome the way a teacher does, then remove the only card.
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  const widget = page.locator('[data-widget-kind="text"]');
  await widget.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(widget).toHaveCount(0);

  // An empty board holds the chrome open — the teacher is not left with a
  // wordless rectangle and no controls.
  await page.clock.fastForward(10_000);
  await expect(page.locator("footer")).not.toHaveAttribute(
    "data-hidden",
    "true",
  );
  await expect(page.getByText("Tavla er tom")).toBeVisible();
});

test("the empty state does not swallow the surface's deselect", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  // A click on the bare surface deselects — the empty layer is
  // pointer-events:none, so nothing changes here when it is NOT showing…
  const widget = page.locator('[data-widget-kind="text"]');
  await widget.click();
  await expect(widget).toHaveAttribute("data-selected", "true");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(widget).not.toHaveAttribute("data-selected", "true");
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
