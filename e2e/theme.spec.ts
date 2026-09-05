import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// «Skjermfarge» — the screen's own backdrop. Three facts a teacher depends on:
// the click recolours the board, a restart mid-lesson brings the colour back
// (promise 2), and the colour belongs to the SCREEN rather than to the app, so
// switching screens switches boards.

/** The board itself. `main > …` rather than a bare `[data-theme]`: the five
 *  swatches in the menu carry the attribute too (each one paints itself in the
 *  board it stands for), and they live deep inside the toolbar — the surface is
 *  the shell's own direct child. A CSS-module class name is not an option: it
 *  is hashed, and differently in dev and in a build. */
const surface = (page: import("@playwright/test").Page) =>
  page.locator("main > [data-theme]");

async function openSceneMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
}

/** Picking a colour deliberately LEAVES the menu open — the board recolours
 *  behind it, so the choice is its own preview and a second try is one click
 *  away. That also means a journey has to close it before reaching for the
 *  trigger again: the menu's backdrop covers the toolbar. */
async function closeSceneMenu(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The swatch for one theme. `exact` is not optional here: «Standard» is a
 *  prefix of «Standard skjerm» on the switcher trigger, and Playwright's
 *  by-name matching is a SUBSTRING match — without it an assertion can quietly
 *  resolve to the wrong control (or to two). */
function swatch(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

test("a screen keeps the colour it was given, across a restart", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  // The board starts on today's colour — the default theme is the board a
  // teacher who never opens this row has always had.
  await expect(surface(page)).toHaveAttribute("data-theme", "standard");

  await openSceneMenu(page);
  await expect(page.getByText("Skjermfarge")).toBeVisible();
  await swatch(page, "Tavle").click();

  // The board recolours behind the still-open menu — the choice is its own
  // preview — and the swatch says which one is on.
  await expect(surface(page)).toHaveAttribute("data-theme", "tavle");
  // R6/F9: the empty-state HIERARCHY survives a themed backdrop — the hint is
  // dimmed against the title (tokens.test.ts pins the AA floor of the dimmed
  // ink; THIS line pins that the rule is actually applied), and standard
  // keeps its two real ink levels untouched (asserted further down).
  await expect(surface(page).locator("[class*='emptyHint']")).toHaveCSS(
    "opacity",
    "0.9",
  );
  await expect(swatch(page, "Tavle")).toHaveAttribute("aria-pressed", "true");
  await expect(swatch(page, "Standard")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Promise 2: the restart mid-lesson finds the same screen.
  await page.reload();
  await expect(surface(page)).toHaveAttribute("data-theme", "tavle");
});

test("the colour belongs to the SCREEN, not to the app", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  // A library screen, coloured warm.
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Skriveøkt");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  await openSceneMenu(page);
  await swatch(page, "Varm").click();
  await expect(surface(page)).toHaveAttribute("data-theme", "varm");
  await closeSceneMenu(page);

  // Back to the class default: its own colour, untouched by the choice above.
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Standard — 7B" }).click();
  await expect(surface(page)).toHaveAttribute("data-theme", "standard");

  // …and a class default may be recoloured too — it is the screen on the wall
  // most of the week, so it is deliberately NOT library-only.
  await openSceneMenu(page);
  await swatch(page, "Kjølig").click();
  await expect(surface(page)).toHaveAttribute("data-theme", "kjolig");
  await closeSceneMenu(page);

  // Switching back finds the library screen exactly as it was left.
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Skriveøkt" }).click();
  await expect(surface(page)).toHaveAttribute("data-theme", "varm");
});

test("a saved copy of a screen keeps its colour", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await openSceneMenu(page);
  await swatch(page, "Papir").click();
  await expect(surface(page)).toHaveAttribute("data-theme", "papir");
  await closeSceneMenu(page);

  // «Lagre som ny skjerm …» copies what is on the board — the colour is part
  // of what the teacher recognises the screen by.
  await openSceneMenu(page);
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Mattestart");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  await expect(page.getByRole("button", { name: "Bytt skjerm" })).toContainText(
    "Mattestart",
  );
  await expect(surface(page)).toHaveAttribute("data-theme", "papir");
});
