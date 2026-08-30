import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The manage panel's update surface — statuses only; the real feed is the
// backend's (unit-tested URL logic + the suite Worker's contract tests).

async function openPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
}

test("a manual check reports up to date", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Du har nyeste versjon")).toBeVisible();
});

test("an available update offers the install button", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oppdater og start på nytt" }),
  ).toBeVisible();
});

test("a failed check is an honest status, not a crash", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "error", message: "offline" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText(/Fikk ikke sjekket nå/)).toBeVisible();
});

// ── The SILENT boot check finally has a receiver ────────────────────────────
//
// It has run since v0.1 and reported to a terminal no classroom has open. The
// backend now posts its answer to a mailbox (`update_pending`); the shell asks
// once, ~20 s in, and marks the version span. Nothing else: no modal, no
// toast, and it never pulls the chrome back up.

test("the boot check's answer marks the version line", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");

  // Before the read is due there is NOTHING — an answer that has not landed
  // must never render as an answer.
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();
  await expect(page.getByText("v9.9.9 klar")).toHaveCount(0);

  await page.clock.fastForward(20_000);
  const mark = page.getByText("v9.9.9 klar");
  await expect(mark).toBeVisible();
  // The tooltip names where to act on it. The mark itself does nothing.
  await expect(mark).toHaveAttribute(
    "title",
    "Versjon 9.9.9 er klar — hent den under «Administrer klasser».",
  );
});

test("no answer means no marker", async ({ page }) => {
  // Offline is the normal classroom state: the mailbox stays empty, and so
  // does the toolbar. Same for "up to date" — that is an answer the manage
  // panel gives on request, not something to put on a projector.
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "upToDate" };
  });
  await page.goto("/");
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();

  await page.clock.fastForward(20_000);
  await expect(page.getByText(/klar/)).toHaveCount(0);
});

test("the channel toggle flips and saves", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  const beta = page.getByRole("button", { name: "Beta", exact: true });
  const stable = page.getByRole("button", { name: "Stabil", exact: true });
  await expect(stable).toHaveAttribute("data-current", "true");
  await beta.click();
  await expect(beta).toHaveAttribute("data-current", "true");
  await expect(stable).not.toHaveAttribute("data-current", "true");
});
