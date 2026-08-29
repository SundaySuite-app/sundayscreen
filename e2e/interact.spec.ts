import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The interaction layer's journeys: drag, resize, undo — driven the way a
// teacher would, with the mouse.

test("dragging a widget moves it, and the move survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const widget = page.locator('[data-widget-kind="text"]');
  const before = (await widget.boundingBox())!;

  // Grab near the top edge (still the drag surface) and pull down-right.
  const grabX = before.x + before.width / 2;
  const grabY = before.y + 14;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 150, grabY + 90, { steps: 6 });
  await page.mouse.up();

  const after = (await widget.boundingBox())!;
  // Snapping may adjust a few px — assert the move, not the exact pixel.
  expect(after.x - before.x).toBeGreaterThan(120);
  expect(after.y - before.y).toBeGreaterThan(60);

  await page.reload();
  const restored = (await page
    .locator('[data-widget-kind="text"]')
    .boundingBox())!;
  expect(Math.abs(restored.x - after.x)).toBeLessThan(10);
  expect(Math.abs(restored.y - after.y)).toBeLessThan(10);
});

test("a finished drag does not open the text editor", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const widget = page.locator('[data-widget-kind="text"]');
  const box = (await widget.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.up();

  await expect(page.locator("textarea")).toHaveCount(0);
  // …while a plain CLICK (no movement) does open it.
  await widget.click();
  await expect(page.locator("textarea")).toHaveCount(1);
});

test("resizing respects the widget's minimum size", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const widget = page.locator('[data-widget-kind="text"]');
  const before = (await widget.boundingBox())!;

  // Haul the SE handle far past any plausible minimum, twice. The exact
  // floor is the registry's business (and gets tuned); what this journey
  // owns is that there IS one — the card shrinks, then STOPS.
  const shrink = async () => {
    await widget.hover();
    const hb = (await page
      .getByRole("button", { name: "Endre størrelse" })
      .boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 900, hb.y - 900, { steps: 6 });
    await page.mouse.up();
    return (await widget.boundingBox())!;
  };

  const first = await shrink();
  expect(first.width).toBeLessThan(before.width);
  expect(first.height).toBeLessThan(before.height);

  const second = await shrink();
  expect(Math.round(second.width)).toBe(Math.round(first.width));
  expect(Math.round(second.height)).toBe(Math.round(first.height));

  // …and the floor holds across a restart, so the board comes back EXACTLY.
  await page.reload();
  const restored = (await page
    .locator('[data-widget-kind="text"]')
    .boundingBox())!;
  expect(Math.abs(restored.width - second.width)).toBeLessThan(2);
  expect(Math.abs(restored.height - second.height)).toBeLessThan(2);
});

test("a resize snaps its far edges to a neighbour's", async ({ page }) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addWidget(page, "Tekst");
  await addWidget(page, "Klokke");

  const text = page.locator('[data-widget-kind="text"]');
  const clock = page.locator('[data-widget-kind="clock"]');
  const clockBox = (await clock.boundingBox())!;
  const textBox = (await text.boundingBox())!;

  // Drag the text card's SE handle so its right edge lands 5 px short of
  // the clock's right edge — inside the 8 px snap distance.
  await text.hover();
  const hb = (await text
    .getByRole("button", { name: "Endre størrelse" })
    .boundingBox())!;
  const wantedRight = clockBox.x + clockBox.width - 5;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    hb.x + hb.width / 2 + (wantedRight - (textBox.x + textBox.width)),
    hb.y + hb.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const after = (await text.boundingBox())!;
  expect(
    Math.abs(after.x + after.width - (clockBox.x + clockBox.width)),
  ).toBeLessThan(2);
});

test("undo restores a removed widget, and the restore persists", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const widget = page.locator('[data-widget-kind="text"]');
  await widget.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(widget).toHaveCount(0);

  await page.getByRole("button", { name: "Angre" }).click();
  await expect(widget).toHaveCount(1);

  await page.reload();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(1);
});

test("the undo window outlasts five seconds, and closes at fifteen", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  await page.locator('[data-widget-kind="text"]').hover();
  await page.getByRole("button", { name: "Fjern" }).click();

  const undo = page.getByRole("button", { name: "Angre" });
  await expect(undo).toBeVisible();
  // Five seconds ran out while the teacher was still working out WHAT had
  // vanished from the board.
  await page.clock.fastForward(8_000);
  await expect(undo).toBeVisible();
  await page.clock.fastForward(9_000);
  await expect(undo).toHaveCount(0);
});

test("Cmd/Ctrl+Z takes back a deletion — and is inert without one", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");
  await addWidget(page, "Klokke");

  const text = page.locator('[data-widget-kind="text"]');
  await text.hover();
  await text.getByRole("button", { name: "Fjern" }).click();
  await expect(text).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Angre" })).toHaveCount(0);

  // With nothing in the slot the binding does nothing at all: it never
  // promises an undo history the app does not have.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveCount(1);
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);
});

test("a class switch drops the pending undo", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();

  const text = page.locator('[data-widget-kind="text"]');
  await expect(text).toHaveCount(1);
  await text.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(page.getByRole("button", { name: "Angre" })).toBeVisible();

  // The removed card belonged to the board we are leaving. Undoing it into
  // 8A would put it in the WRONG screen and save it there — so the offer is
  // withdrawn with the board.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "8A" }).click();
  await expect(page.getByRole("button", { name: "Angre" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(0);
});

test("a duplicate carries the settings and is its own card", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Sjekkliste");

  const lists = page.locator('[data-widget-kind="checklist"]');
  await lists.first().getByLabel("Nytt punkt …").fill("Matpakke-lapp");
  await lists.first().getByLabel("Nytt punkt …").press("Enter");
  await expect(lists.first()).toContainText("Matpakke-lapp");

  await lists.first().hover();
  await page.getByRole("button", { name: "Dupliser" }).click();
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(1)).toContainText("Matpakke-lapp");

  // Nudged clear of the original — a copy sitting exactly on top reads as
  // "the button did nothing" — and at the SAME size: a duplicate is not a
  // fresh default-sized card.
  const a = (await lists.nth(0).boundingBox())!;
  const b = (await lists.nth(1).boundingBox())!;
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(8);
  expect(Math.round(b.width)).toBe(Math.round(a.width));
  expect(Math.round(b.height)).toBe(Math.round(a.height));

  // structuredClone, not a spread: ticking the copy must leave the original
  // alone, or the two share one `items` array.
  const done = (i: number) =>
    lists.nth(i).getByRole("button", { name: "Merk gjort" }).first();
  await done(1).click();
  await expect(done(1)).toHaveAttribute("aria-pressed", "true");
  await expect(done(0)).not.toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator('[data-widget-kind="checklist"]')).toHaveCount(2);
});
