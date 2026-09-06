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

// ── Deleting a screen with a write still in flight (R7-funn M7) ─────────────
//
// `deleteScene` used to go straight to `scene_delete`. The last keystrokes on
// the board were still on their way — the persister is debounced, and a
// forced flush is a promise, not an instant — so `layout_save` landed naming a
// scene the backend had just dropped. `commands/layout.rs` answers NotFound,
// and the shell's sticky «Klarte ikke å lagre tavla» chip appeared for a board
// the teacher had deliberately deleted, and stayed until the next successful
// save.
//
// The e2e fixture could not see it either: it recreated the layout key for a
// deleted scene, so the tier was green about the wrong semantics. It now
// refuses, exactly like Rust (harness.ts, `layout_save`).

test("deleting the screen mid-save does not blame the teacher for it", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tekst");
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Midlertidig");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Midlertidig",
  );

  // Hold every save from here on, and TIMESTAMP it. The real store is a
  // database on a school laptop; the fixture answers in a microtask, which is
  // precisely why the race was invisible to this tier. `original` is called
  // when the delay expires, so it sees the world AS IT IS THEN — a deleted
  // scene included.
  //
  // The delay is long on purpose. A shorter one turns this into a test about
  // how fast the machine is: with four seconds of margin the write is
  // guaranteed to be in flight when «Slett skjermen» is pressed, and the log
  // below is what PROVES it was rather than assuming it.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const original = fixtures.layout_save as (
      args?: Record<string, unknown>,
    ) => unknown;
    const log: { event: string; at: number }[] = [];
    w.__a2SaveLog = log;
    fixtures.layout_save = (args?: Record<string, unknown>) => {
      log.push({ event: "start", at: Date.now() });
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          log.push({ event: "end", at: Date.now() });
          try {
            resolve(original(args));
          } catch (e) {
            reject(e);
          }
        }, 4000);
      });
    };
  });

  // Type on the board. Opening the screen menu blurs the field, which forces
  // the write — so by the time «Slett skjermen» is pressed it is in flight,
  // against a scene that is about to stop existing.
  await page.getByRole("button", { name: "Skriv en beskjed …" }).click();
  await page.locator("textarea").fill("Prøve i morgen");

  await openSceneMenu(page);
  await page.getByRole("button", { name: "Slett", exact: true }).click();
  await page.waitForTimeout(500); // CONFIRM_ARM_MS
  const pressedAt = await page.evaluate(() => Date.now());
  await page.getByRole("button", { name: "Slett skjermen" }).click();

  // The delete lands: the board falls back to the class default.
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Standard",
  );

  // THE RACE ACTUALLY HAPPENED. Without this the test would pass vacuously on
  // a slow machine — one where the held write happened to land before the
  // teacher got to the confirmation, and no scene was ever saved to after it
  // was deleted. Started before the press, finished after it: the write was
  // in flight across the delete, which is the whole scenario.
  const log = await page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__a2SaveLog as {
        event: string;
        at: number;
      }[],
  );
  const started = log.filter((e) => e.event === "start").at(-1);
  const ended = log.filter((e) => e.event === "end").at(-1);
  expect(started, "no held layout_save at all").toBeDefined();
  expect(ended, "the held layout_save never resolved").toBeDefined();
  expect(started!.at).toBeLessThan(pressedAt);
  expect(ended!.at).toBeGreaterThan(pressedAt);

  // …and the write landed anyway, without a word of blame. This is where the
  // chip used to appear and stay.
  await expect(
    page.getByText("Klarte ikke å lagre tavla — siste endringer kan gå tapt."),
  ).toHaveCount(0);

  // The machine-readable half: no refused `layout_save` in the failure ring
  // either. The chip is one sticky sentence with several possible causes; the
  // ring names the command (and it can only see this one at all because
  // `layoutSave` goes through the shim's `write()` — R7-funn skjøt #6).
  const failed = await page.evaluate(() =>
    window.api.getRecentIpcFailures().map((f) => f.cmd),
  );
  expect(failed).not.toContain("layout_save");
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

// ── The screen a lesson still points at ─────────────────────────────────────
//
// «Slett skjermen» used to be the same sentence whether the screen was on
// three lessons in the week plan or on none at all. `scene_usage` answers the
// question the confirmation was missing — and the way it answers is the whole
// point: it REJECTS rather than returning a typed zero, because «Slett
// skjermen» and «Brukes av 0 timer — slett likevel?» are different sentences
// and only one of them is a claim. The count only ever ADDS to the wording;
// zero and «we could not find out» read alike, and neither says anything the
// app has not earned.

/** One row of the screen library, scoped by the screen it names. The rows
 *  carry no attribute of their own (CSS-module class names are hashed, and
 *  differently in a build), so the menu item inside is what identifies one. */
function sceneRow(page: import("@playwright/test").Page, name: string) {
  return page
    .locator('[role="menu"] > div')
    .filter({ has: page.getByRole("menuitem", { name, exact: true }) });
}

test("the delete confirmation says how many lessons still point at the screen", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  // Two library screens: one the week plan will point at, one nothing uses.
  for (const name of ["Skriveøkt", "Ubrukt"]) {
    await openSceneMenu(page);
    await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
    await page.getByPlaceholder("Navn på skjermen …").fill(name);
    await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  }

  // Monday × Time 1 is planned onto «Skriveøkt».
  await page.goto("/?goto=planner:periods");
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("region", { name: "Planlegger" });
  await panel.getByRole("button", { name: "Legg til time" }).click();
  await panel.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(panel.getByText("Lagret")).toBeVisible();
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await panel.locator("button:has-text('—')").first().click();
  await panel
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await panel.getByLabel("Fag").fill("Norsk");
  await panel
    .getByLabel("Skjerm", { exact: true })
    .selectOption({ label: "Skriveøkt" });
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await panel.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);

  // The screen the plan needs: the confirmation names the cost of pressing it.
  await openSceneMenu(page);
  const used = sceneRow(page, "Skriveøkt");
  await used.getByRole("button", { name: "Slett", exact: true }).click();
  await expect(
    used.getByRole("button", { name: "Brukes av 1 time — slett likevel?" }),
  ).toBeVisible();

  // The screen nothing uses: the SAME wording it has always had. The wait is
  // the arming delay the confirmation needs anyway (CONFIRM_ARM_MS), and it
  // is what makes this assertion about the answer rather than about the
  // moment before it arrived.
  const unused = sceneRow(page, "Ubrukt");
  await unused.getByRole("button", { name: "Slett", exact: true }).click();
  await page.waitForTimeout(500);
  await expect(
    unused.getByRole("button", { name: "Slett skjermen", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Brukes av")).toHaveCount(0);

  // …and it really is the confirmation, not a look-alike. «Ubrukt» is the
  // active screen, so deleting it lands on the class default and closes the
  // menu with it — the library is opened again to read the answer.
  await unused.getByRole("button", { name: "Slett skjermen" }).click();
  await openSceneMenu(page);
  await expect(page.getByRole("menuitem", { name: "Ubrukt" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Skriveøkt" })).toBeVisible();
});
