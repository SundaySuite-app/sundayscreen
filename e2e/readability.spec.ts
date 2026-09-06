import { expect, test } from "@playwright/test";

import { sizeFor } from "../app/widgets/groups/groups-fit-core";
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

test("an enlarged die actually gets bigger", async ({ page }) => {
  // «Vis stort» used to hand the die a much bigger card and draw it at the
  // same fraction of the SHORT SIDE — `56cqmin`, a cap tuned in R3 for a card
  // sharing a board with five other widgets and never revisited (R5-funn H2).
  // At 1024×768 the enlarged card is 976×660 and the die came out 368px: 56 %
  // of the card's height, with 138px of blank paper above it and 138 below,
  // while the height budget alone would have paid for 568.
  //
  // A FLOOR, not a pin — the budgets land at 506px today. 480 is where the
  // claim «the die is the card now» stops being true, and it is far enough
  // above the old 368 that the cap cannot creep back.
  await installFixtures(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const die = dice.locator("svg[data-solid]").first();
  const before = (await die.boundingBox())!;

  await dice.hover();
  await dice.getByRole("button", { name: "Vis stort" }).click();

  await expect
    .poll(async () => (await die.boundingBox())!.height)
    .toBeGreaterThanOrEqual(480);

  const after = (await die.boundingBox())!;
  // Square, and grown — a die that had merely been stretched would pass the
  // height floor while reading as an egg from the back of the room.
  expect(after.width).toBeCloseTo(after.height, 0);
  expect(after.height).toBeGreaterThan(before.height * 3);

  // …and it still fits the card it grew into, settings row included: the
  // point of raising the cap was to spend the dead space, not to overrun the
  // one control «Vis stort» leaves on the card.
  const card = (await dice.boundingBox())!;
  await assertContained(after, card, "the enlarged die");
  const row = (await dice.locator("[data-settings-row]").boundingBox())!;
  expect(
    after.y + after.height,
    "the die is printed through by the settings row",
  ).toBeLessThan(row.y);
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

  // `exact: true`: the row's check button is named after the row now
  // («Merk «Lese stille» som gjort»), so the default substring match would
  // find two buttons.
  const row = agenda.getByRole("button", {
    name: "Lese stille",
    exact: true,
  });
  await expect(row).toBeVisible();
  const px = await fontSizePx(row);

  expect(px, `agenda row renders at ${px}px`).toBeGreaterThanOrEqual(24);
});

// A real class, in the two places the group generator is actually read from:
// the card it is born on, and «Vis stort» during a split.
const CLASS_25 = Array.from({ length: 25 }, (_, i) => `Elev ${i + 1}`);

test("25 pupils in two groups are readable — on the card and enlarged", async ({
  page,
}) => {
  // THE finding of the classroom round. The crowding ladder counted NAMES
  // (`max(rows, ceil(longest/5))` → one of four fixed scales), so it answered
  // the same 0.56 whatever the box was: measured 7,4 px of name and 5,4 px of
  // «GRUPPE 1» on the standard card — unreadable from the FIRST desk — and
  // 16,2 px in «Vis stort» with 43 % of each panel standing empty. The class
  // could not read who was where, so the teacher read it out and the widget
  // had lost its job.
  //
  // FLOORS, not pins: the formulas land at 15,5 px and 46,4 px today.
  await installFixtures(page, { memberNames: CLASS_25 });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await addWidget(page, "Grupper");

  const groups = page.locator('[data-widget-kind="groups"]');
  await groups.hover();
  // Two groups is the default (groups/index.ts) — and the crowded case, 13
  // to a panel.
  await groups.getByRole("button", { name: "Del inn" }).click();
  await expect(groups.locator("li")).toHaveCount(25);

  const name = groups.locator("li").first();
  const heading = groups.locator("h3").first();
  const onCard = await fontSizePx(name);
  expect(
    onCard,
    `a name in a group renders at ${onCard}px`,
  ).toBeGreaterThanOrEqual(13);
  const headingPx = await fontSizePx(heading);
  expect(
    headingPx,
    `«Gruppe 1» renders at ${headingPx}px`,
  ).toBeGreaterThanOrEqual(8);

  // …and the names still FIT the panel they were sized against. The whole
  // point of scaling from the container is that the budget is real: `.group`
  // clips, so an over-eager formula would cut the last pupil off instead of
  // shrinking.
  const panel = (await groups.locator("section").first().boundingBox())!;
  const list = (await groups
    .locator("section")
    .first()
    .locator("ul")
    .boundingBox())!;
  await assertContained(list, panel, "the first group's names");

  await groups.hover();
  await groups.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => fontSizePx(name)).toBeGreaterThanOrEqual(34);

  const bigPanel = (await groups.locator("section").first().boundingBox())!;
  const bigList = (await groups
    .locator("section")
    .first()
    .locator("ul")
    .boundingBox())!;
  await assertContained(bigList, bigPanel, "the first group's names, enlarged");
  // The card really did grow — without this the floor above could be met by
  // a «Vis stort» that never happened.
  expect(bigPanel.height).toBeGreaterThan(panel.height * 2);
});

// REAL names. «Elev N» is narrow (no M, no A, no m) and short, and the group
// journey above was green while «Andreas» wrapped and «Daniel» went under the
// panel's clipping edge (R7-funn S2-1). These are the two lists a teacher
// actually types: the class as first names, and the class as the school
// system exports it.
const FIRST_NAMES_20 = [
  "Mathias",
  "Kristin",
  "Andreas",
  "Camilla",
  "Henrik",
  "Jørgen",
  "Marius",
  "Silje",
  "Martin",
  "Nikolai",
  "Amanda",
  "Sander",
  "Oskar",
  "Victoria",
  "Fredrik",
  "Emilie",
  "Tobias",
  "Malin",
  "Daniel",
  "Hedda",
];

const FULL_NAMES_25 = [
  "Anne-Sofie Kristiansen",
  "Kristoffer Andreassen",
  "Aleksander Pettersen",
  "Mathias Berg",
  "Amanda Moen",
  "Henrik Moen",
  "Amalie Dahl",
  "Isak Halvorsen",
  "Theodor Lund",
  "Elias Strand",
  "Emma Nilsen",
  "Nora Hansen",
  "Oliver Olsen",
  "Sofie Larsen",
  "Jakob Johansen",
  "Ella Andersen",
  "Lucas Pedersen",
  "Maja Karlsen",
  "William Eriksen",
  "Leah Svendsen",
  "Noah Jensen",
  "Mia Haugen",
  "Filip Bakke",
  "Ingrid Solberg",
  "Magnus Lie",
];

/** One group panel, measured against the real cascade. */
interface PanelMeasure {
  /** The panel's content box — what `cqw`/`cqh` resolve against. */
  box: { w: number; h: number };
  /** The stylesheet's inputs, as the panel's children see them. */
  inputs: { lines: number; cols: 1 | 2; nameEm: number };
  fontPx: number;
  /** Names drawn on more than one line. */
  wrapped: string[];
  /** Names whose box reaches past the panel's content box — `.group` is
   *  `overflow: hidden`, so these are the pupils the class cannot see. */
  clipped: string[];
  /** Names the chip had to cut («…»). */
  ellipsed: string[];
  /** Unused height under the list, and unused width beside the widest name,
   *  as fractions of the panel. */
  emptyH: number;
  emptyW: number;
}

async function measurePanels(
  groups: import("@playwright/test").Locator,
): Promise<PanelMeasure[]> {
  return groups.evaluate((root) => {
    const out: PanelMeasure[] = [];
    for (const panel of root.querySelectorAll("section")) {
      const cs = getComputedStyle(panel);
      const r = panel.getBoundingClientRect();
      const left = r.left + parseFloat(cs.paddingLeft);
      const right = r.right - parseFloat(cs.paddingRight);
      const top = r.top + parseFloat(cs.paddingTop);
      const bottom = r.bottom - parseFloat(cs.paddingBottom);
      const list = panel.querySelector("ul")!;
      const lcs = getComputedStyle(list);
      const chips = [...panel.querySelectorAll("li")];
      const wrapped: string[] = [];
      const clipped: string[] = [];
      const ellipsed: string[] = [];
      let widestText = 0;
      let column = 0;
      for (const chip of chips) {
        const range = document.createRange();
        range.selectNodeContents(chip);
        const rects = [...range.getClientRects()];
        // On more than one LINE — distinct tops, not a rect count: a cut
        // («…») name can report two fragments on the same line, and a grid
        // row stretches every chip in it to the tallest, so neither the
        // rect count nor the chip's own height says what a line break is.
        const tops = new Set(rects.map((rect) => Math.round(rect.top)));
        if (tops.size > 1) wrapped.push(chip.textContent ?? "");
        const cr = chip.getBoundingClientRect();
        const slack = 0.5;
        if (
          cr.left < left - slack ||
          cr.right > right + slack ||
          cr.top < top - slack ||
          cr.bottom > bottom + slack
        ) {
          clipped.push(chip.textContent ?? "");
        }
        if (chip.scrollWidth > chip.clientWidth + slack) {
          ellipsed.push(chip.textContent ?? "");
        }
        widestText = Math.max(widestText, rects[0]?.width ?? 0);
        column = cr.width;
      }
      const w = right - left;
      const h = bottom - top;
      out.push({
        box: { w, h },
        inputs: {
          lines: Number(lcs.getPropertyValue("--lines")),
          cols: Number(lcs.getPropertyValue("--chip-cols")) as 1 | 2,
          nameEm: Number(lcs.getPropertyValue("--name-em")),
        },
        fontPx: parseFloat(getComputedStyle(chips[0]).fontSize),
        wrapped,
        clipped,
        ellipsed,
        emptyH: (bottom - list.getBoundingClientRect().bottom) / h,
        emptyW: column > 0 ? 1 - widestText / column : 1,
      });
    }
    return out;
  });
}

/** What every panel on the board has to satisfy, whatever the names: one
 *  line per name, nothing cut, nothing under the edge — and the stylesheet's
 *  size agreeing with groups-fit-core's pixel twin of the same formula, on
 *  the box the stylesheet actually had. That last one is the seam: the
 *  widget CHOOSES columns with the core's numbers and the stylesheet SIZES
 *  with its own, and a retune of one that misses the other would put a
 *  two-column decision under a one-column size. */
function expectWholePanels(panels: PanelMeasure[], what: string): void {
  expect(panels.length, `${what}: no panels`).toBeGreaterThan(0);
  for (const [i, p] of panels.entries()) {
    const where = `${what}, panel ${i + 1}`;
    expect(p.ellipsed, `${where}: names cut with «…»`).toEqual([]);
    expect(p.clipped, `${where}: names under the clipping edge`).toEqual([]);
    expect(p.wrapped, `${where}: names on two lines`).toEqual([]);
    const predicted = sizeFor(p.box, p.inputs);
    expect(
      Math.abs(p.fontPx - predicted) / predicted,
      `${where}: stylesheet says ${p.fontPx}px, the core says ${predicted}px`,
    ).toBeLessThan(0.02);
  }
}

/** The formula's promise is «whichever runs out first decides» — so on
 *  every panel at least one axis IS run out. A panel with room to spare on
 *  both is type that could have been bigger (S2-2 measured 36–51 % of the
 *  height empty with the width halved by a split that did not pay). */
function expectOneAxisUsedUp(panels: PanelMeasure[], what: string): void {
  for (const [i, p] of panels.entries()) {
    expect(
      Math.min(p.emptyH, p.emptyW),
      `${what}, panel ${i + 1}: ${Math.round(p.emptyH * 100)} % of the height and ${Math.round(p.emptyW * 100)} % of the width unused`,
    ).toBeLessThanOrEqual(0.2);
  }
}

/** Deal a seeded class into `n` groups and return the widget. */
async function dealGroups(
  page: import("@playwright/test").Page,
  names: string[],
  viewport: { width: number; height: number },
  n: number,
): Promise<import("@playwright/test").Locator> {
  await installFixtures(page, { memberNames: names });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await addWidget(page, "Grupper");
  const groups = page.locator('[data-widget-kind="groups"]');
  await groups.hover();
  for (let i = 2; i < n; i++) {
    await groups.getByRole("button", { name: "Øk tallet" }).click();
  }
  await groups.getByRole("button", { name: "Del inn" }).click();
  await expect(groups.locator("li")).toHaveCount(names.length);
  return groups;
}

async function enlarge(
  groups: import("@playwright/test").Locator,
): Promise<void> {
  await groups.hover();
  await groups.getByRole("button", { name: "Vis stort" }).click();
}

const PROJECTORS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

for (const viewport of PROJECTORS) {
  const vp = `${viewport.width}×${viewport.height}`;

  test(`twenty first names in two groups are whole and readable @${vp}`, async ({
    page,
  }) => {
    // THE finding (S2-1). Ten names to a panel, «Andreas» and «Amanda» among
    // them: the per-character budget put «Andreas» on two lines, the extra
    // line pushed «Tobias» and «Daniel» under the panel edge, and nothing
    // was red — group 2 looked perfect, so the teacher saw a random fault.
    // Measured before the fix: 2 of 10 gone on the 1024 card, 4 of 10 gone
    // enlarged on 1280. Now the widest name is measured, not counted, and a
    // chip never wraps.
    //
    // FLOORS, not pins: the formula lands at 20,0 / 25,4 px on the card and
    // 45,7 / 59,0 px enlarged today (1024 / 1280).
    const groups = await dealGroups(page, FIRST_NAMES_20, viewport, 2);
    const name = groups.locator("li").first();
    await expect.poll(() => fontSizePx(name)).toBeGreaterThanOrEqual(15);
    expectWholePanels(await measurePanels(groups), `first names @${vp}, card`);

    await enlarge(groups);
    await expect.poll(() => fontSizePx(name)).toBeGreaterThanOrEqual(40);
    expectWholePanels(
      await measurePanels(groups),
      `first names @${vp}, enlarged`,
    );
  });

  for (const n of [2, 3]) {
    test(`twenty-five full names in ${n} groups lose nobody @${vp}`, async ({
      page,
    }) => {
      // S2-2. «Anne-Sofie Kristiansen» is 22 characters and 11,2 em; the
      // 18-character cap made the width term budget for a name that did not
      // exist, the rest wrapped, and in three groups the ninth pupil of the
      // panel was under the edge on the standard card. And two columns were
      // chosen from the COUNT (eight names up), halving a width that was
      // already the binding term: 21,8 px enlarged where one column gives
      // 26,2.
      //
      // The floors are what a 13-line (or 9-line) column of 11 em names can
      // physically be in these boxes — the fix removes the loss, it cannot
      // add height. Measured today (card / enlarged): two groups 8,7 / 26,2
      // at 1024 and 12,5 / 27,8 at 1280; three groups 10,2 / 23,3 and
      // 13,0 / 30,4. Floors sit ~5 % under.
      const floors = {
        1024: { 2: [8, 24], 3: [9.5, 22] },
        1280: { 2: [11.5, 26], 3: [12, 28] },
      }[viewport.width as 1024 | 1280]![n as 2 | 3]!;

      const groups = await dealGroups(page, FULL_NAMES_25, viewport, n);
      const name = groups.locator("li").first();
      await expect
        .poll(() => fontSizePx(name))
        .toBeGreaterThanOrEqual(floors[0]);
      let panels = await measurePanels(groups);
      expectWholePanels(panels, `full names/${n} @${vp}, card`);
      expectOneAxisUsedUp(panels, `full names/${n} @${vp}, card`);

      await enlarge(groups);
      await expect
        .poll(() => fontSizePx(name))
        .toBeGreaterThanOrEqual(floors[1]);
      panels = await measurePanels(groups);
      expectWholePanels(panels, `full names/${n} @${vp}, enlarged`);
      expectOneAxisUsedUp(panels, `full names/${n} @${vp}, enlarged`);
    });
  }
}

test("a five-name draw is readable, and grows with the card", async ({
  page,
}) => {
  // The same disease in the picker: `PICK_SCALE` was calibrated against the
  // SMALLEST card (380×260) and then applied to every card, so a five-name
  // draw was 16,5 px whether the card was minimum-sized or twice that. The
  // floor here is the small card's own physics; the second half of the test
  // is the part the ladder could never pass.
  await installFixtures(page, { memberNames: CLASS_25 });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await addWidget(page, "Navnetrekker");

  const picker = page.locator('[data-widget-kind="namepicker"]');
  await picker.hover();
  for (let i = 0; i < 4; i++) {
    await picker.getByRole("button", { name: "Ett navn til" }).click();
  }
  await picker.getByRole("button", { name: "Trekk navn" }).click();
  await expect(
    picker.getByRole("button", { name: "Trekk navn" }),
  ).toBeEnabled();
  await expect(picker.locator("[data-display] > div")).toHaveCount(5);

  const name = picker.locator("[data-display] > div").first();
  const small = await fontSizePx(name);
  expect(small, `five drawn names render at ${small}px`).toBeGreaterThanOrEqual(
    15,
  );

  await picker.hover();
  await picker.getByRole("button", { name: "Vis stort" }).click();
  // Four times the card has to buy the names more than four per cent.
  await expect.poll(() => fontSizePx(name)).toBeGreaterThanOrEqual(55);
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

test("an enlarged QR code actually gets bigger — it is what the code is FOR", async ({
  page,
}) => {
  // The whole classroom value of the QR is «Vis stort»: the back row cannot
  // scan a code drawn at 115 px on a shared board, and scanning is the only
  // thing the code does. Nothing else in the tier measures it — the link
  // journeys assert that a code is DRAWN and that its quiet zone is right,
  // both of which stay true at postage-stamp size. A CSS regression in focus
  // mode (the code sizes off container queries, and the `@container` family
  // has already broken a prod build once) would leave all of that green.
  //
  // A FLOOR, not a pin: the code lands at 405 px on this viewport today, from
  // 115 on the ordinary card. 340 is where «scannable from the back» stops
  // being a claim this test defends.
  await installFixtures(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await addWidget(page, "Lenke");

  const card = page.locator('[data-widget-kind="link"]');
  // The address lives in the shell's hover row (the link journeys' pattern).
  await card.hover();
  await card.getByLabel("https://…").fill("https://sundaysuite.app");

  const qr = card.locator("svg[data-qr]");
  // `toBeVisible` waits for the lazy encoder chunk too, so this is a real
  // wait on the loading boundary rather than on a timeout.
  await expect(qr).toBeVisible();
  const before = (await qr.boundingBox())!;

  await card.hover();
  await card.getByRole("button", { name: "Vis stort" }).click();
  await expect
    .poll(async () => (await qr.boundingBox())!.height)
    .toBeGreaterThanOrEqual(340);

  const after = (await qr.boundingBox())!;
  // SQUARE, and grown. A code stretched on one axis still passes a height
  // floor and does not scan — the modules have to stay modules.
  expect(after.width).toBeCloseTo(after.height, 0);
  expect(after.height).toBeGreaterThan(before.height * 2);

  // …and it still fits the card it grew into: a code cropped by the card edge
  // loses its quiet zone, which is exactly the failure that reads as «the
  // scanner is broken» from the back of the room.
  await assertContained(
    after,
    (await card.boundingBox())!,
    "the enlarged code",
  );
});

test("an enlarged picture actually gets bigger", async ({ page }) => {
  // «Vis stort» on a picture is how a class photograph, a map or a diagram
  // gets read from the back — the same journey the die and the timer have,
  // and the picture card had none. The fixture backend answers with a 1×1
  // PNG, so what is measured here is the BOX the layout gives the picture,
  // which is the half a CSS regression would take away.
  //
  // A FLOOR, not a pin: the box lands at 561 px today, from 243 on the
  // ordinary card.
  await installFixtures(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await addWidget(page, "Bilde");

  const card = page.locator('[data-widget-kind="image"]');
  await card.getByRole("button", { name: "Velg bilde …" }).click();
  const img = card.locator("img");
  await expect(img).toBeVisible();
  const before = (await img.boundingBox())!;

  await card.hover();
  await card.getByRole("button", { name: "Vis stort" }).click();
  await expect
    .poll(async () => (await img.boundingBox())!.height)
    .toBeGreaterThanOrEqual(460);

  const after = (await img.boundingBox())!;
  expect(after.height).toBeGreaterThan(before.height * 1.8);
  // `min-height: 0` on the picture is what lets it take the card's height
  // instead of pushing the caption off the bottom edge — so containment is
  // the assertion that keeps that line honest at the size it matters.
  await assertContained(
    after,
    (await card.boundingBox())!,
    "the enlarged picture",
  );
});
