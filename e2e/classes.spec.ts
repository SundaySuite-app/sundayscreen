import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// F3's promise: each class has its own name list AND its own layout, and the
// switch is two clicks.

test("each class keeps its own layout across switches", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  // Lay out a widget in 7B.
  await page.getByRole("button", { name: "Tekst" }).click();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(1);

  // Create 8A through the manage panel (auto-switches to it).
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til" }).click();
  await page.getByRole("button", { name: "Lukk" }).click();

  // 8A's surface is empty; the switcher shows 8A.
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toHaveText(
    /8A/,
  );

  // Two clicks back to 7B — the widget is waiting.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(1);
});

test("a pasted name list saves, counts, and survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();

  const area = page.getByPlaceholder(/Ett navn per linje/);
  await area.fill("  Kari  \n\nOla\nPer\n");
  await expect(page.getByText("3 navn")).toBeVisible();
  await page.getByRole("button", { name: "Lagre navneliste" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await expect(page.getByPlaceholder(/Ett navn per linje/)).toHaveValue(
    "Kari\nOla\nPer",
  );
});

test("deleting a class requires typing its name", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til" }).click();

  // Ask to delete 8A: the confirm button stays disabled until the name is
  // typed exactly.
  const row = page.locator("li", { hasText: "8A" });
  await row.getByRole("button", { name: "Slett" }).click();
  const confirm = page.getByRole("button", { name: "Slett klassen" });
  await expect(confirm).toBeDisabled();
  await page.getByPlaceholder(/for å slette/).fill("8B");
  await expect(confirm).toBeDisabled();
  await page.getByPlaceholder(/for å slette/).fill("8A");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.locator("li", { hasText: "8A" })).toHaveCount(0);
  // The switcher fell back to the remaining class.
  await page.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toHaveText(
    /7B/,
  );
});

test("renaming a class updates the switcher", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByRole("button", { name: "Gi nytt navn" }).click();
  const input = page.getByRole("textbox", { name: "Gi nytt navn" });
  await input.fill("7C");
  await input.press("Enter");
  await page.getByRole("button", { name: "Lukk" }).click();

  await expect(page.getByRole("button", { name: "Bytt klasse" })).toHaveText(
    /7C/,
  );
});
