import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures, settleEffects } from "./harness";

// The F9 robustness journeys: the failure shapes a classroom actually
// produces — a projector swap mid-lesson, a whole school year pasted into
// the name list, a pupil hammering the draw button.

test("a resolution change mid-session reflows the layout proportionally", async ({
  page,
}) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await addWidget(page, "Tekst");
  const widget = page.locator('[data-widget-kind="text"]');
  const before = (await widget.boundingBox())!;

  // The projector swap: 4:3 → 16:9 full HD, live.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(async () => {
    const after = (await widget.boundingBox())!;
    // Proportional per axis: x scales by 1920/1024, y by 1080/768.
    expect(after.x / 1920).toBeCloseTo(before.x / 1024, 2);
    expect(after.y / 1080).toBeCloseTo(before.y / 768, 2);
    // …and fully on-surface.
    expect(after.x + after.width).toBeLessThanOrEqual(1921);
    expect(after.y + after.height).toBeLessThanOrEqual(1081);
  }).toPass();

  // Shrinking back cannot strand it off-screen either.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(async () => {
    const back = (await widget.boundingBox())!;
    expect(back.x).toBeGreaterThanOrEqual(-1);
    expect(back.x + back.width).toBeLessThanOrEqual(1025);
  }).toPass();
});

test("a 500-name paste counts, saves, and still draws", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  const names = Array.from({ length: 500 }, (_, i) => `Elev ${i + 1}`).join(
    "\n",
  );
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder(/Ett navn per linje/).fill(names);
  await expect(page.getByText("500 navn")).toBeVisible();
  await page.getByRole("button", { name: "Lagre navneliste" }).click();
  await expect(page.getByText("Lagret", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lukk" }).click();

  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  await picker.getByRole("button", { name: "Trekk navn" }).click();
  await expect(picker.getByText("499 igjen i runden")).toBeVisible();
});

// ── The names have not landed YET ───────────────────────────────────────────
//
// A slow read is a THIRD state, distinct from a finished one and a failed
// one, and the manage panel's textarea has to behave in all three: seed when
// the list finally lands on an untouched draft, never seed over typing, and
// never offer to save a draft nobody read (R4-spor 3.1).

/** Hold `members_get` open until the page releases it. */
async function deferMembersGet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const real = fixtures.members_get as (
      args?: Record<string, unknown>,
    ) => unknown;
    w.__releaseMembers = () => {};
    fixtures.members_get = (args?: Record<string, unknown>) =>
      new Promise((resolve) => {
        w.__releaseMembers = () => resolve(real(args));
      });
  });
}

/** Let the held read answer. */
async function releaseMembers(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __releaseMembers: () => void }).__releaseMembers(),
  );
}

async function openManage(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.mouse.move(vp.width / 2, vp.height - 8);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
}

test("names that land while the panel is open fill an untouched textarea", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await deferMembersGet(page);
  await page.goto("/");

  await openManage(page);
  const area = page.getByPlaceholder(/Ett navn per linje/);
  const save = page.getByRole("button", { name: "Lagre navneliste" });
  // Nothing has been read yet: an empty draft that cannot be saved over the
  // class.
  await expect(area).toHaveValue("");
  await expect(save).toBeDisabled();

  await releaseMembers(page);
  await expect(area).toHaveValue("Kari\nOla");
  await expect(save).toBeEnabled();
});

test("a name typed before the list lands is never overwritten by the seed", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await deferMembersGet(page);
  await page.goto("/");

  await openManage(page);
  // The panel's clear-draft effect fires once on MOUNT, deferred (see
  // harness.ts::settleEffects) — a fill inside that window is wiped along
  // with the `edited` guard, and this test's own seed would then win: the
  // exact opposite of what it proves. Let the mount settle; the deferred
  // read is still being held, so the race under test is untouched.
  await settleEffects(page);
  const area = page.getByPlaceholder(/Ett navn per linje/);
  await area.fill("Nils");

  // The read lands AFTER the first keystroke: the seed must lose. A draft
  // that jumped back to the stored list under the teacher's hands would be
  // the same class of bug as the wipe, from the other side.
  await releaseMembers(page);
  await expect(page.getByText("1 navn")).toBeVisible();
  await expect(area).toHaveValue("Nils");
  await expect(
    page.getByRole("button", { name: "Lagre navneliste" }),
  ).toBeEnabled();
});

test("hammering the draw button cannot double-draw", async ({ page }) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola", "Per", "Mona"] });
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  const drawBtn = picker.getByRole("button", { name: "Trekk navn" });

  // Ten frantic force-clicks — the button disables while spinning, and
  // force bypasses actionability, which is exactly the storm we want.
  for (let i = 0; i < 10; i++) {
    await drawBtn.click({ force: true }).catch(() => {});
  }
  await expect(drawBtn).toBeEnabled();
  // Exactly ONE draw happened: three of four remain in the round.
  await expect(picker.getByText("3 igjen i runden")).toBeVisible();
});

// ── The board itself would not save ─────────────────────────────────────────
//
// The two sentences that make promise 4 VISIBLE on the board («en skriving
// som feiler REJECTER, aldri fabrikkert suksess») had never been rendered by
// a test — the guard and the flag were unit-tested in `state/layout.test.ts`,
// but nothing proved the shell actually says either one out loud.
//
// EXACT text on both, deliberately: `chipText()` in Shell.tsx is
// priority-ordered (boot fault → hydrate error → load failed → save failed),
// so a `data-status="error"` assertion — or a substring — would pass just as
// happily on the wrong sentence. Which is also why only ONE fixture key is
// overwritten below: break `settings_get` too and `boot.hydrateError` wins
// the chip, and the journey would assert a sentence it never caused.

const LOAD_FAILED =
  "Fikk ikke lest tavla fra lagringen — endringer lagres ikke før appen har startet på nytt.";
const SAVE_FAILED = "Klarte ikke å lagre tavla — siste endringer kan gå tapt.";

/** Wake the auto-hiding toolbar: `visibility: hidden` takes it out of the
 *  a11y tree entirely, and a non-empty board no longer holds it open. */
async function wakeChrome(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.mouse.move(vp.width / 2, vp.height - 8);
}

test("a board that could not be READ says so, and is never written back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    w.__layoutSaves = 0;
    fixtures.layout_load = () => {
      throw new Error("database is locked");
    };
    const real = fixtures.layout_save as (
      args?: Record<string, unknown>,
    ) => unknown;
    fixtures.layout_save = (args?: Record<string, unknown>) => {
      w.__layoutSaves = (w.__layoutSaves as number) + 1;
      return real(args);
    };
  });
  await page.goto("/");

  const chip = page.locator('[data-status="error"]');
  await expect(chip).toHaveText(LOAD_FAILED);

  // What is actually true of the degraded board: it still WORKS. The card
  // appears, the teacher can use it for this lesson — the store simply
  // refuses to mirror a board it never read (F9-funn S#4: a replace-all
  // against an unread layout is a one-edit wipe of the stored one).
  await addWidget(page, "Tekst");
  await expect(page.locator('[data-widget-kind="text"]')).toBeVisible();

  // The edit called `saveNow()`. Nothing reached the store.
  expect(
    await page.evaluate(
      () => (window as unknown as { __layoutSaves: number }).__layoutSaves,
    ),
  ).toBe(0);

  // And the chip still names the CAUSE. A refusal that surfaced as
  // «Klarte ikke å lagre tavla» would send the teacher looking for a full
  // disk instead of restarting the app, which is the actual way out.
  await expect(chip).toHaveText(LOAD_FAILED);
});

test("a board that could not be SAVED says so, until one save lands", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const real = fixtures.layout_save as (
      args?: Record<string, unknown>,
    ) => unknown;
    // The switch lives in the same init script: the load must SUCCEED first
    // (otherwise the guard refuses the write and this chip never appears),
    // and the journey has to be able to mend the disk mid-lesson.
    w.__saveBroken = true;
    w.__mendSave = () => {
      w.__saveBroken = false;
    };
    fixtures.layout_save = (args?: Record<string, unknown>) => {
      if (w.__saveBroken) throw new Error("disk full");
      return real(args);
    };
  });
  await page.goto("/");

  const chip = page.locator('[data-status="error"]');
  // The read landed, so nothing is wrong yet.
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();
  await expect(chip).toHaveCount(0);

  await addWidget(page, "Tekst");
  await expect(chip).toHaveText(SAVE_FAILED);

  // The disk comes back. The chip is STICKY — it stays until a write
  // actually lands, and then it must go, or the teacher learns to ignore it.
  await page.evaluate(() =>
    (window as unknown as { __mendSave: () => void }).__mendSave(),
  );
  await expect(chip).toHaveText(SAVE_FAILED);

  await wakeChrome(page);
  await addWidget(page, "Klokke");
  await expect(chip).toHaveCount(0);
});
