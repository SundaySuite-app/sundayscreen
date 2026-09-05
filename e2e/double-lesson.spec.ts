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

// ── The flag with nothing under it ──────────────────────────────────────────

test("a merge flag on an EMPTY head is not a double lesson (F2)", async ({
  page,
}) => {
  // R6-F2, and it is a seam bug of the classic shape: two layers each correct
  // on their own, disagreeing where they meet, both green.
  //
  // `apply_merges` (schedule.rs:389) skips a merge whose head resolves to no
  // lesson — «a cancelled or free A has nothing to run on: a flag left on it is
  // dangling, and dangling flags are ignored in silence». The week grid checked
  // only `mergedWithNext` and never asked whether the head HELD anything, so it
  // drew the tail as a dimmed «fortsettelse» of a lesson that does not exist —
  // hiding a real lesson behind a label, in the tab that is supposed to be the
  // weekly truth. The day tab, reading the resolver, showed it correctly the
  // whole time; nothing was red anywhere.
  //
  // The way in is ordinary: she empties a double lesson's head through the
  // FIELDS and presses «Lagre» instead of «Tøm» (`set_slot` stores an empty row
  // quite happily), and the checkbox is still ticked because the editor
  // initialised it from the row.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });

  const panel = await buildSchoolDay(page);

  // Monday Time 2 has a real lesson of its own.
  await fillWeekCell(panel, {
    cell: 5,
    title: "Mandag · Time 2 09:30",
    subject: "Norsk",
  });

  // Monday Time 1: the flag, and nothing else. No class, no subject — saved.
  await weekCells(panel).nth(0).click();
  await expect(panel.getByText("Mandag · Time 1 08:30")).toBeVisible();
  await panel.getByLabel("Slå sammen med neste time").check();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();

  // THE FINDING: Time 2's cell shows its own lesson, not a continuation of
  // nothing.
  await expect(panel.getByText("fortsettelse")).toHaveCount(0);
  await expect(weekCells(panel).nth(5)).not.toHaveAttribute(
    "data-continuation",
    "true",
  );
  await expect(weekCells(panel).nth(5)).toContainText("Norsk");
  await expect(weekCells(panel).nth(5)).toContainText("7B");
  // …and the emptied head reads as empty, the same word `effective_lesson`
  // uses for it, rather than as a card with no writing on it.
  await expect(weekCells(panel).nth(0)).toContainText("—");

  // The resolver agreed all along — this is the half that was never wrong, and
  // asserting it is what names the divergence as a DIVERGENCE.
  await panel.getByRole("button", { name: "I dag", exact: true }).click();
  await expect(panel.getByText("Time 2 · 09:30–10:15")).toBeVisible();
  await expect(panel).toContainText("Norsk");
  await expect(panel.getByText("Dobbelttime")).toHaveCount(0);
  await expect(panel.getByText("fortsettelse")).toHaveCount(0);

  // And the flag still WORKS the moment the head has a lesson again: the fix
  // is a content check, not a way of ignoring the checkbox.
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await weekCells(panel).nth(0).click();
  await panel
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "7B" });
  await panel.getByLabel("Fag").fill("Matte");
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel.getByText("fortsettelse")).toHaveCount(1);
  await expect(weekCells(panel).nth(5)).toHaveAttribute(
    "data-continuation",
    "true",
  );
});

// ── «Fortsettelse av hva?» ──────────────────────────────────────────────────

test("the week grid's continuation cell names the period it belongs to (F8)", async ({
  page,
}) => {
  // In a 5 × 8 grid a bare «fortsettelse» made the teacher count rows upwards
  // to find out what it was a continuation OF. The cell is a standalone label
  // there, so it carries the head period's name; the day tab keeps the bare
  // word, where it stands next to the period's own clock times as an
  // apposition and reads as a sentence.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });

  const panel = await buildSchoolDay(page);
  await mergeMondayDouble(panel);

  await expect(weekCells(panel).nth(5)).toContainText("Fortsettelse av Time 1");

  // The day tab's wording is untouched.
  await panel.getByRole("button", { name: "I dag", exact: true }).click();
  await expect(panel.getByText("Time 2 · 09:30–10:15")).toBeVisible();
  await expect(panel.getByText("Fortsettelse av")).toHaveCount(0);
});

test("editing a deviation does not silently undo the day's merge choice", async ({
  page,
}) => {
  // F-R6-1. `planner_override_set` is a REPLACE, and the override editor
  // rewrites the whole row — so before `DayEntry.overrideMergedWithNext`
  // existed, saving a TITLE rewrote the stored Some(true) as «inherit» and
  // the day's «Slå sammen med neste i dag» vanished without a word. The raw
  // tri-state now rides the entry and the editor round-trips it verbatim;
  // this journey is the probe that proved the bug, frozen as a guard.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });

  const panel = await buildSchoolDay(page);
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

  // Merge TODAY only — the stored row is a carrier with Some(true).
  await panel.getByRole("button", { name: "I dag", exact: true }).click();
  await panel
    .getByRole("button", { name: "Slå sammen med neste i dag" })
    .first()
    .click();
  await expect(panel.getByText("Dobbelttime")).toHaveCount(1);

  // Now refine the deviation: give the merged lesson a title. This is the
  // write that used to eat the flag.
  await panel.getByRole("button", { name: "Overstyr", exact: true }).click();
  await panel.getByLabel("Tittel").fill("Prøve");
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();

  // The title landed AND the double lesson survived the rewrite.
  await expect(panel.getByText("Prøve")).toBeVisible();
  await expect(panel.getByText("Dobbelttime")).toHaveCount(1);
  await expect(panel.getByText("fortsettelse")).toHaveCount(1);

  // The mirror image: a weekly double lesson split for today, then refined —
  // the split must survive too (Some(false) is as much a choice as
  // Some(true); «inherit» would re-merge the halves mid-day).
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await weekCells(panel).nth(0).click();
  await panel.getByLabel("Slå sammen med neste time").check();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await panel.getByRole("button", { name: "I dag", exact: true }).click();
  // The day still shows ONE deviation row (title «Prøve», flag now false is
  // NOT what we set — the carrier from earlier was replaced by the titled
  // row carrying Some(true), so with the WEEK also merged the block stands.
  await expect(panel.getByText("Dobbelttime")).toHaveCount(1);
  await panel.getByRole("button", { name: "Del opp i dag" }).click();
  await expect(panel.getByText("Dobbelttime")).toHaveCount(0);
  await panel.getByRole("button", { name: "Overstyr", exact: true }).click();
  await panel.getByLabel("Tittel").fill("Prøve del 2");
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel.getByText("Prøve del 2")).toBeVisible();
  // Still split — the rewrite preserved Some(false) against the merged week.
  await expect(panel.getByText("Dobbelttime")).toHaveCount(0);
  await expect(panel.getByText("fortsettelse")).toHaveCount(0);
});
