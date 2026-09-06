import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The two signal widgets: a click IS the state change, and the state is
// config — the board says the same thing after a restart.

test("the traffic light switches lamps and survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Trafikklys");
  const light = page.locator('[data-widget-kind="trafficlight"]');
  // Red is the honest classroom default.
  await expect(light.locator("[data-active]")).toHaveAttribute(
    "data-active",
    "red",
  );

  await light.getByRole("button", { name: "Grønt lys — samarbeid" }).click();
  await expect(light.locator("[data-active]")).toHaveAttribute(
    "data-active",
    "green",
  );

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="trafficlight"] [data-active]'),
  ).toHaveAttribute("data-active", "green");
});

test("the work symbol changes mode and survives a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Arbeidssymbol");
  const symbol = page.locator('[data-widget-kind="worksymbol"]');
  await expect(symbol.getByText("Stille arbeid")).toBeVisible();

  await symbol.hover();
  await symbol.getByRole("button", { name: "Rekk opp hånda" }).click();
  await expect(symbol.getByText("Rekk opp hånda")).toBeVisible();

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="worksymbol"]').getByText("Rekk opp hånda"),
  ).toBeVisible();
});

test("the work symbol's own glyph cycles the modes, and the row stands", async ({
  page,
}) => {
  // The two signal widgets spoke different languages: the traffic light's
  // lamps ARE its buttons (85 px of direct click), while the work symbol
  // asked for a 36 px hover button — and a press on the big glyph, which is
  // what a teacher does on a touch whiteboard, did nothing at all.
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Arbeidssymbol");
  const symbol = page.locator('[data-widget-kind="worksymbol"]');
  const glyph = symbol.locator("[data-work-glyph]");

  // No hover first: the glyph is on the board, not in the hover row — that
  // is the whole difference from the four mode buttons.
  await expect(glyph).toBeVisible();
  await expect(symbol.getByText("Stille arbeid")).toBeVisible();

  // …and it is a real target, not a 36 px one.
  const box = (await glyph.boundingBox())!;
  expect(box.width).toBeGreaterThan(80);
  expect(box.height).toBeGreaterThan(80);

  await glyph.click();
  await expect(symbol.getByText("Hviskestemme")).toBeVisible();
  await glyph.click();
  await expect(symbol.getByText("Samarbeid")).toBeVisible();

  // Same persistence as a lamp press — the board says the same thing after a
  // restart (product promise 2).
  await page.reload();
  const after = page.locator('[data-widget-kind="worksymbol"]');
  await expect(after.getByText("Samarbeid")).toBeVisible();

  // The row STANDS: cycling cannot jump straight to a mode, so direct choice
  // has to remain — and it still wins over the cycle.
  await after.hover();
  await after.getByRole("button", { name: "Stille arbeid" }).click();
  await expect(after.getByText("Stille arbeid")).toBeVisible();

  // The four-mode cycle comes back round to where it started.
  const glyphAfter = after.locator("[data-work-glyph]");
  for (let i = 0; i < 4; i++) await glyphAfter.click();
  await expect(after.getByText("Stille arbeid")).toBeVisible();
});

test("the work symbol's label is not printed through by the settings row", async ({
  page,
}) => {
  // The card was the one widget without the hover row's reserve: measured on
  // the standard card, «Stille arbeid» ended at y=208,8 and the row's plate
  // started at 195 — about 14 px of the word the class reads, cut off
  // exactly when the teacher reached for the card to change mode.
  await installFixtures(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await addWidget(page, "Arbeidssymbol");
  const symbol = page.locator('[data-widget-kind="worksymbol"]');
  await symbol.hover();

  const row = symbol.locator("[data-settings-row]");
  await expect(row).toBeVisible();
  const label = (await symbol.getByText("Stille arbeid").boundingBox())!;
  const rowBox = (await row.boundingBox())!;

  // The row paints --sp-2 of card colour beyond its own box (its box-shadow
  // plate), so the plate — not the box — is what the label has to clear.
  expect(
    label.y + label.height,
    "the settings row's plate covers the mode label",
  ).toBeLessThanOrEqual(rowBox.y - 8);
});
