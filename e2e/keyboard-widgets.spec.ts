import { expect, test, type Locator, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// THE BOARD WITHOUT A MOUSE (R7-funn 1, WCAG 2.1.1).
//
// A teacher could add, copy, delete and enlarge a card from the keyboard and
// never PLACE one — and «Endre størrelse» was focusable, announced, and did
// nothing at all, which is worse than a missing control: it is a promise the
// button could not keep. These journeys are the promise, kept.
//
// Two things they pin that a unit test cannot see. The card is a TAB STOP at
// all — every piece of its chrome is `visibility: hidden` until the card is
// hovered, selected or `:focus-within`, and hidden is not focusable, so on a
// clock there was no key sequence that reached anything. And the WRITE
// BUDGET: an arrow press commits through the debounced door, so holding a key
// down is one `layout_save`, not one per repeat.

/** The px step one arrow press takes: `NUDGE_FRACTION` (1 %) of the surface's
 *  own axis. The surface is the whole viewport here. */
function step(page: Page, axis: "w" | "h"): number {
  const size = page.viewportSize()!;
  return (axis === "w" ? size.width : size.height) * 0.01;
}

/** Count every `layout_save` the page makes. Registered AFTER
 *  `installFixtures` on purpose — init scripts run in the order they were
 *  added, so this one finds the fixture map already installed and wraps the
 *  real handler rather than replacing it. */
async function countSaves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __SUNDAYSCREEN_FIXTURES__: Record<string, unknown>;
      __layoutSaves: number;
    };
    const real = w.__SUNDAYSCREEN_FIXTURES__.layout_save as (
      args?: Record<string, unknown>,
    ) => unknown;
    w.__layoutSaves = 0;
    w.__SUNDAYSCREEN_FIXTURES__.layout_save = (
      args?: Record<string, unknown>,
    ) => {
      w.__layoutSaves += 1;
      return real(args);
    };
  });
}

const savesSoFar = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __layoutSaves: number }).__layoutSaves,
  );

/** Put the keyboard on the card itself — the door every kind has. */
async function focusCard(card: Locator): Promise<void> {
  await card.focus();
  await expect(card).toBeFocused();
}

test("arrow keys move a card, and the move survives a restart", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const card = page.locator('[data-widget-kind="text"]');
  const before = (await card.boundingBox())!;
  await focusCard(card);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");

  const after = (await card.boundingBox())!;
  // Two steps right, one down — exact, because a nudge is an amount the
  // teacher asked for and nothing snaps it.
  expect(after.x - before.x).toBeCloseTo(2 * step(page, "w"), 0);
  expect(after.y - before.y).toBeCloseTo(step(page, "h"), 0);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);

  // The debounced write has to have landed before the reload — that is the
  // whole point of `flushPending`/`SAVE_DEBOUNCE_MS` being real numbers.
  await page.waitForTimeout(800);
  await page.reload();
  const restored = (await page
    .locator('[data-widget-kind="text"]')
    .boundingBox())!;
  expect(Math.abs(restored.x - after.x)).toBeLessThan(2);
  expect(Math.abs(restored.y - after.y)).toBeLessThan(2);
});

test("Shift is a bigger step, and the board's edge still holds", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const card = page.locator('[data-widget-kind="clock"]');
  await focusCard(card);
  const before = (await card.boundingBox())!;

  await page.keyboard.press("Shift+ArrowRight");
  const coarse = (await card.boundingBox())!;
  expect(coarse.x - before.x).toBeCloseTo(10 * step(page, "w"), 0);

  // …and held down, the card stops AT the edge rather than walking off it.
  for (let i = 0; i < 30; i++) await page.keyboard.press("Shift+ArrowRight");
  const surface = (await page
    .locator("[data-wall] > [data-theme]")
    .boundingBox())!;
  const pinned = (await card.boundingBox())!;
  expect(pinned.x + pinned.width).toBeLessThanOrEqual(
    surface.x + surface.width + 1,
  );
});

test("«Endre størrelse» keeps its promise: the arrows scale the card", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const card = page.locator('[data-widget-kind="text"]');
  // The handle is `visibility: hidden` until something reveals it, and hidden
  // is not focusable — the card's own tab stop is what reveals it
  // (`:focus-within`), which is exactly the bootstrap that was missing.
  await focusCard(card);
  const handle = card.getByRole("button", { name: "Endre størrelse" });
  await handle.focus();
  await expect(handle).toBeFocused();

  const before = (await card.boundingBox())!;
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const grown = (await card.boundingBox())!;

  expect(grown.width - before.width).toBeCloseTo(2 * step(page, "w"), 0);
  expect(grown.height - before.height).toBeCloseTo(step(page, "h"), 0);
  // The SE corner moves; the NW one does not — the same corner the pointer
  // drags, so the two gestures cannot disagree about which edges are hers.
  expect(grown.x).toBeCloseTo(before.x, 0);
  expect(grown.y).toBeCloseTo(before.y, 0);

  await page.waitForTimeout(800);
  await page.reload();
  const restored = (await page
    .locator('[data-widget-kind="text"]')
    .boundingBox())!;
  expect(Math.abs(restored.width - grown.width)).toBeLessThan(2);
  expect(Math.abs(restored.height - grown.height)).toBeLessThan(2);
});

test("a whole key sequence is ONE save, not one per press", async ({
  page,
}) => {
  await installFixtures(page);
  await countSaves(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const card = page.locator('[data-widget-kind="text"]');
  await focusCard(card);
  // Let the add's own immediate save settle before the measurement starts.
  await page.waitForTimeout(800);
  const baseline = await savesSoFar(page);

  // Ten presses in a burst — a held arrow key, in other words. Through
  // `saveNow` this was ten replace-alls of the whole scene.
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);

  expect(await savesSoFar(page)).toBe(baseline + 1);
});

test("a text field keeps its own arrows while she is writing", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const card = page.locator('[data-widget-kind="text"]');
  await card.click();
  const editor = page.locator("textarea");
  await expect(editor).toHaveCount(1);
  await editor.fill("Prøve i morgen");
  const before = (await card.boundingBox())!;

  // The caret moves; the card does not. A board that slides under a teacher
  // halfway through a sentence is the reason this is a test and not a note.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(700);

  const after = (await card.boundingBox())!;
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  await expect(editor).toHaveValue("Prøve i morgen");
});

test("the arrows are frozen while a card is shown large", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");
  await addWidget(page, "Klokke");

  const clock = page.locator('[data-widget-kind="clock"]');
  const text = page.locator('[data-widget-kind="text"]');
  const stored = (await text.boundingBox())!;

  await clock.hover();
  await clock.getByRole("button", { name: "Vis stort" }).click();
  await expect(
    clock.getByRole("button", { name: "Avslutt stor visning" }),
  ).toBeVisible();

  // The board is a VIEW now: `frozenForFocus` refuses the pointer, and it has
  // to refuse the keys for the same reason — the enlarged card's rect on
  // screen is not its stored one, and a nudge would commit a position nobody
  // saw. The card behind is not even a tab stop while the mode is on.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-widget-kind="text"]')?.focus();
  });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);

  await page.keyboard.press("Escape");
  await expect(
    clock.getByRole("button", { name: "Avslutt stor visning" }),
  ).toHaveCount(0);
  const after = (await text.boundingBox())!;
  expect(after.x).toBeCloseTo(stored.x, 0);
  expect(after.y).toBeCloseTo(stored.y, 0);
});

test("a clock — a card whose every control is hover-revealed — is reachable", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const card = page.locator('[data-widget-kind="clock"]');
  // Before the card became a TAB STOP this was the dead end: the clock's only
  // controls live in `[data-settings-row]`, which is `visibility: hidden`
  // until `:focus-within` — a state no key could ever produce. So the walk
  // starts from the document, with nothing focused and nothing hovered, which
  // is the only version of this that would have failed before.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  let stops = 0;
  while (
    stops < 6 &&
    !(await card.evaluate((el) => el === document.activeElement))
  ) {
    await page.keyboard.press("Tab");
    stops += 1;
  }
  await expect(card).toBeFocused();

  // …and from there the card's own chrome is one Tab away, which is what
  // `:focus-within` was always supposed to give the keyboard.
  await page.keyboard.press("Tab");
  const reached = await page.evaluate(
    () =>
      document.activeElement?.closest('[data-widget-kind="clock"]') !== null,
  );
  expect(reached).toBe(true);
});

// ── THE RING ON THE CARD (R7-funn S2-3) ─────────────────────────────────────
//
// The card is a tab stop, and for one commit it wore Chromium's blue
// `outline: auto` instead of the house's ink-and-halo ring — base.css lists
// real controls, not `[tabindex]`, and nothing measured the card. The
// numbers below are the ones panels-a11y.spec.ts already holds a button to:
// `--focus` is rgb(35, 39, 47) and `--focus-halo` is white.

/** The card's computed ring, and whether the browser thinks the keyboard put
 *  focus there (`:focus-visible` is what every ring rule is keyed on). */
function ringOf(card: Locator) {
  return card.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      visible: el.matches(":focus-visible"),
      color: cs.outlineColor,
      outline: `${cs.outlineWidth} ${cs.outlineStyle}`,
      shadow: cs.boxShadow,
    };
  });
}

const INK = "rgb(35, 39, 47)";
const HALO = "rgb(255, 255, 255) 0px 0px 0px 5px";

test("Tab to a card paints the house's ring, and a mouse click paints none", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");
  const card = page.locator('[data-widget-kind="clock"]');

  // A real Tab from the document, not `focus()` — a programmatic focus does
  // not decide `:focus-visible` the way a key does.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (let i = 0; i < 6; i++) {
    if (await card.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(card).toBeFocused();

  let ring = await ringOf(card);
  expect(ring.visible).toBe(true);
  // `2px solid`, never `auto`: the UA ring is `outline: auto`, and a check
  // for «some outline» would have been green with the bug.
  expect(ring.outline).toBe("2px solid");
  expect(ring.color).toBe(INK);
  expect(ring.shadow).toContain(HALO);

  // A click selects the card and moves focus to it — `:focus-visible` says
  // the mouse did it, so no ring, exactly as on a button. Focus is taken OFF
  // the card first: Chromium only re-decides `:focus-visible` when focus
  // actually moves, and a click on the already-focused card moves nothing.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect(card).toBeFocused();
  ring = await ringOf(card);
  expect(ring.visible).toBe(false);
  expect(ring.outline).toContain("none");
  expect(ring.shadow).not.toContain(HALO);
});

test("click, then arrow: the SELECTED card wears both halves of the ring", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Klokke");
  const card = page.locator('[data-widget-kind="clock"]');

  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect(card).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowRight");

  // The key flips `:focus-visible` on — and this is the state in which a
  // rule in base.css alone would have lost the halo: `.shell[data-selected]`
  // owns box-shadow at a higher specificity than `:where(…):focus-visible`.
  const ring = await ringOf(card);
  expect(ring.visible).toBe(true);
  expect(ring.outline).toBe("2px solid");
  expect(ring.color).toBe(INK);
  expect(ring.shadow).toContain(HALO);
  // …and the card's own raised shadow is still under the halo, not replaced
  // by it — the selected card must not go flat the moment a key is pressed.
  expect(ring.shadow).toContain("rgba(35, 39, 47, 0.16)");
});

// ── THE ARROWS LAND (R7-funn S3-3) ──────────────────────────────────────────
//
// The nudge had only the streaming half of the commit contract
// (app/ui/commit.ts): one key sequence, one debounced `layout_save` — and a
// quit inside the 500 ms window took the whole sequence with it. Leaving the
// card, and Escape, now land it AT ONCE. Two things are pinned per journey:
// the position survives a reload started before the debounce could fire, and
// the landing IS the one write — the timer is cancelled, not joined.

/** Tab forward until focus is outside `card` — through «Vis stort»,
 *  «Dupliser», «Fjern», the settings row and the handle, every one of which
 *  is a move INSIDE the card and must not land anything. */
async function tabOutOf(page: Page, card: Locator): Promise<void> {
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    const inside = await card.evaluate((el) =>
      el.contains(document.activeElement),
    );
    if (!inside) return;
  }
  throw new Error("Tab never left the card");
}

test("leaving the card lands the nudge: Tab out, reload at once, position kept", async ({
  page,
}) => {
  await installFixtures(page);
  await countSaves(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const card = page.locator('[data-widget-kind="text"]');
  await focusCard(card);
  await page.waitForTimeout(800);
  const baseline = await savesSoFar(page);
  const before = (await card.boundingBox())!;

  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  // Nothing has been written yet — that is the debounce doing its job.
  expect(await savesSoFar(page)).toBe(baseline);
  const after = (await card.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(10 * step(page, "w"), 0);

  await tabOutOf(page, card);
  // The landing is synchronous with the focus change — one write, and the
  // budget «ten presses = one save» still holds because the timer is
  // cancelled by it rather than firing on top of it.
  expect(await savesSoFar(page)).toBe(baseline + 1);

  // Reload NOW, well inside the 500 ms the debounce would still have needed.
  await page.reload();
  const restored = (await page
    .locator('[data-widget-kind="text"]')
    .boundingBox())!;
  expect(Math.abs(restored.x - after.x)).toBeLessThan(2);
  expect(Math.abs(restored.y - after.y)).toBeLessThan(2);
});

test("Tab from the card to its own chrome lands NOTHING — that is a move inside it", async ({
  page,
}) => {
  await installFixtures(page);
  await countSaves(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const card = page.locator('[data-widget-kind="text"]');
  await focusCard(card);
  await page.waitForTimeout(800);
  const baseline = await savesSoFar(page);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  const inside = await card.evaluate((el) =>
    el.contains(document.activeElement),
  );
  expect(inside).toBe(true);
  // Still streaming: the write waits for the timer, as it should while the
  // keyboard is anywhere in the card.
  expect(await savesSoFar(page)).toBe(baseline);
  await page.waitForTimeout(900);
  expect(await savesSoFar(page)).toBe(baseline + 1);
});

test("Escape on the card lands the nudge and still leaves the ladder alone", async ({
  page,
}) => {
  await installFixtures(page);
  await countSaves(page);
  await page.goto("/");
  await addWidget(page, "Klokke");

  const card = page.locator('[data-widget-kind="clock"]');
  await focusCard(card);
  await page.waitForTimeout(800);
  const baseline = await savesSoFar(page);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const after = (await card.boundingBox())!;
  expect(await savesSoFar(page)).toBe(baseline);

  await page.keyboard.press("Escape");
  expect(await savesSoFar(page)).toBe(baseline + 1);
  // Escape is not consumed by the card: with nothing above it the ladder has
  // no rung to peel, so focus stays exactly where it was.
  await expect(card).toBeFocused();

  await page.reload();
  const restored = (await page
    .locator('[data-widget-kind="clock"]')
    .boundingBox())!;
  expect(Math.abs(restored.y - after.y)).toBeLessThan(2);

  // …and no second write arrives from a timer that should have been cancelled.
  await page.waitForTimeout(900);
});
