import { expect, test, type Locator, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// «VIS STORT» — one card fills the board for as long as the class needs it.
//
// The mode is deliberately THIN: one signal swaps one rect, the board behind
// is set aside under a scrim, and nothing about it reaches the disk. These
// journeys are what keeps it thin — a focus that quietly moved a card, wrote
// a z, or survived a restart would be a layout feature wearing a view's
// clothes.
//
// Every locator is scoped to its widget. The cards behind the scrim keep
// their own «Vis stort»/«Fjern» buttons, so a page-level by-name lookup is
// ambiguous the moment a journey puts two cards on the board.

/**
 * Let the browser tier reach the FULLSCREEN rung of the Escape chain.
 *
 * `window_set_fullscreen` is a write with no typed fallback: outside Tauri
 * there is no window to resize, so it REJECTS and `toggleFullscreen` returns
 * without flipping the signal. Call AFTER `installFixtures` — init scripts
 * run in the order they were added, so this one finds the map already there.
 * (The twin in chrome.spec.ts is deliberately not imported: importing a spec
 * file registers its tests a second time.)
 */
async function allowFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as Record<string, Record<string, unknown>>
    ).__SUNDAYSCREEN_FIXTURES__.window_set_fullscreen = () => undefined;
  });
}

/**
 * The card's width, POLLED.
 *
 * The growth is a 220 ms transition, so a bare `boundingBox()` right after
 * the click reads a frame somewhere in the middle of it — a number that is
 * neither the small size nor the large one, and a different number every run.
 */
function widthOf(card: Locator): Promise<number> {
  return card.boundingBox().then((b) => Math.round(b!.width));
}

/** The width a focused card SETTLES at: the surface less 24 px of margin on
 *  each side. Polling for this exact number is what makes a following
 *  `boundingBox()` read the finished box rather than an animation frame —
 *  "it got bigger" is already true a third of the way through. */
function focusWidth(page: Page): number {
  return page.viewportSize()!.width - 48;
}

test("«Vis stort» fills the board, and the scrim puts the card back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  const small = (await clock.boundingBox())!;
  const vp = page.viewportSize()!;

  await clock.hover();
  await clock.getByRole("button", { name: "Vis stort" }).click();

  // The card is the board now: 24 px of air at the sides, and the bottom
  // band left for the toolbar. Polled — see `widthOf`.
  await expect.poll(() => widthOf(clock)).toBe(focusWidth(page));
  const big = (await clock.boundingBox())!;
  expect(Math.round(big.x)).toBe(24);
  expect(Math.round(big.y)).toBe(24);
  // …and it clears the chrome band at the bottom (--chrome-clearance: 84px).
  expect(Math.round(vp.height - (big.y + big.height))).toBe(84);

  // The scrim is the way out — and it is a real control, not a wash: with
  // dragging frozen, clicking a card behind the big one does nothing at all,
  // so the board would otherwise be a dead surface with one small button on
  // it. Clicked in the top-left margin, which is scrim and not card.
  await page
    .getByRole("button", { name: "Avslutt stor visning" })
    .click({ position: { x: 10, y: 10 } });

  await expect.poll(() => widthOf(clock)).toBe(Math.round(small.width));
  const back = (await clock.boundingBox())!;
  expect(Math.round(back.x)).toBe(Math.round(small.x));
  expect(Math.round(back.y)).toBe(Math.round(small.y));
  await expect(
    page.getByRole("button", { name: "Avslutt stor visning" }),
  ).toHaveCount(0);
});

test("Escape shrinks the card BEFORE it leaves fullscreen", async ({
  page,
}) => {
  await installFixtures(page);
  await allowFullscreen(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  // `exact` on both: the accessible-name match is a SUBSTRING one and
  // «Fullskjerm» is a prefix of «Avslutt fullskjerm».
  const enterFs = page.getByRole("button", { name: "Fullskjerm", exact: true });
  const exitFs = page.getByRole("button", {
    name: "Avslutt fullskjerm",
    exact: true,
  });
  await enterFs.click();
  await expect(exitFs).toHaveAttribute("aria-pressed", "true");

  const clock = page.locator('[data-widget-kind="clock"]');
  const small = (await clock.boundingBox())!;
  await clock.hover();
  await clock.getByRole("button", { name: "Vis stort" }).click();
  await expect
    .poll(() => widthOf(clock))
    .toBeGreaterThan(Math.round(small.width) + 200);

  // ONE layer per press: the enlarged card goes first, and the projector
  // view — which the whole class is looking at — stays.
  await page.keyboard.press("Escape");
  await expect.poll(() => widthOf(clock)).toBe(Math.round(small.width));
  await expect(exitFs).toHaveAttribute("aria-pressed", "true");

  // …and the NEXT press is the one that leaves fullscreen.
  await page.keyboard.press("Escape");
  await expect(enterFs).toBeVisible();
});

test("a menu opened over the big card closes first", async ({ page }) => {
  await installFixtures(page);
  // Frozen time: the toolbar's four-second idle clock must not slide the add
  // menu's own trigger away mid-journey.
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  const text = page.locator('[data-widget-kind="text"]');
  const small = (await text.boundingBox())!;
  await text.hover();
  await text.getByRole("button", { name: "Vis stort" }).click();
  await expect
    .poll(() => widthOf(text))
    .toBeGreaterThan(Math.round(small.width) + 200);

  // The menu is drawn ON TOP of the enlarged card. An Escape that shrank the
  // card and left the menu standing would be the missing-overlay bug again,
  // one rung further in.
  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toHaveCount(0);
  expect(await widthOf(text)).toBeGreaterThan(Math.round(small.width) + 200);

  await page.keyboard.press("Escape");
  await expect.poll(() => widthOf(text)).toBe(Math.round(small.width));
});

test("dragging and resizing are inert in focus — and nothing is written", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  const before = (await clock.boundingBox())!;
  await clock.hover();
  await clock.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => widthOf(clock)).toBe(focusWidth(page));
  const big = (await clock.boundingBox())!;

  // Haul the card the way a teacher would. It must not budge: the guard sits
  // AHEAD of `bringToFront`, so the press neither drags nor raises. Without
  // it the card would collapse to its stored size under the finger and the
  // pointerup would commit a move nobody saw.
  const grabX = big.x + big.width / 2;
  const grabY = big.y + 40;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 220, grabY + 140, { steps: 8 });
  await page.mouse.up();

  const after = (await clock.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(big.x));
  expect(Math.round(after.y)).toBe(Math.round(big.y));
  expect(Math.round(after.width)).toBe(Math.round(big.width));

  // The resize handle is not even offered while the card is a view.
  await expect(
    clock.getByRole("button", { name: "Endre størrelse" }),
  ).toHaveCount(0);

  await clock.getByRole("button", { name: "Tilbake til tavla" }).click();
  await expect.poll(() => widthOf(clock)).toBe(Math.round(before.width));
  const restored = (await clock.boundingBox())!;
  expect(Math.round(restored.x)).toBe(Math.round(before.x));
  expect(Math.round(restored.y)).toBe(Math.round(before.y));

  // The proof that no write happened at all: a restart reads the STORE, and
  // it comes back to the rect the card had before any of this.
  await page.reload();
  const reloaded = (await page
    .locator('[data-widget-kind="clock"]')
    .boundingBox())!;
  expect(Math.abs(reloaded.x - before.x)).toBeLessThan(2);
  expect(Math.abs(reloaded.y - before.y)).toBeLessThan(2);
  expect(Math.abs(reloaded.width - before.width)).toBeLessThan(2);
});

test("«Fjern» and «Dupliser» step aside while the card is large", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  const del = clock.getByRole("button", { name: "Fjern" });
  const dup = clock.getByRole("button", { name: "Dupliser" });

  await clock.hover();
  await expect(del).toBeVisible();
  await expect(dup).toBeVisible();

  await clock.getByRole("button", { name: "Vis stort" }).click();
  // The pointer is still on the card — these are gone because the COMMANDS
  // are gone, not because the hover lapsed. Deleting mid-countdown is the
  // one that matters: Undo restores the widget, never the running clock.
  await expect(del).toHaveCount(0);
  await expect(dup).toHaveCount(0);

  await clock.getByRole("button", { name: "Tilbake til tavla" }).click();
  await clock.hover();
  await expect(del).toBeVisible();
  await expect(dup).toBeVisible();
});

test("the new button fits even the narrowest card", async ({ page }) => {
  // «Vis stort» added a THIRD button to the top edge, and the traffic light's
  // floor is 120 px wide against the row's 124 px — four pixels the card's
  // own `overflow: hidden` would have taken off the left of the new control,
  // at exactly the size a teacher shrinks it to when it shares the board.
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addWidget(page, "Trafikklys");

  const light = page.locator('[data-widget-kind="trafficlight"]');
  await light.hover();
  const handle = (await light
    .getByRole("button", { name: "Endre størrelse" })
    .boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x - 700, handle.y - 700, { steps: 6 });
  await page.mouse.up();

  const card = (await light.boundingBox())!;
  expect(Math.round(card.width)).toBe(120);

  await light.hover();
  for (const name of ["Vis stort", "Dupliser", "Fjern"]) {
    const box = (await light.getByRole("button", { name }).boundingBox())!;
    expect(
      box.x,
      `${name} overhangs the card's left edge`,
    ).toBeGreaterThanOrEqual(card.x - 0.5);
    expect(
      box.x + box.width,
      `${name} overhangs the card's right edge`,
    ).toBeLessThanOrEqual(card.x + card.width + 0.5);
  }
});

test("«ett minutt til» still works on the enlarged timer", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tidtaker");

  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("04:00")).toBeVisible();

  await timer.hover();
  await timer.getByRole("button", { name: "Vis stort" }).click();

  // THE scenario the mode exists for: a test is running, the class is
  // watching the digits, and the teacher gives them another minute. The
  // settings row stays one hover away — pinning it visible would print a
  // button bar across the number everyone is reading.
  await timer.hover();
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await expect(timer.getByText("05:00")).toBeVisible();
  await timer.getByRole("button", { name: "Ett minutt mindre" }).click();
  await expect(timer.getByText("04:00")).toBeVisible();

  // …and it is still the same countdown, not a restarted one.
  await page.clock.fastForward(30_000);
  await expect(timer.getByText("03:30")).toBeVisible();
});
