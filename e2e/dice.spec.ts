import { expect, test, type Locator, type Page } from "@playwright/test";

import { FACE_SHAPES } from "../app/widgets/dice/dice-core";
import { installFixtures } from "./harness";

// THE THROWN DIE.
//
// R12 replaced a 600 ms pip-scramble with an actual throw: the faces fly
// across the card, bounce off its walls, spin down and land on the answer.
// `dice-physics-core.test.ts` proves the arithmetic (never leaves the box,
// lands exactly on the resting slot, loses energy, same seed ⇒ same flight).
// What it cannot prove is that the arithmetic reaches the DOM and then LETS
// GO of it — a residual `transform` on a face is invisible in a unit test and
// permanent on a projector, because the layout no longer owns that die.
//
// The second half of the round is the die TYPE (d4 … d20). Its risk is not
// the rendering but the round trip: a type that survives the roll but not the
// reload is worse than one that was never offered, because the teacher has
// already told the class what they are rolling.

/** Add a widget through the TOOLBAR's add menu.
 *
 *  By `aria-label`, not by role+name: on an empty board — which is every board
 *  a test starts from — the empty-state door labels itself with the same
 *  visible text, and a by-role lookup matches both. Same reasoning, and the
 *  same locator, as `readability.spec.ts`. */
async function addWidget(page: Page, label: string): Promise<void> {
  await page.locator('button[aria-label="Legg til verktøy"]').click();
  await page.getByRole("menuitem", { name: label }).click();
}

/** Is `inner` fully inside `outer`? Playwright reports LAYOUT boxes, which an
 *  ancestor's `overflow: hidden` does not shrink — so a die that overhangs the
 *  card shows up here even though the screenshot would look tidy.
 *
 *  A local copy of `readability.spec.ts`'s helper: that file does not export
 *  it, and reaching across spec files for one assertion would couple two
 *  suites that have no other reason to know about each other. */
async function assertContained(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
  what: string,
): Promise<void> {
  const slack = 0.5; // sub-pixel layout rounding, nothing more
  expect(inner.x, `${what}: overhangs the left edge`).toBeGreaterThanOrEqual(
    outer.x - slack,
  );
  expect(inner.y, `${what}: overhangs the top edge`).toBeGreaterThanOrEqual(
    outer.y - slack,
  );
  expect(
    inner.x + inner.width,
    `${what}: overhangs the right edge`,
  ).toBeLessThanOrEqual(outer.x + outer.width + slack);
  expect(
    inner.y + inner.height,
    `${what}: overhangs the bottom edge`,
  ).toBeLessThanOrEqual(outer.y + outer.height + slack);
}

/** Drag the SE handle far up and left, so the widget lands on its own
 *  minSizePx — the worst case every «does it fit» claim has to survive. */
async function shrinkToMinimum(page: Page, kind: string): Promise<void> {
  const widget = page.locator(`[data-widget-kind="${kind}"]`);
  await widget.hover();
  const handle = page.getByRole("button", { name: "Endre størrelse" });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 700, hb.y - 700, { steps: 6 });
  await page.mouse.up();
}

/** The computed `transform` of every die face, as the browser reports it. */
function transforms(roll: Locator): Promise<string[]> {
  return roll
    .locator("svg")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
}

/** «No transform» is spelled two ways depending on how the property got
 *  there — an untouched element says `none`, one whose inline transform was
 *  cleared may report the identity matrix. Both mean the LAYOUT owns the
 *  position again, which is the thing being asserted. */
function isIdentity(value: string): boolean {
  return value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)";
}

/** Press the die-type button until it reads «D{faces}». The card must already
 *  be hovered — the settings row is `visibility: hidden` otherwise, and
 *  hidden means unhittable (F9-funn U#9). */
async function setFaces(dice: Locator, faces: number): Promise<void> {
  const button = dice.locator("[data-dice-faces]");
  for (let i = 0; i < 8; i++) {
    if ((await button.textContent()) === `D${faces}`) return;
    await button.click();
  }
  throw new Error(`the die type never reached D${faces}`);
}

test("a throw lands, and the class finds the same answer after a restart", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  // Before the first throw: the empty state, not a fabricated 1.
  await expect(roll).not.toHaveAttribute("data-value", /.*/);

  await roll.click();
  // `data-value` appears only when the throw has COMMITTED — the flight and
  // the scramble are both over and the value is in the config.
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  const landed = await roll.getAttribute("data-value");

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="dice"] [data-value]'),
  ).toHaveAttribute("data-value", landed!);
  // …and it is painted STILL. Promise 2 is «the screen comes back», not «the
  // screen replays»: a restart mid-lesson must not throw the dice again.
  expect((await transforms(roll)).every(isIdentity)).toBe(true);
});

test("the dice fly, and then hand the position back to the layout", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });
  await dice.hover();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await dice.getByRole("button", { name: "Én terning til" }).click();

  await roll.click();

  // 1. The flight is real. Without this the two assertions below are also
  //    satisfied by a die that never moved, which is exactly the regression
  //    this round is guarding against.
  await expect
    .poll(async () => (await transforms(roll)).some((x) => !isIdentity(x)), {
      timeout: 1000,
      message: "no die ever left its slot — the throw did not animate",
    })
    .toBe(true);

  // 2. …and it stays in the card while it flies. The other widgets on the
  //    board are not the dice's playground.
  const cardMidFlight = (await dice.boundingBox())!;
  for (const die of await roll.locator("svg").all()) {
    await assertContained(
      (await die.boundingBox())!,
      cardMidFlight,
      "a die in flight",
    );
  }

  // 3. When it lands, the inline transform is GONE. A face left holding a
  //    translate looks right until the card is resized or focused, and then
  //    silently sits somewhere it was never laid out.
  await expect(roll).toHaveAttribute("data-value", /^\d+-\d+-\d+$/);
  expect(
    (await transforms(roll)).every(isIdentity),
    "a face is still wearing its flight transform",
  ).toBe(true);

  const card = (await dice.boundingBox())!;
  await assertContained((await roll.boundingBox())!, card, "the landed dice");
});

test("the die type can be changed, and it survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });
  const facesButton = dice.locator("[data-dice-faces]");

  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);

  await dice.hover();
  // The accessible name explains the control; the LABEL is its current value.
  await expect(dice.getByRole("button", { name: "Terningtype" })).toHaveText(
    "D6",
  );
  await facesButton.click();
  await expect(facesButton).toHaveText("D8");

  // Changing the type clears the roll: 5-5-6 under a «D8» label is a lie
  // about what the class just watched.
  await expect(roll).not.toHaveAttribute("data-value", /.*/);

  // A d8 is not merely «a d6 whose numbers might go higher» — it is drawn as
  // a different solid, and that is checkable without waiting for a lucky 7.
  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-8]$/);
  await expect(roll.locator("svg polygon").first()).toHaveAttribute(
    "points",
    FACE_SHAPES[8].points,
  );
  // The numeral on the face IS the persisted value — not a second roll.
  await expect(roll.locator("svg text")).toHaveText(
    (await roll.getAttribute("data-value"))!,
  );

  const landed = await roll.getAttribute("data-value");
  await page.reload();
  const reloaded = page.locator('[data-widget-kind="dice"]');
  await reloaded.hover();
  await expect(reloaded.locator("[data-dice-faces]")).toHaveText("D8");
  await expect(reloaded.getByRole("button", { name: "Kast" })).toHaveAttribute(
    "data-value",
    landed!,
  );
  await expect(reloaded.locator("svg polygon").first()).toHaveAttribute(
    "points",
    FACE_SHAPES[8].points,
  );
});

test("reduced motion: the answer still arrives, nothing flies", async ({
  page,
}) => {
  // A teacher who has asked the OS for less movement gets the old
  // scramble-in-place. The flight is a rAF loop, which no media query can
  // reach — so this is the one place the preference is checked in JS, and the
  // one place a regression would be invisible everywhere else.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();
  // Sampled ACROSS the roll, not after it: «no transform at the end» is what
  // the flying version also produces.
  for (let i = 0; i < 6; i++) {
    expect(
      (await transforms(roll)).every(isIdentity),
      "a die moved despite prefers-reduced-motion: reduce",
    ).toBe(true);
    await page.waitForTimeout(90);
  }

  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  expect((await transforms(roll)).every(isIdentity)).toBe(true);
});

test("three d20 fit the smallest card, and so does the three-button row", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await dice.hover();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await setFaces(dice, 20);

  // Two digits on three hexagons is the widest the widget ever gets.
  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^\d+-\d+-\d+$/);

  await shrinkToMinimum(page, "dice");
  await dice.hover();

  const card = (await dice.boundingBox())!;
  await assertContained((await roll.boundingBox())!, card, "three d20");
  for (const die of await roll.locator("svg").all()) {
    await assertContained((await die.boundingBox())!, card, "one d20");
  }

  // The settings row gained a third button this round. It is `width:
  // max-content` with a max-width cap and `flex-wrap: wrap`, so an overflow
  // does not clip — it WRAPS, onto a second line printed over the dice. Same
  // tops means one line.
  const tops = await dice
    .locator("[data-settings-btn]")
    .evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
  expect(tops).toHaveLength(3);
  expect(
    new Set(tops).size,
    `the three settings buttons wrapped onto ${new Set(tops).size} lines`,
  ).toBe(1);

  const row = dice.locator("[data-settings-row]");
  await assertContained((await row.boundingBox())!, card, "the settings row");
});
