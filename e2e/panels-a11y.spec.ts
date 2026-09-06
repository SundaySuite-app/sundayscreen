import { expect, test, type Locator, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// WHAT THE KEYBOARD AND A SCREEN READER GET (R7, funn 2 · 4 · 5 · 7).
//
// Four separate promises, all measured against the running shell because none
// of them is visible from a unit test:
//
//   * a modal panel is modal — the keyboard cannot reach the board behind it,
//     and it goes back to the control that opened it;
//   * the two toolbar switchers can be SAID out loud («klikk 7B»);
//   * no menu's first tab stop is an invisible full-screen dismiss layer;
//   * a status message lives in a live region that existed before it did.

/** Where the keyboard is, in the three terms these journeys care about. */
function focusZone(page: Page): Promise<"behind" | "panel" | "body"> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body" as const;
    return el.closest("[data-wall]") ? ("behind" as const) : ("panel" as const);
  });
}

/** Try to put the keyboard on a control BEHIND the scrim, from script.
 *
 *  This is the crisp half of «inert»: an inert element refuses focus outright,
 *  so the answer is «refused» with the fix and «focused» without it. A Tab
 *  walk alone could pass by accident on a day the ring happened to be short.
 */
function tryFocusBehind(page: Page, labelPrefix: string): Promise<string> {
  return page.evaluate((prefix) => {
    const btn = document.querySelector<HTMLElement>(
      `[data-wall] button[aria-label^="${prefix}"]`,
    );
    if (!btn) return "missing";
    btn.focus();
    return document.activeElement === btn ? "focused" : "refused";
  }, labelPrefix);
}

const plannerPanel = (page: Page): Locator =>
  page.getByRole("region", { name: "Planlegger" });

// ── funn 2: the panels are modal for the keyboard ───────────────────────────

test("the planner takes the keyboard, keeps it, and hands it back", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  // A card on the board, because the measured bug ended ON one: Tab out of the
  // panel landed on a text card's «Fjern», and a timer deleted mid-countdown
  // is not something Undo can restore.
  await addWidget(page, "Tekst");

  const opener = page.getByRole("button", { name: "Planlegger" });
  await opener.click();
  await expect(plannerPanel(page)).toBeVisible();

  // IN: the keyboard is inside the panel from the first frame, not left
  // standing on the button behind the scrim.
  expect(await focusZone(page)).toBe("panel");

  // BEHIND: the toolbar's switchers cannot be reached at all.
  expect(await tryFocusBehind(page, "Bytt klasse")).toBe("refused");
  expect(await tryFocusBehind(page, "Bytt skjerm")).toBe("refused");
  expect(await tryFocusBehind(page, "Fjern")).toBe("refused");

  // …and neither can the tab ring wander there. Twenty-five presses is more
  // than a full circuit of the panel.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await focusZone(page), `tab ${i + 1}`).not.toBe("behind");
  }

  // OUT: closing hands the keyboard back to the control that opened it —
  // measured before this, it was dropped on <body>.
  await plannerPanel(page).getByRole("button", { name: "Lukk" }).click();
  await expect(plannerPanel(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Escape closes the planner and returns the keyboard too", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  const opener = page.getByRole("button", { name: "Planlegger" });
  await opener.click();
  await expect(plannerPanel(page)).toBeVisible();

  // ONE layer per press, unchanged: the panel is the «overlay» rung.
  await page.keyboard.press("Escape");
  await expect(plannerPanel(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the manage panel returns the keyboard to the class switcher", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Bytt klasse" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  const panel = page.getByRole("region", { name: "Klasser og navn" });
  await expect(panel).toBeVisible();

  expect(await focusZone(page)).toBe("panel");
  expect(await tryFocusBehind(page, "Bytt skjerm")).toBe("refused");

  // The MENU ITEM that opened this is unmounted by the same click, so it is
  // not somewhere to return to. The switcher's trigger is — ClassSwitcher puts
  // the keyboard there before it flips the signals.
  await panel.getByRole("button", { name: "Lukk" }).click();
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("«Hvem er her i dag?» is modal too", async ({ page }) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Bytt klasse" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Hvem er her i dag?" }).click();
  const panel = page.getByRole("region", { name: "Hvem er her i dag?" });
  await expect(panel).toBeVisible();

  expect(await focusZone(page)).toBe("panel");
  expect(await tryFocusBehind(page, "Bytt skjerm")).toBe("refused");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the panel — and the popover host — stand OUTSIDE the wall", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Planlegger" }).click();
  await expect(plannerPanel(page)).toBeVisible();

  // Where the wrapper is drawn is the whole of ADR-016's stake in this fix. A
  // design session BORROWS the board and mounts the real `<Surface/>` INSIDE
  // this panel, and a card there opens its popover through the shell's
  // `WidgetOverlay` host. One level too high — `inert` on `#app`, or a
  // wrapper around the panels too — and the editor the session exists to give
  // her would be frozen, with the die's appearance menu behind glass in the
  // one place it is opened from a panel. `design.spec.ts` is the journey;
  // this is the structure it rests on.
  const structure = await page.evaluate(() => {
    const wall = document.querySelector<HTMLElement>("[data-wall]");
    const panel = document.querySelector('[aria-label="Planlegger"]');
    const host = document.querySelector("main")?.children;
    return {
      wallInert: wall?.inert ?? null,
      panelInsideWall: !!panel?.closest("[data-wall]"),
      // The shell's own children: the wall, then everything a panel may need
      // to stay live over it.
      siblingsOutsideWall: host ? host.length - 1 : 0,
    };
  });
  expect(structure.wallInert).toBe(true);
  expect(structure.panelInsideWall).toBe(false);
  expect(structure.siblingsOutsideWall).toBeGreaterThan(0);
});

// ── funn 4: label in name ───────────────────────────────────────────────────

test("the two switchers can be said out loud", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  // WCAG 2.5.3: the accessible name CONTAINS the visible one, so «klikk 7B»
  // reaches the button that says 7B. Asserted as the whole name, because the
  // old fixed «Bytt klasse» is a substring of the new one and a
  // `getByRole(name:)` lookup would pass either way.
  await expect(
    page.getByRole("button", { name: "Bytt klasse — «7B»", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Bytt skjerm — «Standard skjerm»",
      exact: true,
    }),
  ).toBeVisible();

  // …and it follows the name, rather than being a one-off string.
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page.getByPlaceholder("Navn på skjermen …").fill("Norsktavla");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Bytt skjerm — «Norsktavla»",
      exact: true,
    }),
  ).toBeVisible();
});

// ── funn 5a: the dismiss layer is not the first tab stop ────────────────────

test("opening a menu with the keyboard lands on a real choice", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Legg til verktøy" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Tekst" })).toBeVisible();

  // Before this, the first Tab landed on the backdrop: a full-screen button
  // whose focus ring is drawn outside the window, and whose Enter closes the
  // menu the teacher just opened.
  await page.keyboard.press("Tab");
  const landed = await page.evaluate(() => ({
    role: document.activeElement?.getAttribute("role"),
    text: document.activeElement?.textContent?.trim(),
  }));
  expect(landed.role).toBe("menuitem");
  expect(landed.text).toBe("Tekst");
});

test("every dismiss backdrop is out of the tab order", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const open = async (openIt: () => Promise<void>) => {
    await openIt();
    // One rule, five menus: the layer that is `position: fixed; inset: 0`
    // never answers to Tab. It stays a real button for a pointer and for an
    // AT click — only the KEY is taken away.
    const stops = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.width >= window.innerWidth &&
            r.height >= window.innerHeight &&
            b.tabIndex !== -1
          );
        })
        .map((b) => b.getAttribute("aria-label")),
    );
    expect(stops).toEqual([]);
    await page.keyboard.press("Escape");
  };

  await open(async () => {
    await page.getByRole("button", { name: "Legg til verktøy" }).click();
  });
  await open(async () => {
    await page.getByRole("button", { name: "Bytt klasse" }).click();
  });
  await open(async () => {
    await page.getByRole("button", { name: "Bytt skjerm" }).click();
  });
  await open(async () => {
    const die = page.locator('[data-widget-kind="dice"]');
    await die.hover();
    await die.locator("[data-dice-look]").click();
    await expect(page.locator("[data-widget-overlay]")).toBeVisible();
  });
});

// ── funn 5b: the focus ring is visible on a blackboard screen ───────────────

test("the focus ring survives the tavle backdrop", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("button", { name: "Tavle", exact: true }).click();
  await expect(page.locator("[data-wall] > [data-theme]")).toHaveAttribute(
    "data-theme",
    "tavle",
  );
  await page.keyboard.press("Escape");

  // The empty board's signpost is the ONE control that stands directly on the
  // backdrop, so it is where a single-tone ring disappeared: --focus against
  // --scene-tavle-bg is 1.06:1.
  const action = page.getByRole("button", { name: "Velg et verktøy" });
  await expect(action).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await action.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(action).toBeFocused();

  const ring = await action.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      matches: el.matches(":focus-visible"),
      outline: cs.outlineColor,
      shadow: cs.boxShadow,
    };
  });
  // A real keyboard focus, not a programmatic one — `:focus-visible` is what
  // the rule is keyed on.
  expect(ring.matches).toBe(true);
  expect(ring.outline).toBe("rgb(35, 39, 47)");
  // The second tone. Without it the ring is ink-on-near-black and the teacher
  // has no way to see where the keyboard is.
  expect(ring.shadow).toContain("rgb(255, 255, 255)");
});

// ── funn 7: status messages are announced ───────────────────────────────────

test("the toast host is a live region that exists before the first toast", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola", "Per"] });
  await page.goto("/");

  // The classic trap: a polite region that arrives WITH its first message is
  // a new subtree, not a change, and is never spoken. So the host is mounted
  // empty from boot.
  const stack = page.locator("[data-toast-stack]");
  await expect(stack).toHaveAttribute("role", "status");
  await expect(stack).toHaveCount(1);
  await expect(stack.locator("> *")).toHaveCount(0);

  // …and it still receives the message it is there for.
  await page.evaluate(() => {
    const w = window as unknown as {
      __SUNDAYSCREEN_FIXTURES__: Record<string, unknown>;
    };
    w.__SUNDAYSCREEN_FIXTURES__.groups_split = () => {
      throw new Error("validation");
    };
  });
  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await page.getByRole("menuitem", { name: "Grupper" }).click();
  await page.getByRole("button", { name: "Del inn" }).click();
  await expect(stack.locator("> *")).toHaveCount(1);
});

test("the sticky error chip is an alert, and the name picker speaks", async ({
  page,
}) => {
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await page.addInitScript(() => {
    const fixtures = (window as unknown as Record<string, unknown>)
      .__SUNDAYSCREEN_FIXTURES__ as Record<string, unknown>;
    fixtures.boot_fault = {
      kind: "unreadable",
      dbPath: "/Users/laerer/sundayscreen.sqlite",
      schemaVersion: null,
    };
  });
  await page.goto("/");

  // ASSERTIVE, and the one place in the app that earns it: this says the board
  // has stopped saving, and it stays until the state changes.
  await expect(page.locator('[data-status="error"]').first()).toHaveAttribute(
    "role",
    "alert",
  );

  // The drawn name is the widget's whole answer and nothing moves to announce
  // it. `aria-busy` covers the 700 ms tease, which would otherwise read out a
  // dozen names the draw never landed on.
  await addWidget(page, "Navnetrekker");
  const display = page.locator("[data-display]");
  await expect(display).toHaveAttribute("aria-live", "polite");
});
