import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// R4-spor 4.6: the one spec whose job is to notice a chunk that failed to
// load under the PRODUCTION target (`SUNDAYSCREEN_E2E_TARGET=prod`).
//
// English (`app/i18n/locales/en.json`) is the app's only dynamic import
// (`LAZY_LOADERS.en` in `app/lib/i18n.ts`) — under `vite build` it becomes its
// own hashed chunk in `dist/assets/`, fetched only when English activates.
// Every other spec in this suite runs against the eagerly-bundled Norwegian
// catalogue, so none of them would ever notice that chunk going 404, or the
// import rejecting for a CSP reason `vite dev` never enforces.
//
// It turns out there is no path today that reaches it, though — see below.
//
// ## Why this test asserts a FALLBACK, not English text
//
// The obvious journey — set `settings.language = "en"`, expect English UI —
// does not exist yet. `resolveStartupLocale` (app/i18n/index.ts) gates every
// stored value against `ACTIVE_LOCALES`, which is `["no"]` only; English is
// SCAFFOLDED (catalogue exists, kept in parity, unit-tested) but not
// offered. A stored `"en"` resolves straight back to `"no"` — `setLocale`
// (and therefore the lazy `import("../i18n/locales/en.json")`) is never even
// attempted. So this spec cannot be the one that proves the English chunk
// loads under `vite preview`: nothing in the shipped app calls for it yet.
// (Filed as a deviation from the R4 plan's 4.6 recipe — see the agent's
// final report.)
//
// What IS true today, and worth an assertion under the prod target
// specifically, is the honest half of that fallback: a teacher whose
// settings carry a locale code the app cannot yet serve gets a working
// Norwegian board — not a blank screen, not raw i18n keys, not a silently
// half-English page from a load that partly succeeded.
test("a stored locale the app cannot yet serve falls back to an honest Norwegian board", async ({
  page,
}) => {
  await installFixtures(page);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const fixtures = w.__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    const realSettingsGet = fixtures.settings_get as () => Record<
      string,
      unknown
    >;
    // Same seam every other spec-local override uses (chrome.spec.ts,
    // robustness.spec.ts): patch one fixture entry, keep the rest of the
    // mini-backend intact so boot does not fall into hydrateError instead.
    fixtures.settings_get = () => ({
      ...realSettingsGet(),
      language: "en",
    });
  });
  await page.goto("/");

  // The empty board holds its own toolbar open (widgets.length === 0), so
  // this should be unnecessary — woken anyway, the same recipe every other
  // spec in this suite follows, in case that invariant ever changes under
  // the slower prod-preview boot.
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height - 8);

  // Norwegian — not a raw key, not nothing.
  await expect(
    page.getByRole("heading", { name: "Tavla er tom" }),
  ).toBeVisible();
  await expect(
    page.getByText("Verktøylinja ligger langs nederste kant."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();

  // …and not English: a future partial activation that renders some
  // components in the new language and others in the old one is exactly the
  // one-frame bug app/i18n/index.ts's own header warns `setLocale`'s
  // catalogue-then-signal ordering guards against.
  await expect(page.getByText("The board is empty")).toHaveCount(0);
});
