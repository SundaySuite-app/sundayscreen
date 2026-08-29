import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The browser tier's first journey: the shell boots with NO backend. The
// fixture seam answers the boot commands — proof the whole chain (shim →
// settings → i18n → class bootstrap → render) holds together outside Tauri.

test("boots with fixtures into the working shell", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  // The toolbar is up, with the add menu and the active class.
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();
  await expect(page.getByText("7B")).toBeVisible();
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();
  // No hydrate-error chip — the settings read succeeded.
  await expect(page.locator('[data-status="error"]')).toHaveCount(0);
});

// Without fixtures every wired command legitimately rejects — the shell must
// still render (never a white screen), and it must be HONEST about the
// failed settings read rather than pretending defaults were chosen.

test("boots without fixtures into the honest degraded state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();
  await expect(page.locator('[data-status="error"]')).toBeVisible();
});
