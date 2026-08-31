import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The chrome: the toolbar slips away after four idle seconds, comes back
// when the pointer reaches for it, and Escape peels one layer at a time.
//
// Every auto-hide journey puts a widget on the board first: an EMPTY board
// holds the chrome open by design (4.1), so idling on one proves nothing.

test("the toolbar auto-hides on idle and the handle brings it back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  const toolbar = page.locator("footer");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");

  // Centred, and NOT by a transform of its own: the dock (a plain flex box)
  // does the centring so `position: fixed` inside the toolbar still measures
  // against the viewport. Both halves are worth an assertion — the visible
  // toolbar carries no transform, and it is still in the middle.
  const vp = page.viewportSize()!;
  const placed = await toolbar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      centre: r.left + r.width / 2,
      transform: getComputedStyle(el).transform,
    };
  });
  expect(placed.transform).toBe("none");
  expect(Math.abs(placed.centre - vp.width / 2)).toBeLessThanOrEqual(1);

  await page.clock.fastForward(6_000);
  await expect(toolbar).toHaveAttribute("data-hidden", "true");

  // It SLID away, it did not merely fade: the whole box ends up past the
  // bottom edge. (The hidden state now interpolates from `transform: none`,
  // which is the one thing dropping `translateX(-50%)` could have broken.)
  await expect
    .poll(async () => toolbar.evaluate((el) => el.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(vp.height);

  // The handle pill is the visual cue — and REACHING for it is the gesture:
  // the pointer entering the bottom zone reveals before any click could land
  // (clicking it would race its own unmount, by design).
  await expect(
    page.getByRole("button", { name: "Vis verktøylinja" }),
  ).toBeVisible();
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");
  await expect(
    page.getByRole("button", { name: "Vis verktøylinja" }),
  ).toHaveCount(0);
});

test("reaching for the bottom edge wakes the toolbar", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  const toolbar = page.locator("footer");
  await page.clock.fastForward(6_000);
  await expect(toolbar).toHaveAttribute("data-hidden", "true");

  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 5);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");
});

test("an open manage panel pins the chrome and Escape closes layers in order", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();

  // Pinned: idle time passes, the toolbar stays.
  await page.clock.fastForward(10_000);
  await expect(page.locator("footer")).not.toHaveAttribute(
    "data-hidden",
    "true",
  );

  // Escape closes the panel (one layer)…
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Lukk" })).toHaveCount(0);

  // …and with the class menu open, Escape closes THAT first.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Administrer klasser …" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "Administrer klasser …" }),
  ).toHaveCount(0);
});

test("Escape in a text field only leaves the field", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  const area = page.getByPlaceholder(/Ett navn per linje/);
  await area.click();
  await page.keyboard.press("Escape");

  // The panel is still open — only the focus left the field.
  await expect(page.getByRole("button", { name: "Lukk" })).toBeVisible();
  await expect(area).not.toBeFocused();
});

test("an open add menu pins the chrome and Escape closes it first", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  const toolbar = page.locator("footer");
  // A widget on the board, so the pin under test is the MENU's and not the
  // empty board's.
  await addWidget(page, "Tekst");
  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toBeVisible();

  // Idle does NOT hide the toolbar while its own menu is open.
  await page.clock.fastForward(6_000);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");

  // Escape peels the add menu (innermost) — the toolbar is still up.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toHaveCount(0);
  await expect(toolbar).not.toHaveAttribute("data-hidden", "true");
});

test("the add menu's backdrop is the whole viewport, and a far click closes it", async ({
  page,
}) => {
  // The third switcher on the same row, with the same `position: fixed;
  // inset: 0` dismiss layer — and it was the same 785×52 box at the bottom
  // edge while the toolbar carried a `transform`. Measured, then clicked.
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toBeVisible();

  const vp = page.viewportSize()!;
  const box = (await page
    .locator('footer button[aria-label="Lukk"]')
    .boundingBox())!;
  expect({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });

  await page.mouse.click(vp.width - 60, 60);
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toHaveCount(0);
});

test("adding from the menu closes it and lands the widget", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await page.getByRole("menuitem", { name: "Trafikklys" }).click();
  await expect(page.getByRole("menuitem", { name: "Trafikklys" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Rødt lys — stille" }),
  ).toBeVisible();
});

test("an empty board keeps the toolbar up and points the way", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  // After the splash: a title, one pointing line, one door.
  await expect(page.getByText("Tavla er tom")).toBeVisible();
  await expect(
    page.getByText("Verktøylinja ligger langs nederste kant."),
  ).toBeVisible();

  // The way forward does NOT slide off the screen four seconds later.
  await page.clock.fastForward(10_000);
  await expect(page.locator("footer")).not.toHaveAttribute(
    "data-hidden",
    "true",
  );

  // The one door opens the same menu the toolbar's button does…
  await page.getByRole("button", { name: "Velg et verktøy" }).click();
  await expect(page.getByRole("menuitem", { name: "Klokke" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Klokke" }).click();

  // …and once there is something on the board, the empty state is gone and
  // the toolbar resumes its ordinary auto-hide.
  await expect(page.getByText("Tavla er tom")).toHaveCount(0);
  await page.clock.fastForward(6_000);
  await expect(page.locator("footer")).toHaveAttribute("data-hidden", "true");
});

test("deleting the LAST widget mid-lesson brings the chrome back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  await page.clock.fastForward(6_000);
  await expect(page.locator("footer")).toHaveAttribute("data-hidden", "true");

  // Wake the chrome the way a teacher does, then remove the only card.
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  const widget = page.locator('[data-widget-kind="text"]');
  await widget.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(widget).toHaveCount(0);

  // An empty board holds the chrome open — the teacher is not left with a
  // wordless rectangle and no controls.
  await page.clock.fastForward(10_000);
  await expect(page.locator("footer")).not.toHaveAttribute(
    "data-hidden",
    "true",
  );
  await expect(page.getByText("Tavla er tom")).toBeVisible();
});

test("the empty state does not swallow the surface's deselect", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  // A click on the bare surface deselects — the empty layer is
  // pointer-events:none, so nothing changes here when it is NOT showing…
  const widget = page.locator('[data-widget-kind="text"]');
  await widget.click();
  await expect(widget).toHaveAttribute("data-selected", "true");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(widget).not.toHaveAttribute("data-selected", "true");
});

// ── The attendance panel is an OVERLAY, on the same terms as the others ─────
//
// It shipped as a popover anchored in the class switcher, carrying two local
// workarounds for what the chain did not know about it: a capture-phase
// Escape listener, and a one-second `chromeActivity` keepalive. Both are
// deleted; these two journeys are what they were standing in for.

/**
 * Let the browser tier reach the FULLSCREEN rung of the Escape chain.
 *
 * `window_set_fullscreen` is a write with no typed fallback: outside Tauri
 * there is no window to resize, so it REJECTS and `toggleFullscreen` returns
 * without flipping the signal — honest, and it means no journey here can get
 * past the layer above. Call AFTER `installFixtures`; init scripts run in the
 * order they were added, so this one finds the map already there.
 */
async function allowFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as Record<string, Record<string, unknown>>
    ).__SUNDAYSCREEN_FIXTURES__.window_set_fullscreen = () => undefined;
  });
}

test("Escape closes the attendance panel and stays in fullscreen", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await allowFullscreen(page);
  await page.goto("/");

  // Fullscreen first — this is the failure the missing `overlayOpen` term
  // caused: Escape read "nothing is open", turned the projector view OFF and
  // left the panel standing.
  // `exact` on both names, because the accessible-name match is a SUBSTRING
  // one and «Fullskjerm» is a prefix of «Avslutt fullskjerm» — without it the
  // locator matches whichever state the button is in and asserts nothing.
  const enterFs = page.getByRole("button", { name: "Fullskjerm", exact: true });
  const exitFs = page.getByRole("button", {
    name: "Avslutt fullskjerm",
    exact: true,
  });
  await enterFs.click();
  await expect(exitFs).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Hvem er her i dag?" }).click();
  const panel = page.getByRole("region", { name: "Hvem er her i dag?" });
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(exitFs).toHaveAttribute("aria-pressed", "true");

  // …and the NEXT press is the one that leaves fullscreen: one layer each.
  await page.keyboard.press("Escape");
  await expect(enterFs).toBeVisible();
});

test("an open attendance panel pins the chrome", async ({ page }) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  // A widget on the board, so the pin under test is the PANEL's and not the
  // empty board's.
  await addWidget(page, "Tekst");

  const footer = page.locator("footer");
  const panel = page.getByRole("region", { name: "Hvem er her i dag?" });
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Hvem er her i dag?" }).click();
  await expect(panel).toBeVisible();

  // Reading a name list is exactly the kind of stillness the four-second
  // idle clock trips over. Well past it, twice over.
  await page.clock.fastForward(10_000);
  await expect(footer).not.toHaveAttribute("data-hidden", "true");

  // The pin has to be the IDLE CLOCK's (`holdOpen` in state/chrome.ts) and
  // not merely the toolbar's render condition, so CLOSE the panel and look
  // again: `shown` in Toolbar.tsx satisfies the assertion above all by
  // itself, and the toolbar would then snap away the instant the panel did.
  // The clock is frozen here, so nothing hides between these two lines
  // except a `chromeVisible` that was already false.
  await page.getByRole("button", { name: "Lukk" }).click();
  await expect(panel).toHaveCount(0);
  await expect(footer).not.toHaveAttribute("data-hidden", "true");

  // And it resumes its ordinary auto-hide from there.
  await page.clock.fastForward(6_000);
  await expect(footer).toHaveAttribute("data-hidden", "true");
});

test("the toolbar stays ONE row at 1280×800 with every control", async ({
  page,
}) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  // Brand, add menu, planner, scene switcher, class switcher, fullscreen and
  // the version all fit on one line — the whole point of the R2 redesign.
  // (The wrap this guards against came from centring the toolbar with an
  // absolute `left: 50%`, which left only the right half of the screen as
  // available width. The dock centres it with flex now — see
  // Toolbar.module.css — and `width: max-content` stayed.)
  const box = await page.locator("footer").boundingBox();
  expect(box!.height).toBeLessThan(70);
  await expect(page.getByRole("button", { name: "Planlegger" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bytt klasse" })).toBeVisible();
});

// ── «Vis stort» against the chrome ──────────────────────────────────────────
//
// An enlarged card is a VIEW of one widget, not a mode the app is in. Three
// consequences, and each of them is a thing that could quietly have gone the
// other way.

test("a class switch drops the enlarged card", async ({ page }) => {
  // The twin of «a class switch drops the pending undo». Every board swap —
  // the class menu, the screen library, the planner's own auto-switch —
  // lands in `adoptSnapshot`, and the focus is cleared THERE, once.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  // Creating a class lands on it — come back to the board with the card on
  // it, exactly like the undo twin does.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();

  const text = page.locator('[data-widget-kind="text"]');
  await expect(text).toHaveCount(1);
  const small = (await text.boundingBox())!;
  await text.hover();
  await text.getByRole("button", { name: "Vis stort" }).click();
  // BY ITS HOOK, not by name: the scrim and the card's own collapse button
  // say the same sentence — «Avslutt stor visning» is the name of the
  // command, and both of them are it — so a page-level by-name lookup matches
  // two elements and fails strict mode.
  const scrim = page.locator("[data-focus-scrim]");
  await expect(scrim).toBeVisible();

  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "8A" }).click();
  await expect(scrim).toHaveCount(0);

  // And back: 7B's card is its ordinary self. This is the half that proves
  // the ID was cleared rather than merely out of sight — a focus that only
  // LOOKED gone because 8A's board was empty would blow the card up again
  // the moment its own board came back.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await expect(text).toHaveCount(1);
  await expect(scrim).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await text.boundingBox())!.width))
    .toBe(Math.round(small.width));
});

test("the toolbar still slips away while a card is enlarged", async ({
  page,
}) => {
  // Deliberately NOT part of `anyOverlayOpen`: a test on the board is
  // precisely when the teacher stops touching the machine, and the chrome
  // must still get out of the class's way. The pointer stays up on the card,
  // well clear of the bottom reveal zone.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");
  await addWidget(page, "Tekst");

  const text = page.locator('[data-widget-kind="text"]');
  await text.hover();
  await text.getByRole("button", { name: "Vis stort" }).click();
  await expect(page.locator("[data-focus-scrim]")).toBeVisible();

  await page.clock.fastForward(6_000);
  await expect(page.locator("footer")).toHaveAttribute("data-hidden", "true");
});

test("an enlarged card does not survive a restart", async ({ page }) => {
  // Promise 2 says a restart mid-lesson brings the board back EXACTLY — and
  // «exactly» is the stored board, not a view someone left switched on. The
  // signal is never persisted (the writer only ever sends `widgets`), so
  // this holds by construction; the journey is what keeps it that way.
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Tekst");

  const text = page.locator('[data-widget-kind="text"]');
  const small = (await text.boundingBox())!;
  await text.hover();
  await text.getByRole("button", { name: "Vis stort" }).click();
  await expect(page.locator("[data-focus-scrim]")).toBeVisible();

  await page.reload();
  await expect(page.locator("[data-focus-scrim]")).toHaveCount(0);
  const restored = (await page
    .locator('[data-widget-kind="text"]')
    .boundingBox())!;
  expect(Math.abs(restored.width - small.width)).toBeLessThan(2);
  expect(Math.abs(restored.x - small.x)).toBeLessThan(2);
});
