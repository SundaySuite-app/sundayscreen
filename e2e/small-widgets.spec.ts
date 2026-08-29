import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// «Frist», «Sjekkliste» and «Tekst»: configure → show → reload → exactly
// restored.

test("the deadline counts days to a date and survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/");

  await addWidget(page, "Frist");
  const deadline = page.locator('[data-widget-kind="deadline"]');
  await expect(deadline).toContainText("Velg dato");

  // Pick a date 5 days out (16:00 school-day deadline → 5 days, some hours).
  await deadline.hover();
  await deadline.getByLabel("Velg dato").fill("2026-09-05");
  await expect(deadline).toContainText("dager igjen");
  await expect(deadline.locator('[data-urgency="calm"]')).toBeVisible();

  // Name it via the title line. The click may race the save's re-render
  // (node swap mid-dispatch) — retry until the editor actually opened.
  await expect(async () => {
    await deadline
      .getByRole("button", { name: "Hva er fristen?" })
      .click({ timeout: 1000 });
    await expect(
      page.getByRole("textbox", { name: "Hva er fristen?" }),
    ).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await page
    .getByRole("textbox", { name: "Hva er fristen?" })
    .fill("Innlevering");
  await page.keyboard.press("Enter");
  await expect(deadline).toContainText("Innlevering");

  await page.reload();
  const after = page.locator('[data-widget-kind="deadline"]');
  await expect(after).toContainText("Innlevering");
  await expect(after).toContainText("dager igjen");
});

test("the deadline turns critical inside 24 hours and honest past due", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/");

  await addWidget(page, "Frist");
  const deadline = page.locator('[data-widget-kind="deadline"]');
  await deadline.hover();
  // Today 16:00 → inside the critical band.
  await deadline.getByLabel("Velg dato").fill("2026-08-31");
  await expect(deadline.locator('[data-urgency="critical"]')).toBeVisible();

  // Two days later the honest state is «passert», not negative numbers.
  await page.clock.fastForward(2 * 24 * 3_600_000);
  await expect(deadline).toContainText("Fristen er passert");
});

test("checklist items check off and the state survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Sjekkliste");
  const list = page.locator('[data-widget-kind="checklist"]');
  await expect(list).toContainText("Ingen punkter ennå");

  await list.getByLabel("Nytt punkt …").fill("Matpakke-lapp");
  await list.getByLabel("Nytt punkt …").press("Enter");
  await list.getByLabel("Nytt punkt …").fill("Innlevering");
  await list.getByLabel("Nytt punkt …").press("Enter");
  await expect(list).toContainText("Matpakke-lapp");
  await expect(list).toContainText("Innlevering");

  await list.getByRole("button", { name: "Merk gjort" }).first().click();
  await expect(
    list.getByRole("button", { name: "Merk gjort" }).first(),
  ).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  const after = page.locator('[data-widget-kind="checklist"]');
  await expect(after).toContainText("Matpakke-lapp");
  await expect(
    after.getByRole("button", { name: "Merk gjort" }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});

test("«nullstill» clears every check — and says so before it is pressed", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Sjekkliste");
  const list = page.locator('[data-widget-kind="checklist"]');
  await list.getByLabel("Nytt punkt …").fill("Matpakke-lapp");
  await list.getByLabel("Nytt punkt …").press("Enter");
  await list.getByLabel("Nytt punkt …").fill("Innlevering");
  await list.getByLabel("Nytt punkt …").press("Enter");

  const reset = list.getByRole("button", { name: "Nullstill avkryssingene" });
  await expect(reset).toBeDisabled();

  await list.getByRole("button", { name: "Merk gjort" }).first().click();
  await expect(reset).toBeEnabled();

  await list.hover();
  await reset.click();
  for (const i of [0, 1]) {
    await expect(
      list.getByRole("button", { name: "Merk gjort" }).nth(i),
    ).toHaveAttribute("aria-pressed", "false");
  }
  // Both rows are still there — this clears checks, it does not clear lists.
  await expect(list).toContainText("Matpakke-lapp");
  await expect(list).toContainText("Innlevering");
  await expect(reset).toBeDisabled();

  // The row must not park on top of the field the teacher types in: a click
  // aimed at «Nytt punkt …» that lands on «Nullstill» would clear the
  // class's checks instead.
  const onTop = await list.getByLabel("Nytt punkt …").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return (
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
    );
  });
  expect(onTop, "the add field is clickable while the row is showing").toBe(
    true,
  );

  await page.reload();
  const after = page.locator('[data-widget-kind="checklist"]');
  await expect(
    after.getByRole("button", { name: "Merk gjort" }).first(),
  ).toHaveAttribute("aria-pressed", "false");
});

test("a list does not JUMP when the mouse passes a row", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Sjekkliste");
  const list = page.locator('[data-widget-kind="checklist"]');
  await list.getByLabel("Nytt punkt …").fill("Matpakke-lapp");
  await list.getByLabel("Nytt punkt …").press("Enter");

  // Park the mouse off the card, then measure the row.
  await page.mouse.move(4, 4);
  const row = list.getByRole("button", { name: "Matpakke-lapp" });
  const before = (await row.boundingBox())!;

  // «Fjern punkt» used to be `display: none`, so it took its 36 px out of
  // the flow and every row RE-WRAPPED under the passing mouse.
  const remove = list.getByRole("button", { name: "Fjern punkt" });
  await expect(remove).toBeHidden();
  await row.hover();
  await expect(remove).toBeVisible();

  const after = (await row.boundingBox())!;
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(Math.round(after.x)).toBe(Math.round(before.x));
});

test("the text widget's alignment and size are set LIVE, and survive a restart", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tekst");
  const text = page.locator('[data-widget-kind="text"]');
  await text.getByRole("button", { name: "Skriv en beskjed …" }).click();

  const editor = text.locator("textarea");
  await editor.fill("Prøve i morgen");

  // The row works WHILE editing: `onMouseDown` preventDefault keeps the
  // textarea focused, so the blur race that swapped the DOM under the mouse
  // between mousedown and mouseup cannot happen.
  await text.getByRole("button", { name: "Venstre" }).click();
  await expect(editor).toBeFocused();
  await expect(text.getByRole("button", { name: "Venstre" })).toHaveAttribute(
    "data-current",
    "true",
  );
  // The editor obeys the setting too — it used to be centred no matter what,
  // so a left-aligned message jumped every time it was opened.
  await expect(editor).toHaveAttribute("data-align", "left");

  const bigger = text.getByRole("button", { name: "Større tekst" });
  const smaller = text.getByRole("button", { name: "Mindre tekst" });
  const fontOf = (loc: typeof editor) =>
    loc.evaluate((el) => getComputedStyle(el).fontSize);
  const start = await fontOf(editor);

  // 1.0 → 1.3 → 1.6 → 2.0 → 2.5, and then the list is spent: the button
  // says so instead of quietly writing a value the backend would clamp.
  for (let i = 0; i < 4; i++) await bigger.click();
  await expect(bigger).toBeDisabled();
  await expect(smaller).toBeEnabled();
  const grown = await fontOf(editor);
  expect(parseFloat(grown)).toBeGreaterThan(parseFloat(start));

  await editor.blur();
  const display = text.locator("button[data-align]");
  await expect(display).toContainText("Prøve i morgen");
  const shown = await fontOf(display);

  await page.reload();
  const after = page
    .locator('[data-widget-kind="text"]')
    .locator("button[data-align]");
  await expect(after).toHaveAttribute("data-align", "left");
  expect(await fontOf(after)).toBe(shown);
});
