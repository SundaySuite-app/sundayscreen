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
  await page.getByRole("button", { name: "Slett" }).click();
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
