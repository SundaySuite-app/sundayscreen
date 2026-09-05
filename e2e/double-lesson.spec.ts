import { expect, test, type Locator, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// DOUBLE LESSONS: two periods, one lesson.
//
// The model is deliberately additive (crates/sundayscreen-core/src/schedule.rs,
// «Double lessons»): the bijection entries↔periods survives — one entry per
// period, always — and a merge is expressed as two DERIVED booleans,
// `mergedWithNext` on the head and `continuation` on the tail. The matrix in
// `schedule.rs` owns the semantics and the fixture mirrors it; the widget
// cores (`agenda-widget-core.ts`) are unit-tested against the shapes it
// produces.
//
// What NONE of those tiers can see is the thing this file is about: whether a
// double lesson reads as ONE lesson to the room. Between 09:15 and 09:30 the
// class is at break, and the lesson is still Norsk; at 10:00 the board must
// still say Norsk, «Dagen i dag» must still show one line and not two, and
// «resten av timen» must still mean 10:15 rather than a bell that rang
// forty-five minutes ago. Every assertion below is a sentence a class reads.
//
// The day used everywhere here is Monday 2026-08-31, with the template
// «Legg til time» / «Legg til pause» / «Legg til time» produces from the
// 45-minute default: Time 1 08:30–09:15, Friminutt 09:15–09:30, Time 2
// 09:30–10:15. The break BETWEEN the halves is the interesting part — the
// resolver steps over it, and it survives as its own entry.

const plannerPanel = (page: Page): Locator =>
  page.getByRole("region", { name: "Planlegger" });

/** Every cell of the week grid, in row-major order over the LESSON periods
 *  (breaks are not in the grid). Selected through the grid's inline
 *  `grid-template-columns` — that attribute is DATA, unlike the CSS-module
 *  class name next to it, which is hashed and hashed differently in a build.
 *  With two lesson periods: 0–4 is Time 1 Mon–Fri, 5–9 is Time 2 Mon–Fri. */
const weekCells = (panel: Locator): Locator =>
  panel.locator('[style*="grid-template-columns"] > button');

/** The three-period template, saved. */
async function buildSchoolDay(page: Page): Promise<Locator> {
  const panel = plannerPanel(page);
  await page.goto("/?goto=planner:periods");
  // A fresh dev server can push one vite full-reload shortly after boot; let
  // it land BEFORE we interact, or it wipes the panel mid-journey.
  await page.waitForLoadState("networkidle");

  await panel.getByRole("button", { name: "Legg til time" }).click();
  await panel.getByRole("button", { name: "Legg til pause" }).click();
  await panel.getByRole("button", { name: "Legg til time" }).click();
  await panel.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(panel.getByText("Lagret")).toBeVisible();

  await panel.getByRole("button", { name: "Ukeplan" }).click();
  return panel;
}

/**
 * Fill one week cell for 7B. `title` is asserted before anything is typed:
 * the cell index above is row-major arithmetic, and a miscount has to fail
 * HERE, loudly, rather than downstream where it would look like a merge bug.
 *
 * `merge` rides on the same `SlotSpec` the subject does — the flag is one
 * more field on the row the teacher was already saving, never a second
 * command.
 */
async function fillWeekCell(
  panel: Locator,
  opts: { cell: number; title: string; subject: string; merge?: boolean },
): Promise<void> {
  await weekCells(panel).nth(opts.cell).click();
  await expect(panel.getByText(opts.title)).toBeVisible();
  await panel
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await panel.getByLabel("Fag").fill(opts.subject);
  if (opts.merge) await panel.getByLabel("Slå sammen med neste time").check();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
}

/** Monday × Time 1 = 7B Norsk, joined to the next period. */
const mergeMondayDouble = (panel: Locator) =>
  fillWeekCell(panel, {
    cell: 0,
    title: "Mandag · Time 1 08:30",
    subject: "Norsk",
    merge: true,
  });

// ── The week: one flag, and the grid tells the truth ────────────────────────

test("a weekly double lesson reads as ONE lesson on the board", async ({
  page,
}) => {
  await installFixtures(page);
  // Monday, 08:35 — inside the first half.
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });

  const panel = await buildSchoolDay(page);
  await mergeMondayDouble(panel);

  // The second half is dimmed and says where it went — and it is still a
  // BUTTON, because that cell is where a teacher goes to take the double
  // lesson apart again.
  await expect(panel.getByText("fortsettelse")).toHaveCount(1);
  await expect(weekCells(panel).nth(5)).toHaveAttribute(
    "data-continuation",
    "true",
  );

  await panel.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);

  // «Dagens time»: the header prints the BLOCK's window. A header showing
  // 08:30–09:15 would name a lesson that is still running after the time it
  // printed — and the break at 09:15 is INSIDE the block, not after it.
  await addWidget(page, "Dagens time");
  const agenda = page.locator('[data-widget-kind="agenda"]');
  await expect(agenda).toContainText("Norsk");
  await expect(agenda).toContainText("7B");
  await expect(agenda).toContainText("08:30–10:15");
  await expect(agenda).not.toContainText("08:30–09:15");

  // «Dagen i dag»: ONE row, not two. The resolver copies the head's whole
  // lesson onto the tail, so an unfiltered list would draw «Norsk» twice —
  // once at 08:30 and once at 09:30 — and read as two lessons to a class
  // scanning the day. The end time is added exactly because the row now
  // stands for both periods.
  await addWidget(page, "Dagen i dag");
  const today = page.locator('[data-widget-kind="today"]');
  await expect(today.getByText("Norsk")).toHaveCount(1);
  await expect(today.getByText("08:30–10:15")).toHaveCount(1);
});

// ── The clock: the block holds through the break ────────────────────────────

test("«resten av timen» still means 10:15 at 10:00", async ({ page }) => {
  await installFixtures(page);
  // Installed INSIDE the first half, so the widget is born in the same state
  // an ordinary lesson would give it.
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });

  const panel = await buildSchoolDay(page);
  await mergeMondayDouble(panel);
  await panel.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);

  // BEFORE the clock is paused, and that ordering is the harness contract:
  // `addWidget` ends in `settleEffects`, whose in-page arm is rAF + a
  // macrotask — both frozen by a paused mocked clock — so on a paused clock it
  // falls back to a bounded bail-out in the TEST process. Mount effects are
  // then simply not run, which is fine for authored time travel and useless
  // for a widget one is about to type into.
  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');

  // …and now it is 10:00: past the first half's bell, past the break, deep
  // inside the second half.
  await page.clock.pauseAt(new Date("2026-08-31T10:00:00"));
  await timer.hover();

  // The pill exists, and it names the BLOCK's end. Without the block this
  // reads 09:15 — a bell that rang forty-five minutes ago — and the press
  // would ask for a negative remainder, which the widget refuses outright
  // (R4-funn F4). So «the pill is here and says 10:15» is the whole finding.
  const pill = timer.getByRole("button", {
    name: "Still tidtakeren på resten av timen (til 10:15)",
  });
  await expect(pill).toBeVisible();

  // 10:15 − 10:00 = 15 minutes, counted from the WALL CLOCK at click time.
  // The number is also what proves the clock really is at 10:00.
  await pill.click();
  await expect(timer.getByText("15:00")).toBeVisible();
});

// ── The date: «Del opp i dag» ───────────────────────────────────────────────

test("«Del opp i dag» splits the date without touching the week", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });

  const panel = await buildSchoolDay(page);

  // Both halves get a lesson of their own FIRST — that is what lets the day
  // tab offer an agenda field for the second period at all, and rows typed
  // there before the halves were joined are the case the continuation line
  // exists to keep visible.
  await fillWeekCell(panel, {
    cell: 0,
    title: "Mandag · Time 1 08:30",
    subject: "Norsk",
  });
  await fillWeekCell(panel, {
    cell: 5,
    title: "Mandag · Time 2 09:30",
    subject: "Matte",
  });

  // Time 2's own agenda row, typed while the two halves are still separate.
  await panel.getByRole("button", { name: "I dag", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Legg til aktivitet" }),
  ).toHaveCount(2);
  await panel
    .getByRole("button", { name: "Legg til aktivitet" })
    .nth(1)
    .click();
  await panel.getByPlaceholder("Hva skal skje …").fill("Oppsummering");
  await panel.getByRole("button", { name: "Lagre agenda" }).nth(1).click();
  await expect(panel.getByText("Lagret")).toBeVisible();

  // Now join them, in the WEEK — she comes back to the cell she already
  // filled and ticks one box.
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await weekCells(panel).nth(0).click();
  await expect(panel.getByText("Mandag · Time 1 08:30")).toBeVisible();
  await panel.getByLabel("Slå sammen med neste time").check();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();

  // The day tab: one card for the block, one slim line for the tail.
  await panel.getByRole("button", { name: "I dag", exact: true }).click();
  await expect(panel.getByText("Time 1 · 08:30–10:15")).toBeVisible();
  await expect(panel.getByText("Dobbelttime")).toHaveCount(1);
  // The tail's line carries its OWN clock times — it answers «what happened
  // to 09:30?», it does not repeat the head.
  await expect(panel.getByText("Time 2 · 09:30–10:15")).toBeVisible();
  await expect(panel.getByText("fortsettelse")).toHaveCount(1);
  // …and the rows typed under the tail's key are still where she typed them.
  // Hiding them would be data the app knows about and does not show.
  await expect(
    panel.getByRole("textbox", { name: "Hva skal skje …" }),
  ).toHaveValue("Oppsummering");

  // «Del opp i dag» — for THIS date only, written as a FLAG CARRIER: an
  // override row whose content fields are all empty, so the lesson is still
  // resolved from the weekly plan.
  await panel.getByRole("button", { name: "Del opp i dag" }).click();

  // Today the two halves stand apart again, with the tail's own lesson back.
  await expect(panel.getByText("Time 1 · 08:30–09:15")).toBeVisible();
  await expect(panel.getByText("Dobbelttime")).toHaveCount(0);
  await expect(panel.getByText("fortsettelse")).toHaveCount(0);
  await expect(panel.getByText("Matte")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Slå sammen med neste i dag" }),
  ).toBeVisible();

  // THE CARRIER IS NOT A DEVIATION. The row exists in the store, but it
  // shadows nothing: `overridden` stays false, so the card must not wear the
  // «Avvik» badge — next week's change to the weekly plan still reaches this
  // lesson, and a badge would say the opposite.
  await expect(panel.getByText("Avvik", { exact: true })).toHaveCount(0);

  // …and the WEEK is untouched: the recurring double lesson is still there,
  // which is the whole difference between «i dag» and «hver uke».
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await expect(panel.getByText("fortsettelse")).toHaveCount(1);
  await expect(weekCells(panel).nth(5)).toHaveAttribute(
    "data-continuation",
    "true",
  );
});
