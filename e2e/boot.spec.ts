import { expect, test } from "@playwright/test";

// The browser tier's first journey: the shell boots with NO backend. The
// fixture seam answers the two boot commands, so the status line lands on
// "Klar" — proof the whole boot chain (shim → settings → i18n → render)
// holds together outside Tauri.

test("boots with fixtures and lands ready", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__SUNDAYSCREEN_FIXTURES__ = {
      settings_get: {
        language: "no",
        activeClassId: null,
        snapEnabled: true,
        window: null,
      },
      app_info: { name: "SundayScreen", version: "0.0.0-e2e" },
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SundayScreen" }),
  ).toBeVisible();
  await expect(page.locator("[data-status]")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();
});

// Without fixtures every wired command legitimately rejects — the shell must
// still render (never a white screen), and the status line must be HONEST
// about the failed settings read rather than pretending defaults were chosen.

test("boots without fixtures into the honest degraded state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SundayScreen" }),
  ).toBeVisible();
  await expect(page.locator("[data-status]")).toHaveAttribute(
    "data-status",
    "error",
  );
});
