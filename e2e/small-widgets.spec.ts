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

  // The check buttons are matched by their data hook now: the accessible
  // name carries the ROW's text («Merk «Matpakke-lapp» som gjort»), so a
  // by-name lookup here would be a lookup on the fixture's own data.
  await list.locator("[data-check-btn]").first().click();
  await expect(list.locator("[data-check-btn]").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // …and the name really does say which row it is.
  await expect(list.locator("[data-check-btn]").first()).toHaveAttribute(
    "aria-label",
    /Matpakke-lapp/,
  );
  await expect(list.locator("[data-remove-btn]").first()).toHaveAttribute(
    "aria-label",
    /Matpakke-lapp/,
  );

  await page.reload();
  const after = page.locator('[data-widget-kind="checklist"]');
  await expect(after).toContainText("Matpakke-lapp");
  await expect(after.locator("[data-check-btn]").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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

  await list.locator("[data-check-btn]").first().click();
  await expect(reset).toBeEnabled();

  await list.hover();
  await reset.click();
  for (const i of [0, 1]) {
    await expect(list.locator("[data-check-btn]").nth(i)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
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
  await expect(after.locator("[data-check-btn]").first()).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
  // `exact: true`: the row's check and remove buttons carry the row's own
  // text in their accessible names now, so a substring match finds three.
  const row = list.getByRole("button", {
    name: "Matpakke-lapp",
    exact: true,
  });
  const before = (await row.boundingBox())!;

  // «Fjern punkt» used to be `display: none`, so it took its 36 px out of
  // the flow and every row RE-WRAPPED under the passing mouse.
  const remove = list.locator("[data-remove-btn]");
  await expect(remove).toBeHidden();
  await row.hover();
  await expect(remove).toBeVisible();

  const after = (await row.boundingBox())!;
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(Math.round(after.x)).toBe(Math.round(before.x));
});

test("the timer offers the SCHOOL's lesson length when no lesson is running", async ({
  page,
}) => {
  // The app has known `settings.lessonMinutes` since Timeoppsett and never
  // said it in the timer. The largest preset is 20, so «dere får 45
  // minutter» in a vikartime — or on day one, before the week is set up —
  // cost «Sett til 20» plus twenty-five presses of «Ett minutt til», in
  // front of the class. The fixtures carry the 45-minute default and no
  // running lesson, which is exactly that morning.
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();

  const lesson = timer.locator("[data-lesson-length]");
  await expect(lesson).toHaveText("45 min");
  // It REPLACES 15 rather than joining the row — five is the constraint, and
  // the ladder 1 · 5 · 10 · 20 still covers a school hour end to end.
  await expect(
    timer.getByRole("button", { name: "Sett til 15 minutter" }),
  ).toHaveCount(0);
  await expect(
    timer.getByRole("button", { name: "Sett til 10 minutter" }),
  ).toBeVisible();
  // The accessible name is the presets' own sentence, so a voice command and
  // a screen reader both get «Sett til 45 minutter».
  await expect(lesson).toHaveAttribute("aria-label", "Sett til 45 minutter");

  // ONE click is the whole point.
  await lesson.click();
  await expect(timer.getByText("45:00")).toBeVisible();
  await expect(lesson).toHaveAttribute("data-current", "true");

  // …and the row still fits on one line at this card's size — the sixth-pill
  // wrap the widget's comment warns about, arriving through width.
  const row = (await timer.locator("[data-settings-row]").boundingBox())!;
  expect(
    row.height,
    "the settings row wrapped onto a second line",
  ).toBeLessThan(56);

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="timer"]').getByText("45:00"),
  ).toBeVisible();
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
