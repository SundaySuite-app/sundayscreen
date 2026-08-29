import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The scene library: save what is on screen as a named scene, switch
// between the class default and library scenes, share a scene across
// classes, and land safely when the active scene is deleted.

async function openSceneMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
}

test("save-as creates a library scene and edits land in the copy", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tekst");
  await expect(page.getByText("Skriv en beskjed …")).toBeVisible();

  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Skriveøkt");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  // The switcher now shows the copy — we are editing the library scene.
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Skriveøkt",
  );

  // A widget added NOW belongs to the copy, not the class default.
  await addWidget(page, "Klokke");
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Standard — 7B" }).click();
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(0);
  await expect(page.getByText("Skriv en beskjed …")).toBeVisible();

  // Back on the scene, the clock is there — and survives a reload.
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Skriveøkt" }).click();
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);
});

test("a library scene follows you across classes", async ({ page }) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await page.goto("/");

  await addWidget(page, "Trafikklys");
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Prøve");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  // Create a second class.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();

  // 8A starts on ITS default (empty), but the library scene is available.
  await expect(page.locator('[data-widget-kind="trafficlight"]')).toHaveCount(
    0,
  );
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Prøve" }).click();
  await expect(page.locator('[data-widget-kind="trafficlight"]')).toHaveCount(
    1,
  );
  // Same scene, other class: the class switcher still says 8A.
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toContainText(
    "8A",
  );
});

test("deleting the active scene lands on the class default", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Midlertidig");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Midlertidig",
  );

  await openSceneMenu(page);
  await page.getByRole("button", { name: "Slett", exact: true }).click();
  // The confirmation is inert for CONFIRM_ARM_MS (400 ms) so a double-click
  // cannot walk through it — a deliberate second click waits.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Slett skjermen" }).click();

  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Standard",
  );
});

test("a renamed scene keeps its layout", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Terning");
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Mattestart");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  await openSceneMenu(page);
  await page.getByRole("button", { name: "Gi nytt navn" }).click();
  const input = page.getByRole("textbox", { name: "Gi nytt navn" });
  await input.fill("Matteslutt");
  await input.press("Enter");

  await expect(
    page.getByRole("menuitem", { name: "Matteslutt" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-widget-kind="dice"]')).toHaveCount(1);
});

// ── The library explains itself, and does not discard or delete by accident ──

test("an empty library says what a saved screen is FOR", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  // The trigger names what it is a default OF.
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Standard skjerm",
  );

  await openSceneMenu(page);
  await expect(
    page.getByText("Lagre tavla slik den står nå", { exact: false }),
  ).toBeVisible();
  // …as prose, NOT as a menu choice that does nothing.
  await expect(
    page.getByRole("menuitem", { name: "Lagre tavla", exact: false }),
  ).toHaveCount(0);
});

test("the name field survives a blur and commits from the tick", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Terning");
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  const field = page.getByPlaceholder("Navn på skjermen …");
  await field.fill("Mattestart");

  // Blur used to throw the name away without a word. Tab moves focus to the
  // tick button — the draft must still be there.
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("Mattestart");

  await page.getByRole("button", { name: "Lagre navnet" }).click();
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Mattestart",
  );
  await expect(page.locator('[data-widget-kind="dice"]')).toHaveCount(1);
});

test("a rename survives a blur too", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Førsteutkast");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  await openSceneMenu(page);
  await page.getByRole("button", { name: "Gi nytt navn" }).click();
  const input = page.getByRole("textbox", { name: "Gi nytt navn" });
  await input.fill("Andreutkast");
  await page.keyboard.press("Tab");
  await expect(input).toHaveValue("Andreutkast");
  await page.getByRole("button", { name: "Lagre navnet" }).click();

  await expect(
    page.getByRole("menuitem", { name: "Andreutkast" }),
  ).toBeVisible();
});

test("a double-click on Slett does NOT delete the screen", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Dyrebar");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  await openSceneMenu(page);
  // «Slett skjermen» renders exactly where the trash (and pencil) stood, so
  // the second half of a double-click lands on the confirmation itself.
  const trash = page.getByRole("button", { name: "Slett", exact: true });
  const box = (await trash.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  // Armed, but nothing was deleted — and the confirm is still there to be
  // clicked deliberately (no disabled→enabled flicker on a projector).
  const confirm = page.getByRole("button", { name: "Slett skjermen" });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Dyrebar" })).toBeVisible();

  await page.waitForTimeout(500);
  await confirm.click();
  await expect(page.getByRole("menuitem", { name: "Dyrebar" })).toHaveCount(0);
});
