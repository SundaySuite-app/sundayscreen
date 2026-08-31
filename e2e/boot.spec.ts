import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

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

// The planner is the app's biggest feature and it used to live behind an
// unlabelled icon. It now carries its name — and the name must NOT be
// duplicated into an aria-label, which would override the visible text for a
// screen reader and could drift from it at the next translation.

test("the planner button carries its name, not just an icon", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  const planner = page.getByRole("button", { name: "Planlegger", exact: true });
  await expect(planner).toBeVisible();
  await expect(planner).toHaveText("Planlegger");
  await expect(planner).not.toHaveAttribute("aria-label", /./);
  // The tooltip stays.
  await expect(planner).toHaveAttribute("title", "Planlegger");

  await planner.click();
  await expect(page.getByRole("button", { name: "Ukeplan" })).toBeVisible();
});

// The toolbar centres itself in a flex dock now (the old `left: 50%` +
// transform made it the containing block for every fixed-position backdrop
// inside it), but it is still ONE row that free text can overflow: a word on
// the planner button costs ~86 px, and it DID wrap at 1024×768 before the
// switcher labels got their ellipsis. Measured with long names in both.

test("the toolbar stays ONE row at 1024×768 with long names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installFixtures(page);
  await page.goto("/");

  // A long class name …
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("Innføringsklassen");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();

  // … and a screen name well past the trigger's ceiling, which is the one
  // free-text field a teacher can make arbitrarily long.
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page
    .getByPlaceholder("Navn på skjermen …")
    .fill("Skriveøkt med stillelesing og skriverammer");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  // Wake the chrome: it hides on idle, and `visibility: hidden` takes it out
  // of the a11y tree entirely.
  await page.mouse.move(512, 760);
  const footer = page.locator("footer");
  await expect(footer).toBeVisible();

  const m = await footer.evaluate((el) => {
    const cs = getComputedStyle(el);
    const kids = [...el.children];
    return {
      height: el.getBoundingClientRect().height,
      width: el.getBoundingClientRect().width,
      // Border included: `getBoundingClientRect` measures the border box.
      pad:
        parseFloat(cs.paddingTop) +
        parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) +
        parseFloat(cs.borderBottomWidth),
      tallest: Math.max(...kids.map((c) => c.getBoundingClientRect().height)),
      contentWidth: kids.reduce(
        (n, c) => n + c.getBoundingClientRect().width,
        0,
      ),
    };
  });
  // One row means the box is exactly its padding plus its tallest child.
  expect(m.height, JSON.stringify(m)).toBeLessThanOrEqual(
    m.pad + m.tallest + 1,
  );

  // And it is inside the screen, both edges.
  const box = (await footer.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
});

// The database did not open. `setup` no longer returns `Err` for that (an app
// that will not start has no surface to explain itself on): it succeeds with a
// BootFault in managed state, the shell runs degraded, and the chip says which
// of the four things happened AND where the untouched file is.
//
// EXACT text, deliberately: chipText() is priority-ordered, and a substring
// assertion would pass just as happily on the hydrate-error sentence below it.

const DB_PATH =
  "/Users/laerer/Library/Application Support/screen/sundayscreen.sqlite";

async function withBootFault(
  page: import("@playwright/test").Page,
  kind: string,
  schemaVersion: number | null = null,
): Promise<void> {
  await installFixtures(page);
  await page.addInitScript(
    ([k, v, p]) => {
      const fixtures = (window as unknown as Record<string, unknown>)
        .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
      fixtures.boot_fault = { kind: k, dbPath: p, schemaVersion: v };
    },
    [kind, schemaVersion, DB_PATH] as const,
  );
  await page.goto("/");
}

test("a downgrade says so, names no version number, and points at the file", async ({
  page,
}) => {
  // `schemaVersion: 5` is the empirically proven downgrade (v0.3 wrote
  // migration 0005). It stays OUT of the sentence: 5 is a schema version, and
  // "install version 5 or newer" would send a teacher looking for a
  // SundayScreen that does not exist.
  await withBootFault(page, "databaseTooNew", 5);

  const chip = page.locator('[data-status="error"]');
  await expect(chip).toHaveText(
    "Denne databasen er laget av en nyere SundayScreen. Installer nyeste " +
      "versjon fra nedlastingssiden — ingenting blir lagret før det er " +
      `gjort. Fila er urørt: ${DB_PATH}.`,
  );
  await expect(chip).not.toContainText("5");
  // …and the app is USABLE: the surface that carries the sentence is the
  // whole point of not refusing to start.
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();
});

test("a stopped schema update is its own sentence", async ({ page }) => {
  await withBootFault(page, "schemaUpdateStopped", 5);
  await expect(page.locator('[data-status="error"]')).toHaveText(
    "Databaseoppdateringen stoppet. Dette er en feil i appen, ikke noe du " +
      `gjorde — nyeste versjon kan ha rettet den. Fila er urørt: ${DB_PATH}.`,
  );
});

test("a quarantined database says the app started empty — and where to look", async ({
  page,
}) => {
  // Until R4 this was a `warn!` in a terminal no classroom has open, while
  // the teacher stared at a board with none of her classes on it.
  await withBootFault(page, "startedEmpty");
  await expect(page.locator('[data-status="error"]')).toHaveText(
    "Navnene dine er ikke borte. Databasen var ødelagt, så SundayScreen " +
      "startet tom. Den gamle fila (.corrupt-…) og sikkerhetskopien " +
      `sundayscreen.backup-1.sqlite ligger ved siden av ${DB_PATH} — begge kan brukes.`,
  );
});

test("after a quarantine the chip stops claiming the file is untouched", async ({
  page,
}) => {
  // The quarantine renamed the file, so «fila er urørt» — the promise every
  // other sentence here ends in — would be false. This is the one kind that
  // says «ingenting er slettet» instead, which is still true.
  await withBootFault(page, "rescueFailed");
  const chip = page.locator('[data-status="error"]');
  await expect(chip).toContainText("Ingenting er slettet");
  await expect(chip).not.toContainText("urørt");
});

test("«startet tom» steps aside for a failure that is happening NOW", async ({
  page,
}) => {
  // The chip is ONE slot, and it was priority-ordered with every boot fault
  // above everything else — which is right for four of the five and wrong for
  // this one (R4-funn F6). `startedEmpty` says the app could not read the old
  // file and started on a fresh one: the app WORKS after it, and the sentence
  // is about something that already finished. Ranked first it owned the slot
  // for the rest of the day, so a save that stopped landing at 10:40 had
  // nowhere to say so — the one message a teacher can still act on, hidden
  // behind the one she cannot.
  await withBootFault(page, "startedEmpty");
  const chip = page.locator('[data-status="error"]');
  await expect(chip).toContainText("SundayScreen startet tom");

  // Now the store stops accepting writes, the way a disk filling up or a
  // second copy of the app taking the lock does.
  await page.evaluate(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.layout_save = () => {
      throw new Error("layout_save: database is locked");
    };
  });
  await addWidget(page, "Klokke");

  // The chip is the LIVE failure. Exact text, not a substring: the point is
  // which of the two sentences won the slot.
  await expect(chip).toHaveText(
    "Klarte ikke å lagre tavla — siste endringer kan gå tapt.",
  );
  await expect(chip).toHaveCount(1);
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
