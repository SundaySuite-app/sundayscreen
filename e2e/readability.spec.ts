import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

/**
 * Add a widget through the TOOLBAR's add menu.
 *
 * Deliberately not `harness.addWidget`: the empty board now offers its own
 * «Legg til verktøy» button, so the accessible name is shared by two controls
 * and the by-role lookup is ambiguous on an empty board — which is every
 * board these tests start from. The toolbar trigger is the one with the
 * aria-label; the empty-state door labels itself with visible text.
 */
async function addWidget(
  page: import("@playwright/test").Page,
  label: string,
): Promise<void> {
  await page.locator('button[aria-label="Legg til verktøy"]').click();
  await page.getByRole("menuitem", { name: label }).click();
}

// THE BACK ROW.
//
// SundayScreen is read off a projector in a lit classroom from three to eight
// metres. Two failure modes are invisible to every other tier we have:
//
//   1. Content that does not FIT its card. A centred flex clips symmetrically,
//      so a clipped clock still looks deliberate — «09:41:07» simply loses the
//      leading 0 and the trailing 7 and reads as a plausible time.
//   2. Type that is technically rendered and practically unreadable. Nothing
//      throws; the widget is just useless past the second row.
//
// Neither shows up in a unit test (there is no layout in node-env) or in a
// screenshot review on a 27-inch desk monitor. They show up here, in pixels,
// against the real cascade.
//
// The size assertions below are FLOORS, not pins: they are deliberately a few
// per cent under what the formulas produce today, so ordinary retuning stays
// free and only a collapse — someone «tidying» a min()/max() away — trips
// them.

/** Is `inner` fully inside `outer`? Playwright reports layout boxes, which
 *  ancestor `overflow: hidden` does not shrink — so clipping is visible here
 *  as an overhang rather than as a silently cropped screenshot. */
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
async function shrinkToMinimum(
  page: import("@playwright/test").Page,
  kind: string,
): Promise<void> {
  const widget = page.locator(`[data-widget-kind="${kind}"]`);
  await widget.hover();
  const handle = page.getByRole("button", { name: "Endre størrelse" });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 700, hb.y - 700, { steps: 6 });
  await page.mouse.up();
}

/** The computed font-size of one element, in CSS px. */
async function fontSizePx(
  locator: import("@playwright/test").Locator,
): Promise<number> {
  return locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test("a clock with seconds fits its card, even at minimum size", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  await clock.hover();
  await clock.getByRole("button", { name: "Sekunder" }).click();

  // `data-seconds` is set on the digital face itself — it is both the hook the
  // wider-tracking rule keys off and the handle this test needs.
  const face = clock.locator("[data-seconds]");
  await expect(face).toBeVisible();

  await shrinkToMinimum(page, "clock");

  const card = (await clock.boundingBox())!;
  const digits = (await face.boundingBox())!;
  await assertContained(digits, card, "clock with seconds");

  // …and the string really is the long one. Without this, a face that had
  // silently dropped the seconds would pass the containment check trivially.
  await expect(face).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
});

test("a die is big enough to read, and three still fit at minimum size", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  // Half of the old defect was a `max-width: 30%` cap that drew a SINGLE die
  // at 24.5px — a widget whose entire content was a thumbnail. Containment
  // alone would have called that a pass, so the size is asserted first.
  const die = (await roll.locator("svg").first().boundingBox())!;
  expect(die.width, `a single die renders at ${die.width}px`).toBeGreaterThan(
    100,
  );

  // The other half: the cap said nothing about how many faces share the row,
  // so three of them ran off the card at minimum size.
  await dice.hover();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await dice.getByRole("button", { name: "Én terning til" }).click();

  await roll.click();
  // Wait for the throw to land: `data-value` only appears once the roll has
  // committed three faces, which is also when the sum line joins the column
  // and the height budget is at its tightest.
  await expect(roll).toHaveAttribute("data-value", /^\d-\d-\d$/);

  await shrinkToMinimum(page, "dice");

  const card = (await dice.boundingBox())!;
  const area = (await roll.boundingBox())!;
  await assertContained(area, card, "three dice");

  // …and the number is still SQUARE to the class after all that. The die is a
  // real body now, so «readable» is no longer a property of the drawing: it
  // is a property of the ORIENTATION the widget rests at, and a resting pose
  // that drifted off the answer would shrink the numeral without touching one
  // pixel of the layout this test otherwise measures.
  const up = await dice
    .locator("svg[data-face-up]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-face-up")));
  expect(up.join("-")).toBe(await roll.getAttribute("data-value"));
});

test("the text widget is projector-sized at its default size", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  // The empty state renders the placeholder, which is the display button's
  // accessible name — and the same element that carries the size formula.
  const display = page.getByRole("button", { name: "Skriv en beskjed …" });
  const px = await fontSizePx(display);

  // The formula lands at ~47px on the e2e viewport (the old `8cqmin × scale`
  // gave 19px there — the single worst readability number in the app). 45 is
  // the floor: below it, the widget a teacher reaches for most has stopped
  // doing its job.
  expect(px, `text widget renders at ${px}px`).toBeGreaterThanOrEqual(45);
});

test("agenda rows are projector-sized at the default size", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Dagens time");

  const agenda = page.locator('[data-widget-kind="agenda"]');
  await agenda.hover();
  await agenda.getByRole("button", { name: "Manuell" }).click();
  await agenda.getByLabel("Ny aktivitet …").fill("Lese stille");
  await agenda.getByLabel("Ny aktivitet …").press("Enter");

  const row = agenda.getByRole("button", { name: "Lese stille" });
  await expect(row).toBeVisible();
  const px = await fontSizePx(row);

  expect(px, `agenda row renders at ${px}px`).toBeGreaterThanOrEqual(24);
});

test("a keyboard user can see where they are — in the app and in a panel", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  /** The computed ring on whatever currently has focus. */
  const ringOnFocused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        width: cs.outlineWidth,
        style: cs.outlineStyle,
      };
    });

  // `2px solid`, not merely «something non-zero»: Chromium's own UA ring is
  // `outline: auto`, so a test that only asked for a non-zero width would go
  // green with base.css deleted and prove nothing at all. This asserts OUR
  // ring — which is also the thing `outline: none` used to remove.
  const expectOurRing = async (where: string) => {
    const ring = await ringOnFocused();
    expect(ring, `Tab moved focus nowhere ${where}`).not.toBeNull();
    expect(
      `${ring!.width} ${ring!.style}`,
      `${ring!.tag} ${where} is not wearing the designed focus ring`,
    ).toBe("2px solid");
  };

  await page.keyboard.press("Tab");
  await expectOurRing("on the board");

  // …and on a FIELD, which is the case the removed `outline: none` rules were
  // actually written for. The manage panel's name box is one of the four
  // places that used to answer «where is the keyboard?» with a 1.39:1 gold
  // border and nothing else.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();

  // The name box specifically — it is the element whose `outline: none` this
  // commit removed, so any other field would leave that rule untested.
  let reachedTheNameBox = false;
  for (let i = 0; i < 40 && !reachedTheNameBox; i++) {
    await page.keyboard.press("Tab");
    reachedTheNameBox = await page.evaluate(
      () => document.activeElement?.tagName === "TEXTAREA",
    );
  }
  expect(
    reachedTheNameBox,
    "the name box is not reachable by Tab in the manage panel",
  ).toBe(true);
  await expectOurRing("on the manage panel's name box");
});

test("an enlarged timer is readable from the back of the room", async ({
  page,
}) => {
  // What «Vis stort» is FOR. On the ordinary board a timer card shares the
  // wall with five other widgets and its digits land near 80 px — fine from
  // the second row, guesswork from the eighth. This is the number that has to
  // move, and it is the one thing a `transform: scale()` implementation would
  // have left frozen at the small card's `cq` basis.
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await addWidget(page, "Tidtaker");

  const timer = page.locator('[data-widget-kind="timer"]');
  const face = timer.getByText("05:00");
  const before = await fontSizePx(face);

  await timer.hover();
  await timer.getByRole("button", { name: "Vis stort" }).click();

  // A FLOOR, not a pin: the formula is `min(40cqmin, 20cqw)` against a
  // 1232×612 box, which lands near 245 px today. 200 is where the claim
  // stops being true.
  await expect.poll(() => fontSizePx(face)).toBeGreaterThanOrEqual(200);
  expect(await fontSizePx(face)).toBeGreaterThan(before * 2);
});
