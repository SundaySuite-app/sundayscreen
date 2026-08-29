import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The randomness widgets. The harness draw is deterministic (first undrawn
// wins), so the round semantics are assertable; the REAL randomness is the
// backend's property-tested core.

const NAMES = ["Kari", "Ola", "Per", "Mona"];

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
