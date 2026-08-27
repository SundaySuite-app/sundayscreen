import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The interaction layer's journeys: drag, resize, undo — driven the way a
// teacher would, with the mouse.

test("dragging a widget moves it, and the move survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Tekst" }).click();

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
  await page.getByRole("button", { name: "Tekst" }).click();

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
  await page.getByRole("button", { name: "Tekst" }).click();

  const widget = page.locator('[data-widget-kind="text"]');
  await widget.hover();
  const handle = page.getByRole("button", { name: "Endre størrelse" });
  const hb = (await handle.boundingBox())!;

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 600, hb.y - 600, { steps: 6 });
  await page.mouse.up();

  const box = (await widget.boundingBox())!;
  // The text widget's minSizePx is 200×120.
  expect(box.width).toBeGreaterThanOrEqual(199);
  expect(box.height).toBeGreaterThanOrEqual(119);
  expect(box.width).toBeLessThan(260);
});

test("undo restores a removed widget, and the restore persists", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Tekst" }).click();

  const widget = page.locator('[data-widget-kind="text"]');
  await widget.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(widget).toHaveCount(0);

  await page.getByRole("button", { name: "Angre" }).click();
  await expect(widget).toHaveCount(1);

  await page.reload();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(1);
});
