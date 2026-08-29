import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

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
