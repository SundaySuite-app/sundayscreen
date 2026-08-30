import { expect, test, type Page } from "@playwright/test";

import { installFixtures } from "./harness";

// «Flytt oppsettet»: export the whole setup to a file, and adopt one from
// another machine as NEW classes and screens.
//
// The native file dialog and the bytes on disk are Rust-side and invisible to
// Playwright by construction — that is exactly why the plugin is never
// exposed to the webview. What this tier owns is the frontend half: that the
// export asks for a sensibly named file, that a receipt only appears when
// something actually happened, and that each refusal gets its OWN sentence
// rather than the shell's generic «Noe gikk galt».

/** The toolbar slips away after four idle seconds — reach for it. */
async function wakeChrome(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.mouse.move(vp.width / 2, vp.height - 8);
}

async function openManage(page: Page): Promise<void> {
  await wakeChrome(page);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
}

/**
 * Replace the import fixture's answer for one journey. Layered over the
 * harness's own init script (they run in install order), which is how every
 * spec in this suite models a different backend answer.
 */
async function importAnswers(
  page: Page,
  receipt: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((r: Record<string, unknown>) => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.transfer_import = () => r;
  }, receipt);
}

test("exporting names the file after today and reports where it landed", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Eksporter oppsett …" }).click();

  // The receipt carries the path the backend actually wrote — a chip that
  // appeared without one would be a receipt for a file nobody saved.
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await expect(
    page.getByText(
      `Lagret: /Users/e2e/Documents/sundayscreen-oppsett-${stamp}.json`,
    ),
  ).toBeVisible();
});

test("a closed export dialog leaves no receipt and no error", async ({
  page,
}) => {
  await installFixtures(page);
  // `null` is the teacher closing the dialog. Not a failure — and not a
  // success either: silence is the only honest answer.
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.transfer_export = () => null;
  });
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Eksporter oppsett …" }).click();

  await expect(page.getByText("Lagret:")).toHaveCount(0);
  await expect(page.getByText("Noe gikk galt — prøv igjen.")).toHaveCount(0);
});

test("an import counts what came and says the week plan stayed behind", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Importer oppsett …" }).click();

  await expect(
    page.getByText("Importert: 2 klasser, 3 skjermer, 47 navn."),
  ).toBeVisible();
  // The half a teacher must not discover on Monday morning.
  await expect(
    page.getByText(
      "Timeoppsettet fantes fra før — ukeplanen ble ikke importert.",
    ),
  ).toBeVisible();
});

test("a file from a newer SundayScreen is refused whole, by version", async ({
  page,
}) => {
  await installFixtures(page);
  await importAnswers(page, {
    outcome: "tooNew",
    classes: 0,
    scenes: 0,
    members: 0,
    plannerImported: false,
    plannerSkipped: false,
    fileAppVersion: "9.9.9",
  });
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Importer oppsett …" }).click();

  // The version is IN the sentence: "update the app" is only actionable when
  // she can see which app made the file.
  await expect(
    page.getByText(
      "Fila er laget med SundayScreen 9.9.9. Oppdater appen for å lese den. Ingenting ble endret.",
    ),
  ).toBeVisible();
  // …and nothing that looks like a receipt.
  await expect(page.getByText("Importert:")).toHaveCount(0);
});

test("each refusal gets its own sentence, never the generic one", async ({
  page,
}) => {
  // The whole reason the refusals are OUTCOMES rather than errors: "this is
  // not a SundayScreen file" and "this file is too big" have different
  // remedies, and «Noe gikk galt — prøv igjen» is the remedy for neither.
  await installFixtures(page);
  await importAnswers(page, {
    outcome: "notOurFile",
    classes: 0,
    scenes: 0,
    members: 0,
    plannerImported: false,
    plannerSkipped: false,
    fileAppVersion: "",
  });
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Importer oppsett …" }).click();
  await expect(
    page.getByText(
      "Dette ser ikke ut som en SundayScreen-oppsettfil. Ingenting ble endret.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Noe gikk galt — prøv igjen.")).toHaveCount(0);
});

test("a cancelled import says nothing at all", async ({ page }) => {
  await installFixtures(page);
  await importAnswers(page, {
    outcome: "cancelled",
    classes: 0,
    scenes: 0,
    members: 0,
    plannerImported: false,
    plannerSkipped: false,
    fileAppVersion: "",
  });
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Importer oppsett …" }).click();

  await expect(page.getByText("Importert:")).toHaveCount(0);
  await expect(page.getByText("Ingenting ble endret.")).toHaveCount(0);
  await expect(page.getByText("Noe gikk galt — prøv igjen.")).toHaveCount(0);
});

test("the transfer section sits above «about», not beside the update button", async ({
  page,
}) => {
  // Placement is a safety property here: «Importer oppsett …» must not stand
  // next to «Oppdater og start på nytt».
  await installFixtures(page);
  await page.goto("/");
  await openManage(page);

  const panel = page.getByRole("region", { name: "Klasser og navn" });
  await expect(panel.getByText("Flytt oppsettet")).toBeVisible();

  const importBtn = await page
    .getByRole("button", { name: "Importer oppsett …" })
    .boundingBox();
  const updateBtn = await page
    .getByRole("button", { name: "Se etter oppdatering" })
    .boundingBox();
  expect(importBtn).not.toBeNull();
  expect(updateBtn).not.toBeNull();
  expect(importBtn!.y + importBtn!.height).toBeLessThanOrEqual(updateBtn!.y);
});
