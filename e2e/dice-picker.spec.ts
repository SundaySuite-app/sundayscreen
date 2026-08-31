import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// THE APPEARANCE PANEL, REACHED WITHOUT A MOUSE.
//
// R5 merged three knobs into one panel and made it the ONLY route to the die
// type. That is a good trade on the card — three buttons, one line — and it
// quietly made a keyboard journey eleven Tab stops long: the panel is a
// SIBLING of the surface (the screen layer owns the box, see
// `WidgetOverlay.tsx`), so document order puts it after the card's own
// chrome, after the whole toolbar and after the host's dismiss backdrop.
// Measured before the fix, with this file's own counter:
//
//   0  Utseende (the trigger)   4  Endre størrelse   8  Bytt klasse
//   1  Vis stort                5  Legg til verktøy  9  Fullskjerm
//   2  Dupliser                 6  (toolbar)        10  Lukk (the backdrop)
//   3  Fjern                    7  Bytt skjerm      11  D4  ← the first pill
//
// After: 0. The panel moves the keyboard in itself when it opens and returns
// it to the trigger when it closes, so the ladder above is what the counter
// would climb again the day that stops working.
//
// Nothing in the unit tier can see that number. `dice-core.test.ts` proves
// which types exist and `die-*-core.test.ts` prove the bodies; document order
// across three components and a host is only observable in a rendered page,
// which is why the assertion lives here rather than there.
//
// ⚠️ Kept OUT of `dice.spec.ts` on purpose: that file is about the die as an
// object in the room (the throw, the trackball, the architecture locks on
// `transform`). This one is about the panel as a control surface, and the two
// have no assertions in common.

/** How many Tab presses it takes before the keyboard is inside the panel.
 *  `Infinity` when it never gets there — a number, so the failure message
 *  carries the count rather than a timeout. */
async function tabsIntoPanel(page: Page, max = 25): Promise<number> {
  const inside = () =>
    page.evaluate(
      () => !!document.activeElement?.closest("[data-widget-overlay]"),
    );
  for (let i = 0; i <= max; i++) {
    if (await inside()) return i;
    await page.keyboard.press("Tab");
  }
  return Infinity;
}

/** Put the keyboard on the die's appearance trigger and open the panel with
 *  it. The card must be hovered first — the settings row is
 *  `visibility: hidden` otherwise, and hidden is not focusable either. */
async function openLookByKeyboard(page: Page) {
  const dice = page.locator('[data-widget-kind="dice"]');
  await dice.hover();
  const trigger = dice.locator("[data-dice-look]");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.locator("[data-widget-overlay]");
  await expect(panel).toBeVisible();
  return { dice, trigger, panel };
}

test("the panel takes the keyboard with it, and Escape hands it back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const { trigger, panel } = await openLookByKeyboard(page);

  // The whole finding, as one number. Zero is what the fix produces; the
  // assertion allows one so that moving the landing spot to the panel root
  // with `tabindex="-1"` stays a legal implementation choice rather than a
  // test to edit.
  const stops = await tabsIntoPanel(page);
  expect(
    stops,
    `the keyboard was still outside the panel after ${stops} Tab presses`,
  ).toBeLessThanOrEqual(1);

  // …and it lands on a CONTROL, not on the box: the first type pill, which is
  // where the eye starts and the knob the panel is now the only route to.
  await expect(panel.locator('[data-die-faces="4"]')).toBeFocused();

  // The way back. A panel that swallows the keyboard and drops it on <body>
  // when it closes is a worse trap than the eleven stops were — the teacher
  // would have to Tab in from the top of the board to get anywhere.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // And the returned focus is a working one: the same key opens it again.
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-widget-overlay]")).toBeVisible();
});

test("the backdrop closes it and still hands the keyboard back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const { trigger } = await openLookByKeyboard(page);

  // The host's dismiss layer is a real button with its own accessible name,
  // so «click outside» is a keyboard route too — and it must land the
  // keyboard in the same place Escape does.
  await page.getByRole("button", { name: "Lukk", exact: true }).click();
  await expect(page.locator("[data-widget-overlay]")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the panel and its sections have three different names", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const { panel } = await openLookByKeyboard(page);

  // The panel is «Utseende» — the same word the trigger says, which is what
  // makes the trigger's promise true.
  await expect(page.getByRole("menu", { name: "Utseende" })).toHaveCount(1);
  // …and NO group repeats it. A screen reader used to read «Utseende, meny …
  // Utseende, gruppe» on the way in: two different scopes wearing one word,
  // with no way to tell which one had just been entered.
  await expect(page.getByRole("group", { name: "Utseende" })).toHaveCount(0);
  for (const name of ["Terningtype", "Farge", "Materiale"]) {
    await expect(page.getByRole("group", { name })).toHaveCount(1);
  }

  // ⚠️ And the default family is «Klassisk», not «Hvit». `layout.rs` says so
  // in as many words — `DieColor::Classic` is the warm off-white of a school
  // die, and the swatch is visibly beige — so «Hvit» was the label arguing
  // with the thing it labelled.
  await expect(panel.locator('[data-die-color="classic"]')).toHaveAttribute(
    "aria-label",
    "Klassisk",
  );
});
