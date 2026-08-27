// The browser tier's fixture seam. Everything a spec needs to boot the shell
// with a working (in-page) backend: settings, a class, and a layout store
// backed by localStorage — which is what lets a journey RELOAD the page and
// find its widgets again, exactly like the real SQLite store would.

import type { Page } from "@playwright/test";

/** Install the standard fixture set. Call BEFORE page.goto("/"). */
export async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const LAYOUT_KEY = "__e2e_layout__";
    (window as unknown as Record<string, unknown>).__SUNDAYSCREEN_FIXTURES__ = {
      settings_get: {
        language: "no",
        activeClassId: "e2e-class",
        snapEnabled: true,
        window: null,
      },
      settings_save: (args?: Record<string, unknown>) => args?.settings,
      app_info: { name: "SundayScreen", version: "0.0.0-e2e" },
      class_ensure_active: {
        id: "e2e-class",
        name: "7B",
        sortIndex: 0,
        createdAt: 1,
      },
      layout_load: () => JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "[]"),
      layout_save: (args?: Record<string, unknown>) => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(args?.widgets ?? []));
      },
    };
  });
}
