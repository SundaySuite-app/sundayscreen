import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

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

/**
 * Same idea as `importAnswers`, but the answer arrives after `delayMs` — the
 * shape a real native file dialog + long transaction has (the teacher takes
 * a moment to find the file). Lets a journey observe the state DURING an
 * import, not just its outcome: both transfer buttons must stay dead for the
 * whole span, not just flash disabled for a tick.
 */
async function delayedImport(
  page: Page,
  receipt: Record<string, unknown>,
  delayMs: number,
): Promise<void> {
  await page.addInitScript(
    ({ r, ms }: { r: Record<string, unknown>; ms: number }) => {
      const fixtures = (window as unknown as Record<string, unknown>)
        .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
      fixtures.transfer_import = () =>
        new Promise((resolve) => setTimeout(() => resolve(r), ms));
    },
    { r: receipt, ms: delayMs },
  );
}

/**
 * Count calls to one fixture, without replacing its answer. Layered over
 * whatever the harness (or a spec-local override installed BEFORE this one)
 * already defined — the wrapped function still runs, so the receipt/refusal
 * it produces is untouched; only the call count is new.
 */
async function countCalls(page: Page, cmd: string): Promise<void> {
  await page.addInitScript((name: string) => {
    const w = window as unknown as Record<string, unknown>;
    w[`__e2e_calls_${name}__`] = 0;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const real = fixtures[name] as (...args: unknown[]) => unknown;
    fixtures[name] = (...args: unknown[]) => {
      w[`__e2e_calls_${name}__`] = (w[`__e2e_calls_${name}__`] as number) + 1;
      return real(...args);
    };
  }, cmd);
}

async function callCount(page: Page, cmd: string): Promise<number> {
  return page.evaluate(
    (name) =>
      ((window as unknown as Record<string, unknown>)[
        `__e2e_calls_${name}__`
      ] as number) ?? 0,
    cmd,
  );
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

test("an import that brings a week plan along says so — the OTHER branch of the same sentence", async ({
  page,
}) => {
  // E2-8: the default fixture answer only ever exercises `plannerSkipped`
  // (this machine already had a school day) — `plannerImported` had ZERO
  // coverage at this tier before this test, despite being the branch a
  // fresh install actually takes on its very first import.
  await installFixtures(page);
  await importAnswers(page, {
    outcome: "imported",
    classes: 1,
    scenes: 1,
    members: 12,
    plannerImported: true,
    plannerSkipped: false,
    fileAppVersion: "0.0.0-e2e",
  });
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Importer oppsett …" }).click();

  await expect(
    page.getByText("Timeoppsettet og ukeplanen kom med."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Timeoppsettet fantes fra før — ukeplanen ble ikke importert.",
    ),
  ).toHaveCount(0);
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

test("a landed import's receipt sits in the transfer section, in view, and the class menu grows", async ({
  page,
}) => {
  // E2-6/7: the receipt used to be provably correct and provably invisible
  // at once — right text, wrong place (F5's y=-110 bug, fixed for the ERROR
  // band in 164db51). This is the two halves neither older test checked:
  // the receipt's OWN element sits in the transfer section specifically
  // (`data-transfer="receipt"`, not just "this text exists somewhere"), it
  // is actually ON SCREEN, and the classes it claims to have added are not
  // just a sentence — they show up where a teacher would next look for them.
  await installFixtures(page);
  await page.goto("/");
  await openManage(page);

  await page.getByRole("button", { name: "Importer oppsett …" }).click();

  const receipt = page.locator('[data-transfer="receipt"]');
  await expect(receipt).toContainText("Importert:");
  await expect(receipt).toBeInViewport();

  // Fanger sletting av `loadClasses()` i `runImport`: uten den kaller
  // fikstur-mutasjonen ingen andre — «Importert klasse» ville aldri nådd
  // klassemenyen, mens kvitteringssetningen fortsatt sa «1 klasse» sant nok.
  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Importert klasse" }),
  ).toBeVisible();
});

test("the receipt survives closing and reopening the panel, and both transfer buttons stay dead for the whole import", async ({
  page,
}) => {
  // E2-17's own regression test: the busy flag and the receipt used to live
  // in the PANEL's `useState`, so closing it over a running import threw
  // both away — the buttons came back enabled over an import still in
  // flight, and nobody ever read whether it had landed. They live in
  // `state/transfer.ts` now, outside the component; this is what that
  // survives.
  await installFixtures(page);
  await delayedImport(
    page,
    {
      outcome: "imported",
      classes: 1,
      scenes: 1,
      members: 5,
      plannerImported: false,
      plannerSkipped: false,
      fileAppVersion: "0.0.0-e2e",
    },
    300,
  );
  await page.goto("/");
  await openManage(page);

  const exportBtn = page.getByRole("button", { name: "Eksporter oppsett …" });
  const importBtn = page.getByRole("button", { name: "Importer oppsett …" });
  await importBtn.click();

  // Mid-flight: the native dialog is "open" for as long as the teacher
  // takes, and neither button may start a second one on top of the first —
  // that includes EXPORT, which shares the one `transferBusy` flag.
  await expect(exportBtn).toBeDisabled();
  await expect(importBtn).toBeDisabled();

  await expect(page.locator('[data-transfer="receipt"]')).toBeVisible();
  await expect(exportBtn).toBeEnabled();
  await expect(importBtn).toBeEnabled();

  await page.getByRole("button", { name: "Lukk" }).click();
  await openManage(page);
  await expect(page.locator('[data-transfer="receipt"]')).toContainText(
    "Importert:",
  );
});

test("an unsaved board blocks the export, and transfer_export is never called", async ({
  page,
}) => {
  // The export's own R4-spor 3.1 sibling: a board that failed to save must
  // not be exported as if it had — the file would describe a screen the
  // teacher is not looking at (E1-L11), and nothing would say so.
  await installFixtures(page);
  await countCalls(page, "transfer_export");
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.layout_save = () => {
      throw new Error("layout_save: disk is full");
    };
  });
  await page.goto("/");
  await addWidget(page, "Tekst");

  // Wait for the failed save to actually land — the shell's sticky chip is
  // the only externally visible proof `saveError` flipped BEFORE Export is
  // asked to look at it.
  await expect(page.getByText("Klarte ikke å lagre tavla")).toBeVisible();

  await openManage(page);
  await page.getByRole("button", { name: "Eksporter oppsett …" }).click();

  await expect(page.getByText("Tavla kunne ikke lagres")).toBeVisible();
  await expect(page.getByText("Lagret:")).toHaveCount(0);
  expect(await callCount(page, "transfer_export")).toBe(0);
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
