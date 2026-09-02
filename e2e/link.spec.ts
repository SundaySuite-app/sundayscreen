import { expect, test } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// «Lenke»: type a title and an address, click it open, reload and find it
// standing. The one thing this spec cannot test is the URL scrub — the
// fixture backend stores RAW (harness.ts says so out loud: no clamps, those
// are the real backend's unit-tested job), so `layout_save` here would keep a
// `javascript:` URI that Rust clears. The scrub is pinned in
// `layout.rs::only_an_http_url_survives_the_clamp` and again in
// `commands/links.rs`. What IS testable here, and is, is the FRONTEND gate:
// a URL the app will not vouch for never lights the click surface, so nothing
// ever asks the backend to open it.

/** The link widget's id, read out of the fixture store — the whole point of
 *  the assertion below is that the id sent to `link_open` is THIS widget's,
 *  not a URL and not something else's. */
async function storedLinkWidgetId(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__e2e_db__") ?? "{}") as {
      layouts?: Record<string, { id: string; config?: { kind?: string } }[]>;
    };
    const all = Object.values(db.layouts ?? {}).flat();
    return all.find((w) => w.config?.kind === "link")?.id ?? "";
  });
}

test("a link is typed, opens on click, and survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Lenke");
  const card = page.locator('[data-widget-kind="link"]');
  await expect(card).toContainText("Ingen lenke satt ennå");

  const open = card.getByRole("button", { name: "Åpne lenken" });
  await expect(open).toBeDisabled();

  // The settings row is a hover row (WidgetShell), so reach it the way the
  // deadline journey reaches its date picker.
  await card.hover();
  await card.getByLabel("https://…").fill("https://www.udir.no/oppgaver");
  await expect(async () => {
    await card
      .getByRole("button", { name: "Tittel …" })
      .click({ timeout: 1000 });
    await expect(page.getByRole("textbox", { name: "Tittel …" })).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await page.getByRole("textbox", { name: "Tittel …" }).fill("Oppgaver");
  await page.keyboard.press("Enter");

  // The board shows the title big and the HOST underneath — not the whole
  // address, which nobody reads from the back of the room.
  await expect(card).toContainText("Oppgaver");
  await expect(card).toContainText("udir.no");
  await expect(card).not.toContainText("/oppgaver");

  // THE RULE: no anchor anywhere in the card. An `<a href>` could navigate
  // the one window the app has, and a `javascript:` href would execute.
  await expect(card.locator("a[href]")).toHaveCount(0);

  // The click hands the backend a WIDGET ID, never a URL.
  const widgetId = await storedLinkWidgetId(page);
  expect(widgetId).not.toBe("");
  await card.hover();
  await open.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __openedLinks?: string[] }).__openedLinks,
      ),
    )
    .toEqual([widgetId]);

  // Promise 2: a restart mid-lesson restores the screen exactly.
  await page.reload();
  const after = page.locator('[data-widget-kind="link"]');
  await expect(after).toContainText("Oppgaver");
  await expect(after).toContainText("udir.no");
  await expect(
    after.getByRole("button", { name: "Åpne lenken" }),
  ).toBeEnabled();
});

test("an address the app will not vouch for never lights the click surface", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Lenke");
  const card = page.locator('[data-widget-kind="link"]');
  await card.hover();
  await card.getByLabel("https://…").fill("javascript:alert(1)");

  const open = card.getByRole("button", { name: "Åpne lenken" });
  await expect(open).toBeDisabled();
  await expect(card).toContainText("Ingen lenke satt ennå");
  await expect(card.locator("a[href]")).toHaveCount(0);

  // Nothing was ever asked to open. (The fixture backend stores what was
  // typed — clearing the value is Rust's job, and Rust's tests pin it — so
  // this is the layer that has to hold in the browser tier.)
  expect(
    await page.evaluate(
      () => (window as unknown as { __openedLinks?: string[] }).__openedLinks,
    ),
  ).toBeUndefined();

  // A relative path is refused for the same reason, and so is a scheme with
  // nothing behind it.
  for (const bad of ["/oppgaver", "http://"]) {
    await card.getByLabel("https://…").fill(bad);
    await expect(open).toBeDisabled();
  }

  // …and the moment it becomes a real address, the surface lights up.
  await card.getByLabel("https://…").fill("https://udir.no");
  await expect(open).toBeEnabled();
});

test("the QR toggle persists and says so when the address is too long", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Lenke");
  const card = page.locator('[data-widget-kind="link"]');
  await card.hover();

  // Long enough to be past what a scannable QR can carry (271 UTF-8 bytes,
  // `QR_MAX_URL_BYTES` in link-core.ts) but well inside LINK_URL_MAX_CHARS,
  // so it is a perfectly good link that simply cannot be a code.
  const long = `https://skole.no/${"a".repeat(300)}`;
  await card.getByLabel("https://…").fill(long);
  await expect(card).toContainText("for lang for en QR-kode");
  // …and the hint is instead of a code, never beside one. Nothing is drawn
  // where the code would have been: no plate, no frame, no «loading» square.
  // A shape on a projector tells a class there is something to scan.
  await expect(card.locator("svg[data-qr]")).toHaveCount(0);
  // It is still openable — «no QR» is not «no link».
  await expect(card.getByRole("button", { name: "Åpne lenken" })).toBeEnabled();

  // Turning the code off turns the hint off with it, and the choice survives
  // a reload.
  await card.getByRole("button", { name: "QR-kode" }).click();
  await expect(card).not.toContainText("for lang for en QR-kode");

  await page.reload();
  const after = page.locator('[data-widget-kind="link"]');
  await after.hover();
  await expect(after.getByRole("button", { name: "QR-kode" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("the code is drawn for an address that fits, and disappears when turned off", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Lenke");
  const card = page.locator('[data-widget-kind="link"]');
  const qr = card.locator("svg[data-qr]");

  // A fresh widget has `showQr` on but nothing to encode, and it draws
  // NOTHING rather than an empty plate.
  await expect(qr).toHaveCount(0);

  await card.hover();
  await card.getByLabel("https://…").fill("https://sundaysuite.app");

  // THE LAZY LOAD. The encoder is its own dist chunk (`LazyQr` is the only
  // way into it), so this is the one assertion in the file that waits on a
  // fetch and not just a render — `toBeVisible` polls, which is exactly what
  // makes it a real test of the loading boundary rather than of a timeout.
  // If somebody ever static-imports `qr-core`, this still passes and
  // `check-bundle-budget.mjs` is what notices; if the dynamic import BREAKS
  // in a built bundle, this is what notices (`SUNDAYSCREEN_E2E_TARGET=prod`).
  await expect(qr).toBeVisible();

  // 23 bytes is a version-2 symbol: 25 modules, plus the four-module quiet
  // zone on each side. Pinning the viewBox pins both — a code drawn without
  // its quiet zone scans from a screen and fails off a projector.
  await expect(qr).toHaveAttribute("viewBox", "-4 -4 33 33");
  const d = await qr.locator("path").getAttribute("d");
  expect(d?.startsWith("M")).toBe(true);
  expect(d).not.toContain("NaN");

  // Her choice, immediately: off is off.
  await card.hover();
  await card.getByRole("button", { name: "QR-kode" }).click();
  await expect(qr).toHaveCount(0);

  // …and back on again without a reload, from the module-cached chunk.
  await card.getByRole("button", { name: "QR-kode" }).click();
  await expect(qr).toBeVisible();

  // An address the app will not vouch for takes the code with it — the QR
  // must never carry something the click surface refuses to open.
  await card.getByLabel("https://…").fill("javascript:alert(1)");
  await expect(qr).toHaveCount(0);
});
