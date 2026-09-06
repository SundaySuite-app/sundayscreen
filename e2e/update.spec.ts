import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The manage panel's update surface — statuses only; the real feed is the
// backend's (unit-tested URL logic + the suite Worker's contract tests).

async function openPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
}

test("a manual check reports up to date", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Du har nyeste versjon")).toBeVisible();
});

test("an available update offers the install button", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oppdater og start på nytt" }),
  ).toBeVisible();
});

test("a failed check is an honest status, not a crash", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "error", message: "offline" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText(/Fikk ikke sjekket nå/)).toBeVisible();
});

// ── The SILENT boot check finally has a receiver ────────────────────────────
//
// It has run since v0.1 and reported to a terminal no classroom has open. The
// backend now posts its answer to a mailbox (`update_pending`); the shell asks
// once, ~20 s in, and marks the version span. Nothing else: no modal, no
// toast, and it never pulls the chrome back up.

test("the boot check's answer marks the version line", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");

  // Before the read is due there is NOTHING — an answer that has not landed
  // must never render as an answer.
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();
  await expect(page.getByText("v9.9.9 klar")).toHaveCount(0);

  await page.clock.fastForward(20_000);
  const mark = page.getByText("v9.9.9 klar");
  await expect(mark).toBeVisible();
  // The tooltip names where to act on it. The mark itself does nothing.
  await expect(mark).toHaveAttribute(
    "title",
    "Versjon 9.9.9 er klar — hent den under «Administrer klasser».",
  );
});

test("no answer means no marker", async ({ page }) => {
  // Offline is the normal classroom state: the mailbox stays empty, and so
  // does the toolbar. Same for "up to date" — that is an answer the manage
  // panel gives on request, not something to put on a projector.
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "upToDate" };
  });
  await page.goto("/");
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();

  await page.clock.fastForward(20_000);
  await expect(page.getByText(/klar/)).toHaveCount(0);
});

// ── ADR-014: the app updates itself ─────────────────────────────────────────
//
// The install itself is native — an `Update` handle, a real archive and
// `RunEvent::Exit` — and no tier here can reach it (that is a rig-test line in
// NEEDS-RICHARD, and the DECISIONS the install turns on are unit-tested in
// `src-tauri/src/update/mod.rs`). What this tier owns is the surface: the
// switch, and which sentence the teacher meets.

const AUTO_LABEL = "Installer oppdateringer automatisk";

test("automatic updates are on, can be turned off, and stay off", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  const auto = page.getByRole("checkbox", { name: AUTO_LABEL });
  await expect(auto).toBeChecked();
  await auto.uncheck();
  await expect(auto).not.toBeChecked();

  // The store behind the fixture is localStorage, exactly so a journey can
  // reload and find its own decision again. An optimistic toggle that never
  // reached a write would pass the two lines above and fail this one.
  await page.reload();
  await openPanel(page);
  await expect(
    page.getByRole("checkbox", { name: AUTO_LABEL }),
  ).not.toBeChecked();
});

test("an update already downloaded asks the teacher for nothing", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "downloaded", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  // No `clock.fastForward` here, and that is the point: the shell's own read
  // is 20 s away, so the only thing that can have produced this sentence is
  // the panel re-reading the mailbox when it opened.
  await expect(
    page.getByText("v9.9.9 installeres når du lukker appen"),
  ).toBeVisible();
  // «Oppdater og start på nytt» survives: wanting it now is a legitimate
  // answer to a promise about later.
  await expect(
    page.getByRole("button", { name: "Oppdater og start på nytt" }),
  ).toBeVisible();
});

test("without the automatic install the old sentence stands", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("checkbox", { name: AUTO_LABEL }).uncheck();

  // Scoped to the panel: the toolbar pill carries the same short text on
  // purpose (the `.meta` row cannot hold the long one), so an unscoped
  // `getByText` matches two elements.
  const panel = page.getByRole("region", { name: "Klasser og navn" });
  const pending = panel.getByText("v9.9.9 klar");
  await expect(pending).toBeVisible();
  await expect(
    panel.getByText("v9.9.9 installeres når du lukker appen"),
  ).toHaveCount(0);
  // …and the tooltip renders the VERSION. This one call was `t`, not `tf`,
  // since the marker shipped: it showed a literal «{v}».
  await expect(pending).toHaveAttribute(
    "title",
    "Versjon 9.9.9 er klar — hent den under «Administrer klasser».",
  );
});

// ── «Hva er nytt»: the note the release shipped with ────────────────────────
//
// `latest.json` has carried a top-level `notes` field since the release-note
// mechanism landed, filled from `docs/release-notes/<tagg>.md`. The app fetched
// it on every check and threw it away: the phase the shell sent the frontend had
// nowhere to put the text. The teacher was told a version number and asked to
// restart on faith.
//
// Written the way `scripts/release-notes.mjs` requires the real thing to be
// written: plain text, line breaks as paragraphs, the thing that MOVED first.
const NOTE = "Terningen viser nå 0-9.\n\nTimeplanen tåler dobbelttimer.";

test("a manual check shows the note the release author wrote", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript((note) => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = {
      phase: "available",
      version: "9.9.9",
      notes: note,
    };
  }, NOTE);
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();

  const notes = page.getByRole("group", { name: "Hva er nytt" });
  await expect(page.getByText("Hva er nytt")).toBeVisible();
  // RAW `textContent`, deliberately not `toHaveText`: that matcher normalises
  // whitespace on both sides, so it would go green on a box that had collapsed
  // the author's blank line into a space. The break between the two paragraphs
  // is the thing under test.
  expect(await notes.textContent()).toBe(NOTE);
  // …and a break in the DOM is only a break on screen because of this. Read
  // from the computed style rather than trusted from the stylesheet — a later
  // rule that reset it would leave the assertion above passing and the note
  // rendered as one run-on line.
  expect(await notes.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe(
    "pre-wrap",
  );
  // Plain text BY CONTRACT — inserted as a text child, never parsed. A note
  // that (against the guard) carried markup must reach the screen as
  // characters, so the box has no element children at all.
  expect(await notes.evaluate((el) => el.children.length)).toBe(0);
  // It scrolls at full size, so a keyboard has to be able to reach it.
  await expect(notes).toHaveAttribute("tabindex", "0");
});

test("an update without a note leaves the panel exactly as it was", async ({
  page,
}) => {
  // Every release published before the mechanism — and the reason `notes` is
  // nullable rather than required. No heading, no empty frame, no "undefined":
  // the version line alone, which is what she has always seen.
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();
  await expect(page.getByText("Hva er nytt")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Hva er nytt" })).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Klasser og navn" });
  await expect(panel).not.toContainText("undefined");
});

test("a blank note is the same as no note", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = {
      phase: "available",
      version: "9.9.9",
      notes: "  \n \n ",
    };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();
  await expect(page.getByRole("group", { name: "Hva er nytt" })).toHaveCount(0);
});

test("the automatic path says what it is about to install", async ({
  page,
}) => {
  // The phase that needed this MOST. With automatic updates on, «installeres
  // når du lukker appen» is the only sentence she ever meets about the version
  // her app becomes — nothing to press, and until now nothing to read either.
  //
  // No `clock.fastForward`: the shell's own mailbox read is 20 s away, so the
  // only thing that can have produced this is the panel re-reading on open.
  await installFixtures(page);
  await page.addInitScript((note) => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = {
      phase: "downloaded",
      version: "9.9.9",
      notes: note,
    };
  }, NOTE);
  await page.goto("/");
  await openPanel(page);

  await expect(
    page.getByText("v9.9.9 installeres når du lukker appen"),
  ).toBeVisible();
  expect(
    await page.getByRole("group", { name: "Hva er nytt" }).textContent(),
  ).toBe(NOTE);
});

test("a failed check drops the note — the failure owns the line", async ({
  page,
}) => {
  // The mailbox found a version WITH a note at boot; the manual check then
  // fails. A note left standing under «Fikk ikke sjekket nå» would be
  // describing an answer that never arrived.
  await installFixtures(page);
  await page.addInitScript((note) => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = {
      phase: "available",
      version: "9.9.9",
      notes: note,
    };
    fixtures.update_check = { phase: "error", message: "offline" };
  }, NOTE);
  await page.goto("/");
  await openPanel(page);

  // It is on screen first — otherwise the assertion below proves nothing.
  await expect(page.getByRole("group", { name: "Hva er nytt" })).toBeVisible();

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText(/Fikk ikke sjekket nå/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Hva er nytt" })).toHaveCount(0);
});

test("a full-size note scrolls inside its own box", async ({ page }) => {
  // `scripts/release-notes.mjs` caps a note at 1000 bytes, so this is the worst
  // case that can ever reach the panel — and the panel already scrolls. The box
  // must take the overflow itself rather than pushing the update row out of the
  // band below it.
  const long = Array.from(
    { length: 34 },
    (_, i) => `Linje ${i + 1} i et langt notat.`,
  ).join("\n");
  const bytes = new TextEncoder().encode(long).length;
  expect(bytes).toBeGreaterThan(900);
  expect(bytes).toBeLessThanOrEqual(1000); // the guard's ceiling

  await installFixtures(page);
  await page.addInitScript((note) => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = {
      phase: "available",
      version: "9.9.9",
      notes: note,
    };
  }, long);
  await page.goto("/");
  await openPanel(page);
  await page.getByRole("button", { name: "Se etter oppdatering" }).click();

  const notes = page.getByRole("group", { name: "Hva er nytt" });
  await notes.scrollIntoViewIfNeeded();
  const box = await notes.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  // The note is the thing that scrolls, and it is capped well under a
  // screenful — measured, not asserted from the stylesheet.
  expect(box.scroll).toBeGreaterThan(box.client);
  expect(box.client).toBeLessThan(200);

  // …and «Se etter oppdatering» is still reachable, which is the actual failure
  // an uncapped note would cause.
  await expect(
    page.getByRole("button", { name: "Se etter oppdatering" }),
  ).toBeVisible();
});

test("the channel toggle flips and saves", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await openPanel(page);

  const beta = page.getByRole("button", { name: "Beta", exact: true });
  const stable = page.getByRole("button", { name: "Stabil", exact: true });
  await expect(stable).toHaveAttribute("data-current", "true");
  await beta.click();
  await expect(beta).toHaveAttribute("data-current", "true");
  await expect(stable).not.toHaveAttribute("data-current", "true");
});
