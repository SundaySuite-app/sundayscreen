import { expect, test, type Locator, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// THE DESIGN SESSION: the planner BORROWS the board.
//
// «Rediger skjermen for onsdag, 3. time» must not put that screen on the
// projector. In a ONE-WINDOW app that is not a pixel invariant — it is three
// STATE invariants (state/design-session.ts): every save carries the DESIGN
// scene's id, nothing touches `settings.activeSceneId`, and every way out
// flushes before the globals go back.
//
// `design-session.test.ts` pins those three against the signals. What it
// cannot see is the journey they exist for, and that is this file: a teacher
// plans Wednesday's lesson on a screen that is not on the wall, presses
// «Ferdig», closes the panel — and the board the class is looking at is the
// one she left, before AND after a restart. The editor she used is the real
// one (Surface, WidgetShell, useDrag, the add menu, the same persister), so
// the only thing separating «designing» from «working on the wall» is which
// id the writes carry. A journey is the only tier that can tell.
//
// ⚠️ Two harness contracts this file leans on, both of them load-bearing:
//
//   * `addWidget` finds the add button by the SUBSTRING «Legg til verktøy».
//     The design panel's own button reads «Legg til verktøy på skjermen»
//     (`design.addTool`) — a different sentence on purpose, because two
//     identically named buttons in one accessibility tree are an ambiguous
//     target. The substring still resolves to exactly one control here
//     because the toolbar is UNMOUNTED while a session runs (Shell.tsx), not
//     merely covered. The day it is only hidden, this file goes red first.
//   * `addWidget` ends in `settleEffects`, so the line after it may type into
//     the fresh widget without racing Preact's deferred mount effects.

/** The panel, as a scope. Everything below is looked up INSIDE it: the
 *  toolbar's own «Planlegger» button, its screen library and the toast host
 *  all stand outside, and several of them carry names this file also uses. */
const plannerPanel = (page: Page): Locator =>
  page.getByRole("region", { name: "Planlegger" });

/**
 * Plan Monday's first lesson onto a BRAND-NEW library screen, and stop with
 * the cell editor open on it.
 *
 * The «Lag ny skjerm for denne timen» door is deliberately part of the
 * journey rather than a seeded fixture row: planning next Wednesday is
 * exactly when a teacher wants an EMPTY screen, and `scene_create` had no
 * door in the UI at all before this round.
 */
async function planLessonOnNewScreen(
  page: Page,
  sceneName: string,
): Promise<Locator> {
  const panel = plannerPanel(page);
  await page.getByRole("button", { name: "Planlegger" }).click();
  await expect(panel).toBeVisible();

  // `exact`, and it is not optional: the panel opens on the week tab, which
  // with no periods yet offers «Start i Timeoppsett» — and Playwright matches
  // an accessible name by SUBSTRING (CLAUDE.md). Without it the tab and the
  // hint button are two matches for one click.
  await panel.getByRole("button", { name: "Timeoppsett", exact: true }).click();
  await panel.getByRole("button", { name: "Legg til time" }).click();
  await panel.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(panel.getByText("Lagret")).toBeVisible();

  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await panel.locator("button:has-text('—')").first().click();
  await panel
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await panel.getByLabel("Fag").fill("Norsk");

  await panel
    .getByRole("button", { name: "Lag ny skjerm for denne timen" })
    .click();
  const nameField = panel.getByPlaceholder("Navn på skjermen …");
  await nameField.fill(sceneName);
  await nameField.press("Enter");
  // The picker adopts the screen it just made — the lesson points at it
  // BEFORE «Design skjermen» is pressed, which is what makes the button open
  // the right board rather than the class default.
  await expect(panel.getByLabel("Skjerm", { exact: true })).not.toHaveValue("");

  return panel;
}

// ── The core journey ────────────────────────────────────────────────────────

test("designing a lesson's screen never touches the board behind it", async ({
  page,
}) => {
  await installFixtures(page);
  // A Monday, so the week grid's first column is the day the clock agrees
  // with. Nothing below is time-sensitive; determinism is free here.
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // THE BOARD THE CLASS IS LOOKING AT. One clock, and it is the whole
  // control: every assertion further down counts `[data-widget-kind]` against
  // this one card.
  await addWidget(page, "Klokke");
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);

  const panel = await planLessonOnNewScreen(page, "Onsdagsskjerm");
  await panel.getByRole("button", { name: "Design skjermen" }).click();

  // The session says out loud what it is. Without this sentence the teacher
  // is editing a screen that looks exactly like her own, at a smaller size.
  await expect(panel.getByText("Du designer «Onsdagsskjerm»")).toBeVisible();

  // The empty board's hint POINTS somewhere, and where it points depends on
  // where it is standing: the toolbar is unmounted in here, so «langs
  // nederste kant» would send her looking along an edge with nothing on it.
  await expect(
    panel.getByText("Bruk «Legg til verktøy på skjermen» øverst."),
  ).toBeVisible();
  await expect(
    page.getByText("Verktøylinja ligger langs nederste kant."),
  ).toHaveCount(0);

  // The REAL editor, on the little board: the add menu, a card, and typing
  // into it.
  await addWidget(page, "Tekst");
  const text = panel.locator('[data-widget-kind="text"]');
  await expect(text).toHaveCount(1);
  await text.getByText("Skriv en beskjed …").click();
  const editor = text.locator("textarea");
  await editor.fill("Kapittel 4");
  // Blur commits and forces the immediate save — the same gesture the wall
  // board has, through the same persister, under the DESIGN scene's id.
  await editor.blur();
  await expect(text.getByText("Kapittel 4")).toBeVisible();

  // «Ferdig» ends the session and leaves the teacher in the planner — not on
  // the board, and not somewhere she has to find her way back from.
  await panel.getByRole("button", { name: "Ferdig" }).click();
  await expect(panel.getByText("Du designer")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Ukeplan" })).toBeVisible();
  // …and the week cell now names the screen she just drew.
  await expect(panel.getByRole("button", { name: "7B Norsk" })).toContainText(
    "Onsdagsskjerm",
  );

  // INVARIANT 1 + 3: the board behind is exactly what it was. One clock, no
  // text — the text went into «Onsdagsskjerm», and the flush that made that
  // true ran BEFORE the globals went back.
  await panel.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);
  await expect(page.locator("[data-widget-kind]")).toHaveCount(1);
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(0);

  // INVARIANT 2: nothing ever moved the backend's pointer, so the next boot
  // lands on the lesson's screen because nothing said otherwise. A crash
  // mid-session would end the same way.
  await page.reload();
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Standard",
  );
  await expect(page.locator("[data-widget-kind]")).toHaveCount(1);
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);

  // And the work is not lost — it is on the screen it was made for.
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Onsdagsskjerm" }).click();
  await expect(page.locator('[data-widget-kind="text"]')).toHaveCount(1);
  await expect(page.getByText("Kapittel 4")).toBeVisible();
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(0);
});

// ── Escape, one rung at a time ──────────────────────────────────────────────

test("Escape peels the popover, then the session, then the panel", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const panel = await planLessonOnNewScreen(page, "Terningskjerm");
  await panel.getByRole("button", { name: "Design skjermen" }).click();
  await expect(panel.getByText("Du designer «Terningskjerm»")).toBeVisible();

  // A card on the little board has the same appearance panel it has on the
  // wall, drawn by the same host one layer up (WidgetOverlay's
  // `data-elevated`) — under the planner's scrim it would be invisible, and
  // an Escape that appeared to do nothing.
  await addWidget(page, "Terning");
  const dice = panel.locator('[data-widget-kind="dice"]');
  await expect(dice).toHaveCount(1);
  await dice.hover();
  const look = dice.locator("[data-dice-look]");
  await look.focus();
  await page.keyboard.press("Enter");
  const overlay = page.locator("[data-widget-overlay]");
  await expect(overlay).toBeVisible();

  // Rung 1 — the popover only. The session is still standing: peeling it
  // first would take the board away from under a menu that was still open.
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(panel.getByText("Du designer «Terningskjerm»")).toBeVisible();

  // Rung 2 — the session, and the panel STAYS. Below «overlay» in the ladder
  // one press would have undone two layers, and a teacher who pressed Escape
  // to leave a screen she was editing would be back at the board.
  await page.keyboard.press("Escape");
  await expect(panel.getByText("Du designer")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ukeplan" })).toBeVisible();

  // Rung 3 — the panel. Through `closePlanner`, which is the one door out.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);
});

// ── A session that never opens ──────────────────────────────────────────────

/**
 * Let a journey kill `layout_load` on demand — the spec-local init script
 * layered over the harness's own, the same shape `binder-widgets.spec`'s
 * `breakableDayGet` uses. A flag rather than a one-shot: the thumbnails in
 * the planner read layouts too, and a counter would let one of them consume
 * the failure meant for the press under test.
 */
async function breakableLayoutLoad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const real = fixtures.layout_load as (
      args?: Record<string, unknown>,
    ) => unknown;
    w.__failLayoutLoad = false;
    fixtures.layout_load = (args?: Record<string, unknown>) => {
      if (w.__failLayoutLoad)
        throw new Error("layout_load: database is locked");
      return real(args);
    };
  });
}

const setLayoutLoadFailing = (page: Page, failing: boolean) =>
  page.evaluate((v) => {
    (window as unknown as Record<string, unknown>).__failLayoutLoad = v;
  }, failing);

test("a screen that cannot be read does not get borrowed (S#4)", async ({
  page,
}) => {
  await installFixtures(page);
  await breakableLayoutLoad(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await addWidget(page, "Klokke");
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);

  const panel = await planLessonOnNewScreen(page, "Aldri åpnet");

  // The store goes away between the plan and the press — the ordinary way
  // this state arrives.
  await setLayoutLoadFailing(page, true);
  await panel.getByRole("button", { name: "Design skjermen" }).click();

  // A toast, and NOTHING MOVES. The store's writes are replace-all, so
  // borrowing a screen whose rows we failed to read and then saving once
  // would not leave «an empty panel» — it would leave the screen the teacher
  // was about to edit deleted.
  await expect(page.getByText("Noe gikk galt — prøv igjen.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ferdig" })).toHaveCount(0);
  await expect(panel.getByText("Du designer")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Ukeplan" })).toBeVisible();

  // …and the board behind is untouched, which is the half a failed swap is
  // most likely to get wrong.
  await setLayoutLoadFailing(page, false);
  await panel.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Standard",
  );
  await expect(page.locator("[data-widget-kind]")).toHaveCount(1);
  await expect(page.locator('[data-widget-kind="clock"]')).toHaveCount(1);
});
