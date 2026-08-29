import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// F3's promise: each class has its own name list AND its own layout, and the
// switch is two clicks.

/** The toolbar slips away after four idle seconds — reach for it. */
async function wakeChrome(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.mouse.move(vp.width / 2, vp.height - 8);
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
