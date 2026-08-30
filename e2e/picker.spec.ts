import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The randomness widgets. The harness draw is deterministic (first undrawn
// wins), so the round semantics are assertable; the REAL randomness is the
// backend's property-tested core.

const NAMES = ["Kari", "Ola", "Per", "Mona"];

/** The toolbar slips away after four idle seconds — reach for it. */
async function wakeChrome(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.mouse.move(vp.width / 2, vp.height - 8);
}

/** Open «Hvem er her i dag?» from the class menu. */
async function openAttendance(page: Page): Promise<void> {
  await wakeChrome(page);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Hvem er her i dag?" }).click();
}

const attendancePanel = (page: Page) =>
  page.getByRole("region", { name: "Hvem er her i dag?" });

test("no-repeat draws everyone before starting a new round", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: NAMES });
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  const drawBtn = picker.getByRole("button", { name: "Trekk navn" });
  const display = picker.locator("[data-display]");

  const seen: string[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    await drawBtn.click();
    await expect(drawBtn).toBeEnabled();
    seen.push((await display.innerText()).trim());
  }
  expect([...seen].sort()).toEqual([...NAMES].sort());

  // The round is dry — the counter said 0, and the next draw announces the
  // new round.
  await expect(picker.getByText(/neste trekk starter ny runde/)).toBeVisible();
  await drawBtn.click();
  await expect(drawBtn).toBeEnabled();
  await expect(picker.getByText("Ny runde!")).toBeVisible();
});

test("the round counter counts down and the drawn name persists", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: NAMES });
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  await picker.getByRole("button", { name: "Trekk navn" }).click();
  await expect(picker.getByText("3 igjen i runden")).toBeVisible();
  await expect(picker.locator("[data-display]")).toHaveText("Kari");

  // The projector remembers the pupil across a restart.
  await page.reload();
  await expect(
    page.locator('[data-widget-kind="namepicker"] [data-display]'),
  ).toHaveText("Kari");
});

test("a pupil marked away today is never drawn or dealt a group", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: NAMES });
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  await addWidget(page, "Grupper");

  // The attendance PANEL is a later stage; the backend seam exists now, so
  // drive it directly — this is the assertion that stops the present-filter
  // (and the `today` pass-through) from rotting before the UI lands.
  await page.evaluate(async () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const members = await window.api.membersGet("c1");
    const kari = members.find((m) => m.name === "Kari");
    if (!kari) throw new Error("Kari should be seeded");
    await window.api.attendanceSet("c1", kari.id, true, today);
  });

  const picker = page.locator('[data-widget-kind="namepicker"]');
  const drawBtn = picker.getByRole("button", { name: "Trekk navn" });
  const display = picker.locator("[data-display]");
  for (let i = 0; i < NAMES.length + 2; i++) {
    await drawBtn.click();
    await expect(drawBtn).toBeEnabled();
    expect((await display.innerText()).trim()).not.toBe("Kari");
  }

  const groups = page.locator('[data-widget-kind="groups"]');
  await groups.getByRole("button", { name: "Del inn" }).click();
  await expect(groups.locator("li")).toHaveCount(NAMES.length - 1);
  await expect(groups.getByText("Kari", { exact: true })).toHaveCount(0);
});

test("a draw that fails says so, and no name lands on the board", async ({
  page,
}) => {
  // R4-spor 3.2: `picker_draw` was a bare invoke whose rejection ended in
  // `console.warn` — a dead button in front of a class, invisible to the
  // failure ring too. GRANSKING-v1 filed that (U#7) as fixed; it was not.
  await installFixtures(page, { memberNames: NAMES });
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.picker_draw = () => {
      throw new Error("picker_draw: database is locked");
    };
  });
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  const drawBtn = picker.getByRole("button", { name: "Trekk navn" });
  const display = picker.locator("[data-display]");

  await drawBtn.click();
  await expect(page.getByText(/Noe gikk galt/)).toBeVisible();
  // The button comes back, and the board shows no pupil that was never drawn.
  await expect(drawBtn).toBeEnabled();
  await expect(display).toHaveText("Klar til å trekke");

  // …and the failure is REMEMBERED, not just spoken: the ring is what the
  // diagnose surface reads when a whole afternoon has been going wrong.
  const seen = await page.evaluate(() =>
    window.api.getRecentIpcFailures().map((f) => f.cmd),
  );
  expect(seen).toContain("picker_draw");

  // Nothing was persisted either — a restart still shows an undrawn board.
  await page.reload();
  await expect(
    page.locator('[data-widget-kind="namepicker"] [data-display]'),
  ).toHaveText("Klar til å trekke");
});

test("without names the picker is disabled and says why", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  await expect(
    picker.getByRole("button", { name: "Trekk navn" }),
  ).toBeDisabled();
  await expect(picker.getByText("Legg inn navn i klassen først")).toBeVisible();
});

// ── «Legg inn navn» is a DOOR ───────────────────────────────────────────────

test("«Legg inn navn» opens the name list, from both widgets", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  await page
    .locator('[data-widget-kind="namepicker"]')
    .getByRole("button", { name: "Legg inn navn i klassen først" })
    .click();
  await expect(
    page.getByRole("button", { name: "Lagre navneliste" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await wakeChrome(page);
  await addWidget(page, "Grupper");
  await page
    .locator('[data-widget-kind="groups"]')
    .getByRole("button", { name: "Legg inn navn i klassen først" })
    .click();
  await expect(
    page.getByRole("button", { name: "Lagre navneliste" }),
  ).toBeVisible();
});

// ── Who is here today ───────────────────────────────────────────────────────

test("the attendance panel keeps a pupil out of the draw and the groups", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: NAMES });
  await page.goto("/");

  await addWidget(page, "Navnetrekker");
  await addWidget(page, "Grupper");

  // On an ORDINARY day the count line is zero pixels — this is a filter that
  // must never be invisible, and never noise either.
  await expect(page.getByText(/til stede/)).toHaveCount(0);

  await openAttendance(page);
  const panel = attendancePanel(page);
  await panel.getByRole("button", { name: "Kari" }).click();
  // Every click is one write; the panel renders what the backend answered.
  await expect(panel.getByText("3 av 4 til stede")).toBeVisible();
  await panel.getByRole("button", { name: "Lukk" }).click();

  // …and now BOTH widgets say so, on the board.
  const picker = page.locator('[data-widget-kind="namepicker"]');
  const groups = page.locator('[data-widget-kind="groups"]');
  await expect(picker.getByText("3 av 4 til stede")).toBeVisible();
  await expect(groups.getByText("3 av 4 til stede")).toBeVisible();

  const drawBtn = picker.getByRole("button", { name: "Trekk navn" });
  const display = picker.locator("[data-display]");
  for (let i = 0; i < NAMES.length + 2; i++) {
    await drawBtn.click();
    await expect(drawBtn).toBeEnabled();
    expect((await display.innerText()).trim()).not.toBe("Kari");
  }

  await groups.getByRole("button", { name: "Del inn" }).click();
  await expect(groups.locator("li")).toHaveCount(NAMES.length - 1);
  await expect(groups.getByText("Kari", { exact: true })).toHaveCount(0);
});

test("«alle er borte» is its own answer, not «legg inn navn»", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await page.goto("/");

  // Entrance (a): the widget's own hover row. A freshly added widget is
  // selected, so the row is up.
  await addWidget(page, "Navnetrekker");
  const picker = page.locator('[data-widget-kind="namepicker"]');
  await picker.getByRole("button", { name: "Fravær" }).click();

  const panel = attendancePanel(page);
  await panel.getByRole("button", { name: "Kari" }).click();
  await panel.getByRole("button", { name: "Ola" }).click();
  await expect(panel.getByText("0 av 2 til stede")).toBeVisible();
  // Escape peels THIS layer and nothing else.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await expect(picker.getByText("Alle er borte i dag")).toBeVisible();
  await expect(picker.getByText("Legg inn navn i klassen først")).toHaveCount(
    0,
  );
  await expect(
    picker.getByRole("button", { name: "Trekk navn" }),
  ).toBeDisabled();

  // Marking her back present re-opens the draw — no save button anywhere.
  await picker.getByRole("button", { name: "Fravær" }).click();
  await attendancePanel(page).getByRole("button", { name: "Kari" }).click();
  await page.keyboard.press("Escape");
  await expect(
    picker.getByRole("button", { name: "Trekk navn" }),
  ).toBeEnabled();
  await expect(picker.getByText("1 av 2 til stede")).toBeVisible();
});

test("groups split evenly and the result survives a reload", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["A", "B", "C", "D", "E"] });
  await page.goto("/");

  await addWidget(page, "Grupper");
  const groups = page.locator('[data-widget-kind="groups"]');
  await groups.getByRole("button", { name: "Del inn" }).click();

  await expect(groups.getByText("Gruppe 1")).toBeVisible();
  await expect(groups.getByText("Gruppe 2")).toBeVisible();
  await expect(groups.locator("li")).toHaveCount(5);

  await page.reload();
  const restored = page.locator('[data-widget-kind="groups"]');
  await expect(restored.getByText("Gruppe 1")).toBeVisible();
  await expect(restored.locator("li")).toHaveCount(5);
});

test("three groups of five members differ by at most one", async ({ page }) => {
  await installFixtures(page, { memberNames: ["A", "B", "C", "D", "E"] });
  await page.goto("/");

  await addWidget(page, "Grupper");
  const groups = page.locator('[data-widget-kind="groups"]');
  await groups.getByRole("button", { name: "Øk tallet" }).click();
  await groups.getByRole("button", { name: "Del inn" }).click();

  await expect(groups.getByText("Gruppe 3")).toBeVisible();
  const sizes = await groups
    .locator("section")
    .evaluateAll((els) => els.map((el) => el.querySelectorAll("li").length));
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(5);
});

test("the dice roll, sum, and survive a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Terning");
  const dice = page.locator('[data-widget-kind="dice"]');
  const rollBtn = dice.getByRole("button", { name: "Kast" });

  await rollBtn.click();
  await expect(rollBtn).toBeEnabled();
  const value = await rollBtn.getAttribute("data-value");
  expect(Number(value)).toBeGreaterThanOrEqual(1);
  expect(Number(value)).toBeLessThanOrEqual(6);

  // Two more dice, then a fresh roll shows a sum.
  await dice.hover();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await rollBtn.click();
  await expect(rollBtn).toBeEnabled();
  await expect(dice.getByText(/Sum: \d+/)).toBeVisible();
  const triple = await rollBtn.getAttribute("data-value");
  expect(triple!.split("-")).toHaveLength(3);

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="dice"] [data-value]'),
  ).toHaveAttribute("data-value", triple!);
});
