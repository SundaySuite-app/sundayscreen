import { expect, test, type Page, type Route } from "@playwright/test";

import { installFixtures, settleEffects } from "./harness";

// THE LOADING BOUNDARY, measured against a running shell (ADR-019).
//
// `chunkCache` is unit-tested with an injected loader; what only a real
// browser can answer is whether the boundary EXISTS — whether the bundler
// actually kept the planner out of the boot payload, whether the fetch happens
// once, and what the window between the click and the chunk does to a teacher
// who changes her mind. A static import somewhere would put 34 kB back in the
// index chunk with every unit test still green; this is the test that goes red.
//
// ## True in dev AND in prod, deliberately
//
// The two servers spell the module differently — `/planner/PlannerPanel.tsx`
// from Vite's dev middleware, `/assets/PlannerPanel-<hash>.js` from the built
// bundle — so the predicate below matches on the NAME and nothing else. Both
// spellings carry it, and both drop it if the boundary is removed (dev would
// then serve the module as part of the shell's own graph on boot, prod would
// have no such file at all). `SUNDAYSCREEN_E2E_TARGET=prod` is what runs this
// against the real, minified, hash-chunked answer.

/** A request for the planner CHUNK — the module, not the stylesheet beside it.
 *
 *  The CSS is excluded on purpose: Vite emits `PlannerPanel-<hash>.css` for the
 *  same boundary and its own preload helper fetches it alongside, so counting
 *  it would make «loaded once» read as two. What is being counted here is the
 *  module the shell asked for. */
function isPanelChunk(url: string): boolean {
  return /PlannerPanel/.test(url) && !/\.css(\?|$)/.test(url);
}

/** Every panel-chunk request the page has made since `page.goto`. */
function recordPanelChunkRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    if (isPanelChunk(req.url())) seen.push(req.url());
  });
  return seen;
}

const plannerPanel = (page: Page) =>
  page.getByRole("region", { name: "Planlegger" });

const wallIsInert = (page: Page) =>
  page.evaluate(
    () => document.querySelector<HTMLElement>("[data-wall]")?.inert ?? null,
  );

test("boot does not fetch the planner chunk at all", async ({ page }) => {
  const requests = recordPanelChunkRequests(page);
  await installFixtures(page);
  await page.goto("/");

  // The board is up and usable — this is a booted app, not a half-loaded one.
  await expect(page.getByRole("button", { name: "Planlegger" })).toBeVisible();
  await settleEffects(page);

  // …and the planner is not part of it. This is the whole budget argument in
  // one assertion: a teacher who never opens the panel never pays for it.
  expect(requests).toEqual([]);
});

test("the first open fetches it, the second one does not", async ({ page }) => {
  const requests = recordPanelChunkRequests(page);
  await installFixtures(page);
  await page.goto("/");

  const opener = page.getByRole("button", { name: "Planlegger" });
  await expect(opener).toBeVisible();
  await settleEffects(page);
  // The count is taken from BOTH sides of the click, or the assertion below is
  // vacuous: a shell that fetched the panel on boot and never again would also
  // sit at one request forever.
  expect(requests).toEqual([]);

  await opener.click();
  await expect(plannerPanel(page)).toBeVisible();
  expect(requests).toHaveLength(1);

  await page.keyboard.press("Escape");
  await expect(plannerPanel(page)).toHaveCount(0);

  // Second open: the module is CACHED for the session, so no second fetch —
  // and the panel is on screen without another load window. A board that is
  // opened and closed forty times in a day pays the fetch once.
  await opener.click();
  await expect(plannerPanel(page)).toBeVisible();
  await settleEffects(page);
  expect(requests).toHaveLength(1);
});

test("Escape during the load window closes it, and nothing arrives later", async ({
  page,
}) => {
  await installFixtures(page);

  // Hold the chunk back long enough to press a key inside the window. The real
  // window is a few milliseconds off local disk; this is the same window with
  // a human-sized hand in it.
  // Definite assignment: the executor runs synchronously, but TypeScript
  // narrows a `let` initialised to null and cannot see that.
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(
    (url) => isPanelChunk(url.href),
    async (route: Route) => {
      await held;
      await route.continue();
    },
  );

  await page.goto("/");
  const opener = page.getByRole("button", { name: "Planlegger" });
  // From the KEYBOARD, so there is an opener to come back to: a mouse open
  // in this engine focuses the button too, but the promise below is about
  // the keyboard, and the assertion must not pass on a click's side effect.
  await opener.focus();
  await page.keyboard.press("Enter");

  // INSIDE the window: the panel has not mounted, but the board is already
  // modal. Both halves matter — the shell reads the SIGNAL, not the mounted
  // panel, so there is no moment where the class's board is live under a
  // panel that is on its way.
  await expect(plannerPanel(page)).toHaveCount(0);
  await expect.poll(() => wallIsInert(page)).toBe(true);

  // She changes her mind. The Escape chain reads the same signal, so the rung
  // answers even though there is nothing on screen yet.
  await page.keyboard.press("Escape");
  await expect.poll(() => wallIsInert(page)).toBe(false);

  // …and the panel that was on its way must not arrive after the fact. A
  // full-screen dialog appearing by itself over a class is the failure this
  // whole test exists for.
  release();
  await settleEffects(page);
  await expect(plannerPanel(page)).toHaveCount(0);
  expect(await wallIsInert(page)).toBe(false);

  // …and the keyboard is back on «Planlegger». The panel's own focus hook
  // never existed here — it lives in a panel that never mounted — so the
  // boundary hands the opener back itself (R7-slutt S1-5). Measured before:
  // <body>, one Tab from the top of the document.
  await expect(opener).toBeFocused();

  // The abandoned load poisoned nothing: opening again works, and works from
  // the cache the first attempt filled.
  await opener.click();
  await expect(plannerPanel(page)).toBeVisible();
});

test("a load she cancelled says nothing when it fails", async ({ page }) => {
  await installFixtures(page);

  // Held open, then failed — so the rejection lands after she has already
  // pressed Escape.
  // Definite assignment: the executor runs synchronously, but TypeScript
  // narrows a `let` initialised to null and cannot see that.
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(
    (url) => isPanelChunk(url.href),
    async (route: Route) => {
      await held;
      await route.abort("failed");
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Planlegger" }).click();
  await expect.poll(() => wallIsInert(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => wallIsInert(page)).toBe(false);

  release();
  await settleEffects(page);
  // A red plate about a panel she decided not to open is noise on a projector,
  // and the state it would announce — «closed» — is already the state she is
  // looking at. Nothing is a complete answer here.
  await expect(page.locator("[data-toast-stack] > *")).toHaveCount(0);
});

// A chunk that will not load — a broken install, a disk that did not answer.
//
// ⚠️ What this test does NOT assert, because it is not true: that trying again
// works. Measured here first: a failed module fetch stays failed for the life
// of the document — the browser's module map keeps it, so the second
// `import()` never reaches the route below and `attempts` stops at 1. The app
// still asks again (`chunkCache` remembers no failure, which is what
// `lazy-panel.test.ts` pins with an injected loader), and an engine that
// re-fetches would recover; this one does not. Hence the copy names a restart
// as the remedy that always works, and hence the last assertion below is about
// being TOLD every time rather than about recovering.
test("a chunk that will not load says so, and never leaves the board modal", async ({
  page,
}) => {
  await installFixtures(page);

  let attempts = 0;
  await page.route(
    (url) => isPanelChunk(url.href),
    async (route: Route) => {
      attempts++;
      await route.abort("failed");
    },
  );

  await page.goto("/");
  const opener = page.getByRole("button", { name: "Planlegger" });
  await opener.focus();
  await page.keyboard.press("Enter");

  // Said where she is looking — not swallowed into the console while the board
  // sits there refusing to change.
  await expect(page.locator("[data-toast-stack] > *")).toHaveCount(1);
  await expect(
    page.getByText(
      "Fikk ikke åpnet panelet. Prøv igjen — hjelper det ikke, start SundayScreen på nytt.",
    ),
  ).toBeVisible();

  // The SHARP half: the state went back to closed, so the class's board is
  // live and reachable again. A failed load that left `plannerPanelOpen` true
  // would leave the wall `inert` behind a panel that never came — a teacher
  // locked out of her own screen by a file that did not read.
  await expect.poll(() => wallIsInert(page)).toBe(false);
  await expect(plannerPanel(page)).toHaveCount(0);
  // The failed load closed the panel's state; the boundary's cleanup is what
  // sends the keyboard back, since no panel ever mounted to do it.
  await expect(opener).toBeFocused();

  // …and the app tries again rather than going quiet on her: a second press
  // gets a second answer, never a button that has stopped responding.
  await opener.click();
  await expect(page.locator("[data-toast-stack] > *")).toHaveCount(2);
  await expect.poll(() => wallIsInert(page)).toBe(false);
  expect(attempts).toBe(1);
});
