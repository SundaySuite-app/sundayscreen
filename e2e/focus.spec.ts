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

/**
 * The scrim, by its own hook rather than by name.
 *
 * The scrim and the enlarged card's collapse button say the SAME sentence —
 * «Avslutt stor visning» is the name of the command, and both of them are it.
 * So a page-level by-name lookup matches two elements and fails Playwright's
 * strict mode; `data-focus-scrim` is the one that is the board.
 */
function scrimOf(page: Page): Locator {
  return page.locator("[data-focus-scrim]");
}

/** Who actually receives a press at the middle of `target` — the element
 *  itself, or something lying over it. Returns the covering element's
 *  description, or null when the target owns its own middle. */
function coveredBy(target: Locator): Promise<string | null> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2,
    );
    if (!hit || el.contains(hit)) return null;
    const owner = hit.closest("button, [class]") ?? hit;
    return `${owner.tagName}[${owner.getAttribute("aria-label") ?? owner.className}]`;
  });
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
  // it. Clicked in the BAND under the card (the chrome clearance), well clear
  // of both the card's edge and the centred toolbar: a press within 16 px of
  // the card is a miss, not an exit — see the edge journey further down.
  await page.mouse.click(40, big.y + big.height + 40);

  await expect.poll(() => widthOf(clock)).toBe(Math.round(small.width));
  const back = (await clock.boundingBox())!;
  expect(Math.round(back.x)).toBe(Math.round(small.x));
  expect(Math.round(back.y)).toBe(Math.round(small.y));
  await expect(scrimOf(page)).toHaveCount(0);
});

test("a press at the enlarged card's edge is a MISS, not an exit", async ({
  page,
}) => {
  // The settings row stops `--sp-2` above the card's bottom edge, so the
  // eight pixels under «Lydvarsel» are scrim — and they used to collapse the
  // view in front of the class. The scrim lies UNDER the card, so a click it
  // receives is by definition outside the card: a press "on the edge" is
  // always a missed press, never a considered one.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tidtaker");

  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();
  await timer.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => widthOf(timer)).toBe(focusWidth(page));
  const big = (await timer.boundingBox())!;

  // Eight pixels under the bottom edge — the aim that misses the settings row.
  await page.mouse.click(big.x + big.width / 2, big.y + big.height + 8);
  expect(await widthOf(timer)).toBe(focusWidth(page));
  await expect(scrimOf(page)).toHaveCount(1);

  // Sixteen is the far side of the halo, and one pixel past it is the board
  // again — the mode is still leaveable by aiming at the board rather than at
  // the card.
  await page.mouse.click(40, big.y + big.height + 17);
  await expect.poll(() => widthOf(timer)).toBeLessThan(focusWidth(page));
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

  await clock.getByRole("button", { name: "Avslutt stor visning" }).click();
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

  await clock.getByRole("button", { name: "Avslutt stor visning" }).click();
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

// ── What else is on the screen while a card is large ───────────────────────
//
// The mode puts one card where the whole board was, and everything the shell
// anchors to an EDGE keeps its own coordinates. Three of them landed on the
// enlarged card's own controls, and each one was invisible in review and
// obvious under `elementFromPoint`.

test("the undo bar stays off the enlarged card's settings row", async ({
  page,
}) => {
  // The worst of the three (R4-funn F1). The bar is centred on
  // `--chrome-clearance`, and that clearance IS where the enlarged card's
  // bottom edge is cut — so the bar sat on the settings row, at `--z-toast`,
  // and every control in it belonged to the snackbar. «Lydvarsel» hit
  // «Angre»: reaching for the chime toggle put back the card she had just
  // deleted.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Klokke");
  await addWidget(page, "Tidtaker");

  const clock = page.locator('[data-widget-kind="clock"]');
  await clock.hover();
  await clock.getByRole("button", { name: "Fjern" }).click();
  const undo = page.getByRole("button", { name: "Angre" });
  await expect(undo).toBeVisible();

  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();
  await timer.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => widthOf(timer)).toBe(focusWidth(page));
  // The row is hover-revealed, and `visibility: hidden` is not hit-testable —
  // so the measurement below is only meaningful with the pointer on the card.
  await timer.hover();

  const row = timer.locator("[data-settings-row] button");
  const owners = await row.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return {
        label: el.getAttribute("aria-label") ?? el.textContent,
        covered:
          hit && !el.contains(hit)
            ? (hit.closest("button")?.textContent ?? hit.tagName)
            : null,
      };
    }),
  );
  // Eight controls in the idle countdown row: five presets, two modes, sound.
  expect(owners).toHaveLength(8);
  for (const o of owners) {
    expect(o.covered, `«${o.label}» is covered by «${o.covered}»`).toBeNull();
  }

  // …and the bar is still a bar: «Angre» is where a press reaches it.
  expect(await coveredBy(undo)).toBeNull();
  await undo.click();
  await expect(clock).toHaveCount(1);
});

test("a toast keeps clear of the enlarged card's collapse button", async ({
  page,
}) => {
  // The stack is pinned to the window's top-right, which is exactly where the
  // enlarged card's ONE control lives (R4-funn F7) — and error toasts used to
  // stay for the rest of the day, so one failed draw at 09:12 owned that
  // corner until the machine was restarted.
  await installFixtures(page, { memberNames: ["Ada", "Bo", "Cato"] });
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.addInitScript(() => {
    (
      window as unknown as Record<string, Record<string, unknown>>
    ).__SUNDAYSCREEN_FIXTURES__.picker_draw_many = () => {
      throw new Error("picker_draw_many: database is locked");
    };
  });
  await page.goto("/");
  await addWidget(page, "Navnetrekker");

  const picker = page.locator('[data-widget-kind="namepicker"]');
  await picker.getByRole("button", { name: "Trekk navn" }).click();
  const toast = page.getByText("Noe gikk galt — prøv igjen.");
  await expect(toast).toBeVisible();

  await picker.hover();
  await picker.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => widthOf(picker)).toBe(focusWidth(page));
  await picker.hover();

  const collapse = picker.getByRole("button", {
    name: "Avslutt stor visning",
  });
  await expect(collapse).toBeVisible();
  expect(await coveredBy(collapse)).toBeNull();

  // It is a RECEIPT, not a state — the states live in the shell's chip. Six
  // seconds in it is still readable (an error gets twice the ordinary life);
  // twelve seconds in the corner is the board's again.
  await page.clock.fastForward(6_000);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(6_500);
  await expect(toast).toHaveCount(0);
});

test("the collapse button takes the corner the other two left", async ({
  page,
}) => {
  // `.focus` is positioned THIRD from the right edge because «Fjern» and
  // «Dupliser» stand beside it. Both are `display: none` in this mode, and
  // the survivor kept the gap: measured 89 px in from the corner of a card
  // that fills the board (R4-funn F15).
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  await clock.hover();
  await clock.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => widthOf(clock)).toBe(focusWidth(page));

  const card = (await clock.boundingBox())!;
  const btn = (await clock
    .getByRole("button", { name: "Avslutt stor visning" })
    .boundingBox())!;
  // `--sp-2` in from the card's right edge — the corner «Fjern» had. Nine,
  // not eight: `boundingBox` measures the BORDER box and the card has a 1px
  // border, which is also why the finding measured 89 rather than 88.
  expect(Math.round(card.x + card.width - (btn.x + btn.width))).toBe(9);
  expect(Math.round(btn.y - card.y)).toBe(9);

  // …and on the way back it is third from the corner again, because the two
  // it stepped into the place of are back beside it.
  await clock.getByRole("button", { name: "Avslutt stor visning" }).click();
  await expect.poll(() => widthOf(clock)).toBeLessThan(focusWidth(page));
  await clock.hover();
  const small = (await clock.boundingBox())!;
  const back = (await clock
    .getByRole("button", { name: "Vis stort" })
    .boundingBox())!;
  expect(Math.round(small.x + small.width - (back.x + back.width))).toBe(89);
});

test("adding a tool while a card is enlarged delivers a VISIBLE card", async ({
  page,
}) => {
  // A new widget is born at `nextZ()` — z ≈ 2 on a small board — while the
  // scrim sits at 40 and the enlarged card at 41 (R4-funn F3). So «Legg til
  // verktøy» landed a card that was 100 % hidden, with nothing on screen to
  // say anything had happened, and the teacher pressed it again.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  await clock.hover();
  await clock.getByRole("button", { name: "Vis stort" }).click();
  await expect.poll(() => widthOf(clock)).toBe(focusWidth(page));

  await addWidget(page, "Tidtaker");

  // The view is over — the board is a board again …
  await expect(scrimOf(page)).toHaveCount(0);
  await expect.poll(() => widthOf(clock)).toBeLessThan(focusWidth(page));

  // … and the card that was asked for is on the board, selected, and takes a
  // press in its own middle rather than handing it to a scrim.
  const timer = page.locator('[data-widget-kind="timer"]');
  await expect(timer).toHaveCount(1);
  await expect(timer).toHaveAttribute("data-selected", "true");
  expect(await coveredBy(timer)).toBeNull();
});
