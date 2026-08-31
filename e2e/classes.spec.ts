import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures, settleEffects } from "./harness";

// F3's promise: each class has its own name list AND its own layout, and the
// switch is two clicks.

/** The toolbar slips away after four idle seconds — reach for it. */
async function wakeChrome(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.mouse.move(vp.width / 2, vp.height - 8);
}

/** Open «Klasser og navn» from the class switcher. */
async function openManage(page: Page): Promise<void> {
  await wakeChrome(page);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
}

/**
 * Make the FIRST `members_get` reject and every later one answer normally —
 * the failure shape a locked or half-mounted database has at boot. A
 * spec-local init script layered over the harness's own (they run in
 * install order), because a throwing fixture is exactly how the shim's seam
 * models a rejected command.
 */
async function failFirstMembersGet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const real = fixtures.members_get as (
      args?: Record<string, unknown>,
    ) => unknown;
    let failNext = true;
    fixtures.members_get = (args?: Record<string, unknown>) => {
      if (failNext) {
        failNext = false;
        throw new Error("members_get: database is locked");
      }
      return real(args);
    };
  });
}

test("each class keeps its own layout across switches", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  // Lay out a widget in 7B.
  await addWidget(page, "Tekst");
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(1);

  // Create 8A through the manage panel (auto-switches to it).
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
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

// ── The two clamps `members_set` owns (E2-4) ────────────────────────────────
//
// Both mirror a Rust unit test in members.rs by name
// (`overlong_names_are_capped_on_a_char_boundary`,
// `the_list_is_capped_at_members_max`) — but driving either one through the
// TEXTAREA alone would not prove the FIXTURE's own contract: ManagePanel's
// `parseNameList` (name-list-core.ts) already trims every paste to
// NAME_MAX_CHARS/MEMBERS_MAX client-side, so a too-long paste never reaches
// `members_set` un-clamped that way — the harness's own clamp (just added
// to mirror Rust "exactly") would be invisible behind the frontend's
// redundant one. Both tests below call `window.api.membersSet` directly —
// the same IPC surface any other caller uses — so the fixture is asked the
// question the UI itself never gets to ask.

test("a class can never hold more than the member limit, even asked for directly", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  const names = Array.from({ length: 1001 }, (_, i) => `Elev ${i}`);
  const saved = await page.evaluate(
    (ns) => window.api.membersSet("c1", ns).then((m) => m.length),
    names,
  );
  expect(saved).toBe(1000);

  // …and the READ side agrees: reload so the panel re-hydrates from what
  // actually landed, not from a draft that asked for 1001.
  await page.reload();
  await openManage(page);
  await expect(page.getByText("1000 navn")).toBeVisible();
  const lineCount = await page
    .getByPlaceholder(/Ett navn per linje/)
    .evaluate(
      (el) =>
        (el as HTMLTextAreaElement).value.split("\n").filter(Boolean).length,
    );
  expect(lineCount).toBe(1000);
});

test("a name longer than the character limit is stored truncated, and the panel shows the stored version", async ({
  page,
}) => {
  // "æ" — the same character the Rust test above uses, on purpose: a single
  // codepoint, so this proves the CAP LENGTH agrees with Rust. The
  // surrogate-pair (emoji) case is `charSlice`'s own concern, documented
  // once at its definition in harness.ts.
  await installFixtures(page);
  await page.goto("/");

  const long = "æ".repeat(150);
  const saved = await page.evaluate(
    (n) => window.api.membersSet("c1", [n]).then((m) => m.map((x) => x.name)),
    long,
  );
  const truncated = "æ".repeat(120);
  expect(saved).toEqual([truncated]);

  await page.reload();
  await openManage(page);
  // Re-seeded from the ANSWER, not the draft (ManagePanel.tsx's save
  // handler) — this is the one place a name cut to 120 characters becomes
  // visible at all.
  await expect(page.getByPlaceholder(/Ett navn per linje/)).toHaveValue(
    truncated,
  );
  await expect(page.getByText("1 navn")).toBeVisible();
});

test("a failed name-list read says so, and «Lagre navneliste» cannot wipe the class", async ({
  page,
}) => {
  // R4-spor 3.1: `members_get` was the last TOLERANT read sitting behind a
  // replace-all write. A failure answered `[]`, the panel seeded its textarea
  // from that emptiness, and one click on «Lagre navneliste» deleted every
  // pupil in the class — from a panel that had said nothing was wrong.
  await installFixtures(page, { memberNames: ["Kari", "Ola", "Per"] });
  await failFirstMembersGet(page);
  await page.goto("/");

  await openManage(page);
  await expect(page.getByText(/Navnelista kunne ikke leses/)).toBeVisible();
  // Nothing that WRITES the list is on screen: no draft, no save button.
  await expect(page.getByPlaceholder(/Ett navn per linje/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lagre navneliste" }),
  ).toHaveCount(0);

  // The way back — read again, in the panel, without restarting the app.
  await page.getByRole("button", { name: "Prøv å lese på nytt" }).click();
  await expect(page.getByPlaceholder(/Ett navn per linje/)).toHaveValue(
    "Kari\nOla\nPer",
  );
  await expect(page.getByText("3 navn")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lagre navneliste" }),
  ).toBeEnabled();

  // …and the stored class was never touched while the read was broken. Read
  // the fake store DIRECTLY: an assertion through the same IPC that just
  // failed would be measuring the wrong thing.
  const stored = await page.evaluate(
    () =>
      (
        (
          JSON.parse(localStorage.getItem("__e2e_db__") ?? "{}") as {
            members?: Record<string, unknown[]>;
          }
        ).members?.c1 ?? []
      ).length,
  );
  expect(stored).toBe(3);
});

test("deleting a class requires typing its name", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();

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

test("a settings write after a class switch does not revert the active class", async ({
  page,
}) => {
  // Gransking F9, funn S#1 (høy): a stale whole-object settings save used to
  // repoint the backend at the previous class — switch, touch any setting,
  // restart, wrong class.
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();

  // Any settings write — the update channel is the cheapest.
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toHaveText(
    /8A/,
  );
});

/**
 * Copied LOCALLY from chrome.spec.ts's own helper of the same name — this
 * file does not import from or edit chrome.spec.ts, so the copy is the
 * price of reusing the trick: `window_set_fullscreen` is a write with no
 * typed fallback, so outside Tauri it REJECTS and `toggleFullscreen` returns
 * without flipping the signal, which would keep this journey from ever
 * reaching `settingsSetWindow` at all.
 */
async function allowFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as Record<string, Record<string, unknown>>
    ).__SUNDAYSCREEN_FIXTURES__.window_set_fullscreen = () => undefined;
  });
}

test("toggling fullscreen persists the window without clobbering the language or update channel", async ({
  page,
}) => {
  // `settings_set_window`'s whole point (R4-spor 3.3): the real command
  // (commands/settings.rs::set_window_for) is a narrow read-modify-write,
  // not `settings_save`'s whole-blob clobber — a stale language/
  // updateChannel snapshot must never ride along on a window drag, resize,
  // or (as here) a fullscreen toggle. The harness's OWN fixture has to
  // mirror that narrowness, or this whole bug class is invisible at this
  // tier — it was, until this fixture existed at all (see harness.ts).
  await installFixtures(page);
  await allowFullscreen(page);
  await page.goto("/");

  // Seed a REAL settings write first — a below-minimum geometry, so the
  // clamp this test is really about has something to do — then reload so
  // the app's live `settings` signal actually reflects it. Seeding via
  // `evaluate` alone would leave `toggleFullscreen`'s in-memory read
  // (`settings.peek().window`) stale, since it is a signal, not a fresh IPC
  // read on every use.
  await page.evaluate(async () => {
    const current = await window.api.getSettings();
    await window.api.saveSettings({
      ...current,
      language: "en",
      updateChannel: "beta",
      window: { x: 20, y: 20, w: 100, h: 50, fullscreen: false },
    });
  });
  await page.reload();

  const enterFs = page.getByRole("button", {
    name: "Fullskjerm",
    exact: true,
  });
  await enterFs.click();
  await expect(
    page.getByRole("button", { name: "Avslutt fullskjerm", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const stored = await page.evaluate(() => window.api.getSettings());
  // The clamp landed (MIN_WINDOW_W/H, settings.rs) …
  expect(stored.window?.w).toBe(960);
  expect(stored.window?.h).toBe(600);
  // … and untouched is untouched: `settings_set_window` may not carry the
  // WHOLE blob the way `settings_save` does.
  expect(stored.language).toBe("en");
  expect(stored.updateChannel).toBe("beta");
});

test("9B never reads 8A's groups off the board", async ({ page }) => {
  // ADR-009: a screen is a LAYOUT and the class is the DATA. A library
  // screen follows the teacher across a class switch, so the names printed
  // on it have to follow too — before this guard, 7B's split stayed up in
  // front of 8A. The guard is a render check, not a config wipe: switching
  // back must bring the same groups home again.
  await installFixtures(page, { memberNames: ["Kari", "Ola", "Per", "Mona"] });
  await page.goto("/");

  // A second class, with its OWN names (so the empty state we assert is
  // "press Split", not "add names" — a weaker test would pass either way).
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  // «Legg til» auto-switches the panel to the new class, and the panel's
  // clear-draft-on-class-change effect is DEFERRED (same scheduler as the
  // agenda wipe in harness.ts::settleEffects) — typing inside that window
  // gets wiped along with the `edited` guard, and «Lagre navneliste» would
  // then replace-all an EMPTY list for 8A.
  await settleEffects(page);
  await page.getByPlaceholder(/Ett navn per linje/).fill("Emma\nJonas\nSara");
  await page.getByRole("button", { name: "Lagre navneliste" }).click();
  await page.getByRole("button", { name: "7B" }).click();
  await page.getByRole("button", { name: "Lukk" }).click();

  // A LIBRARY screen — the one kind that survives a class switch.
  await wakeChrome(page);
  await addWidget(page, "Grupper");
  await wakeChrome(page);
  await addWidget(page, "Navnetrekker");
  await wakeChrome(page);
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Gruppeøkt");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  const groups = page.locator('[data-widget-kind="groups"]');
  const display = page.locator(
    '[data-widget-kind="namepicker"] [data-display]',
  );
  await groups.getByRole("button", { name: "Del inn" }).click();
  await expect(groups.getByText("Kari", { exact: true })).toBeVisible();
  await page
    .locator('[data-widget-kind="namepicker"]')
    .getByRole("button", { name: "Trekk navn" })
    .click();
  await expect(display).toHaveText("Kari");

  // Switch class — the screen stays, the names must not.
  await wakeChrome(page);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "8A" }).click();
  await expect(groups.getByText("Kari", { exact: true })).toHaveCount(0);
  await expect(
    groups.getByText("Trykk «Del inn» for å lage grupper"),
  ).toBeVisible();
  await expect(display).toHaveText("Klar til å trekke");

  // Non-destructive: 7B's board is waiting where she left it.
  await wakeChrome(page);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await expect(groups.getByText("Kari", { exact: true })).toBeVisible();
  await expect(display).toHaveText("Kari");
});

// ── The dismiss backdrop ────────────────────────────────────────────────────
//
// A `transform` on an ancestor makes that ancestor the containing block for
// `position: fixed` DESCENDANTS too. The toolbar centred itself with
// `left: 50%; translateX(-50%)`, so every switcher's full-screen backdrop
// sized itself to the TOOLBAR — measured at 784×52 px at y=651 in a 1280×720
// window — and a click anywhere else on the screen hit nothing at all.
//
// So this measures the box before it clicks: an assertion that only clicks
// would pass again the day someone re-adds a transform and the backdrop
// happens to cover the click point.

/** The open switcher's dismiss layer — the only `Lukk` inside the toolbar. */
const backdrop = (page: Page) =>
  page.locator('footer button[aria-label="Lukk"]');

async function expectCoversViewport(page: Page): Promise<void> {
  const vp = page.viewportSize()!;
  const box = (await backdrop(page).boundingBox())!;
  expect({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
}

test("the class menu's backdrop is the whole viewport, and a far click closes it", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await wakeChrome(page);

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await expect(page.getByRole("menuitem", { name: "7B" })).toBeVisible();

  await expectCoversViewport(page);

  // The top-left corner is as far from a bottom-right menu as the screen gets.
  await page.mouse.click(60, 60);
  await expect(page.getByRole("menuitem", { name: "7B" })).toHaveCount(0);
});

test("the screen library's backdrop is the whole viewport, and a far click closes it", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await wakeChrome(page);

  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }),
  ).toBeVisible();

  await expectCoversViewport(page);

  await page.mouse.click(60, 60);
  await expect(
    page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }),
  ).toHaveCount(0);
});

/** Is the toolbar ONE row? It is when its box is exactly its padding plus
 *  its tallest child — the same measurement boot.spec makes. */
async function rowMetrics(page: Page) {
  return page.locator("footer").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      pad:
        parseFloat(cs.paddingTop) +
        parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) +
        parseFloat(cs.borderBottomWidth),
      tallest: Math.max(
        ...[...el.children].map((c) => c.getBoundingClientRect().height),
      ),
    };
  });
}

test("a long class name is capped instead of wrapping the toolbar", async ({
  page,
}) => {
  // The screen name got a ceiling the round the planner button arrived. The
  // class name is the OTHER free-text field on the same row and had none —
  // and a teacher names her classes freely.
  await page.setViewportSize({ width: 1024, height: 768 });
  await installFixtures(page);
  await page.goto("/");

  const NAME = "10B Naturfag og miljølære (gruppe 2)";
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill(NAME);
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await wakeChrome(page);

  // One row on the smallest projector we ship for.
  const capped = await rowMetrics(page);
  expect(capped.height, JSON.stringify(capped)).toBeLessThanOrEqual(
    capped.pad + capped.tallest + 1,
  );

  // The whole name is still the trigger's TEXT — only the pixels are clipped,
  // so `toContainText` assertions keep reading the real name and a screen
  // reader still hears it.
  const trigger = page.getByRole("button", { name: "Bytt klasse" });
  await expect(trigger).toContainText(NAME);
  const label = await trigger
    .locator("span")
    .first()
    .evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
  expect(label.clientWidth, JSON.stringify(label)).toBeLessThan(
    label.scrollWidth,
  );

  // And the ceiling is LOAD-BEARING at this name length rather than a belt
  // over nothing: lift it and the row measurably breaks in two. Without this
  // the test above would keep passing the day the ceiling is deleted and the
  // name happens to be short enough anyway.
  await page.addStyleTag({
    content:
      'footer button[aria-label="Bytt klasse"] span { max-width: none !important; }',
  });
  const uncapped = await rowMetrics(page);
  expect(uncapped.height, JSON.stringify(uncapped)).toBeGreaterThan(
    uncapped.pad + uncapped.tallest + 1,
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
