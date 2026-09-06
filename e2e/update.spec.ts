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

// ── «Hva er nytt»: the note the feed has carried all along ──────────────────
//
// `latest.json` has had a `notes` field since the release pipeline was fixed
// (it is written from `docs/release-notes/<tagg>.md` at BUILD time, so the
// text exists before anyone can edit a release page). The app threw it away:
// `UpdateStatus` carried a version and nothing else, so the panel could say
// «v9.9.9 er klar» and the teacher approved a restart without being told what
// it gave her (R7-funn H1).

const NOTE = "Terningen kan nå vise 0–9.\nTimeren kan telle resten av timen.";

test("the release note reaches the panel, with its line breaks", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript((note: string) => {
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

  const panel = page.getByRole("region", { name: "Klasser og navn" });
  await expect(panel.getByText("Hva er nytt")).toBeVisible();
  // Both lines, as two lines: the note is plain text by contract
  // (`scripts/release-notes.mjs` refuses markdown), and its line breaks are
  // its structure — one change per line.
  const body = panel.getByText("Terningen kan nå vise 0–9.");
  await expect(body).toBeVisible();
  await expect(body).toContainText("Timeren kan telle resten av timen.");
  await expect(body).toHaveCSS("white-space", "pre-line");
  // Rendered as TEXT, never as markup — a `**fet**` in a note must show up as
  // asterisks on a projector rather than as a bold tag.
  await expect(body).toHaveText(NOTE);
});

test("a version that came without a note says so", async ({ page }) => {
  // Every release before v0.4.0-beta.3 shipped `"notes": ""`, and those
  // manifests are still on the feed. An empty box would repeat that bug; a
  // sentence admits it.
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_pending = { phase: "available", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  const panel = page.getByRole("region", { name: "Klasser og navn" });
  await expect(panel.getByText("Hva er nytt")).toBeVisible();
  await expect(
    panel.getByText("Ingen beskrivelse fulgte med denne versjonen"),
  ).toBeVisible();
});

test("a manual check shows the note it just fetched", async ({ page }) => {
  // The manual answer is the FRESHER of the two, so this note comes from the
  // status itself rather than from the mailbox.
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.update_check = {
      phase: "available",
      version: "9.9.9",
      notes: "Klassepanelet får plass på projektoren.",
    };
  });
  await page.goto("/");
  await openPanel(page);

  await page.getByRole("button", { name: "Se etter oppdatering" }).click();
  await expect(page.getByText("Versjon 9.9.9 er klar")).toBeVisible();
  await expect(
    page.getByText("Klassepanelet får plass på projektoren."),
  ).toBeVisible();
});

// ── «Oppdater og start på nytt» while the automatic half is fetching ─────────
//
// The old order asked `take_ready()` first, got `None` for a download in
// flight, and fell straight through to the network: the same archive fetched
// twice over a school wifi, and a window where the background download could
// land mid-install and be unpacked a second time by the exit hook
// (R7-funn M6). The backend now answers `downloading` instead.

test("pressing install mid-download does not start a second one", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    // Found, not yet downloaded — which is exactly the mailbox state while
    // the background download runs.
    fixtures.update_pending = {
      phase: "available",
      version: "9.9.9",
      notes: "Terningen kan nå vise 0–9.",
    };
    fixtures.update_install = { phase: "downloading", version: "9.9.9" };
  });
  await page.goto("/");
  await openPanel(page);

  const panel = page.getByRole("region", { name: "Klasser og navn" });
  await expect(panel.getByText("v9.9.9 klar")).toBeVisible();

  await panel
    .getByRole("button", { name: "Oppdater og start på nytt" })
    .click();

  // The honest answer: it IS on its way, and it installs at closing time —
  // the promise the download is already keeping. No restart, no second fetch.
  await expect(
    panel.getByText("v9.9.9 installeres når du lukker appen"),
  ).toBeVisible();
  // …and the note stays on screen. She pressed a button, she did not ask to
  // stop reading what the version brings.
  await expect(panel.getByText("Terningen kan nå vise 0–9.")).toBeVisible();
  // Nothing went wrong, so nothing says it did.
  await expect(panel.getByText("Noe gikk galt")).toHaveCount(0);
});

// ── The projector resolution (R7-funn klasserom #9) ─────────────────────────
//
// MEASURED before the fix on 1024×768: the panel's content was 841 px in a
// 702 px box, «Installer oppdateringer automatisk» sat at y=755 and «Se etter
// oppdatering» at y=814, against a panel that ended at 736 — both below the
// fold, with no scroll indicator anywhere. ADR-014's switch is the one control
// here a teacher may need to turn OFF, and on a projector it did not appear to
// exist.

test.describe("on a 1024×768 projector", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the update controls are on screen without scrolling", async ({
    page,
  }) => {
    await installFixtures(page);
    await page.goto("/");
    await openPanel(page);

    const panel = page.getByRole("region", { name: "Klasser og navn" });
    await expect(panel).toBeVisible();

    // Visible is not enough — a control 80 px below the fold is «visible» to
    // Playwright too. The assertion is GEOMETRIC: inside the panel's own box.
    const box = (await panel.boundingBox())!;
    for (const control of [
      page.getByRole("checkbox", { name: AUTO_LABEL }),
      page.getByRole("button", { name: "Se etter oppdatering" }),
    ]) {
      const rect = (await control.boundingBox())!;
      expect(rect.y + rect.height).toBeLessThanOrEqual(box.y + box.height);
    }

    // …and the panel does not scroll at all in this state.
    const overflow = await panel.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(overflow).toBe(0);
  });

  test("a panel that DOES scroll says so at its bottom edge", async ({
    page,
  }) => {
    // The backstop for every state the height query cannot fit — a long
    // release note, an error band, a window shorter than we measured. The
    // shadow is four background layers on the scroll container; two ride with
    // the content and mask it at the edges, two stay put and are what shows.
    await installFixtures(page);
    await page.addInitScript(() => {
      const fixtures = (window as unknown as Record<string, unknown>)
        .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
      fixtures.update_pending = {
        phase: "downloaded",
        version: "9.9.9",
        notes: Array.from(
          { length: 18 },
          (_, i) => `Linje ${i + 1} i notatet`,
        ).join("\n"),
      };
    });
    await page.goto("/");
    await openPanel(page);

    const panel = page.getByRole("region", { name: "Klasser og navn" });
    const overflow = await panel.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(overflow).toBeGreaterThan(0);

    const layers = await panel.evaluate(
      (el) => getComputedStyle(el).backgroundAttachment,
    );
    // local, local, scroll, scroll (+ the flat colour underneath): the pairing
    // IS the mechanism, so it is what gets pinned.
    expect(layers).toBe("local, local, scroll, scroll, scroll");

    // The note itself scrolls rather than growing without bound — that ceiling
    // is what keeps the section's height a constant whatever the feed says.
    const noteScrolls = await panel
      .getByText("Linje 1 i notatet")
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(noteScrolls).toBe(true);
  });
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
