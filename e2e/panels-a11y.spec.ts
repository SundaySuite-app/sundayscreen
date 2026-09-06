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

/** Where the keyboard is, in the three terms these journeys care about.
 *
 *  A widget's popover counts as BEHIND. Its host stands outside the wall on
 *  purpose (a card on the design panel's little board opens its menu through
 *  it), but a popover left standing when a panel opened from the wall is
 *  under the scrim — invisible, and not inert. Classified as «panel» it passed
 *  the ring walk below with the bug in place (R7-slutt S1-4). */
function focusZone(page: Page): Promise<"behind" | "panel" | "body"> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body" as const;
    return el.closest("[data-wall], [data-widget-overlay]")
      ? ("behind" as const)
      : ("panel" as const);
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

test("a card's popover does not survive a panel opening over it", async ({
  page,
}) => {
  // R7-slutt S1-4. The die's appearance menu is open; the backdrop stops the
  // pointer but not the key, so four Shift+Tabs reach «Planlegger» with the
  // menu still up. Enter there left the menu standing UNDER the scrim: not
  // inert (its host is outside the wall), six Tabs from the panel's last
  // control, and holding the top rung of the Escape chain — so the first
  // Escape closed a menu nobody could see and the panel stood. Now the panel
  // opening closes it, in the same flip.
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const die = page.locator('[data-widget-kind="dice"]');
  await die.hover();
  const look = die.locator("[data-dice-look]");
  await look.focus();
  await page.keyboard.press("Enter");
  const overlay = page.locator("[data-widget-overlay]");
  await expect(overlay).toBeVisible();

  // The teacher's own road, no script focus: backwards out of the menu onto
  // the toolbar.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
  const opener = page.getByRole("button", { name: "Planlegger" });
  await expect(opener).toBeFocused();
  await expect(overlay).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(plannerPanel(page)).toBeVisible();
  await expect(overlay).toHaveCount(0);
  // The keyboard went INTO the panel — not stranded on <body> by the menu's
  // own focus-return landing on a trigger that is inert by then.
  expect(await focusZone(page)).toBe("panel");
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await focusZone(page), `tab ${i + 1}`).not.toBe("behind");
  }

  // ONE Escape closes the panel: nothing invisible is holding the top rung.
  await page.keyboard.press("Escape");
  await expect(plannerPanel(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

// ── ADR-020's addendum: nothing visible is dead ─────────────────────────────

/**
 * Every visible button on the page, judged by the one question a teacher
 * asks of it: does a press at its centre reach it?
 *
 * The wall is `inert`, and inert removes hit-testing but not paint — so a
 * button drawn OVER the panel from inside the wall looks exactly like one
 * legitimately covered by the scrim: `elementFromPoint` answers the panel for
 * both. They are told apart by lifting `inert` for the length of one
 * hit-test: a button the press reaches then was painted on top of the modal,
 * and hiding it with `inert` was a lie; one the press still does not reach is
 * under the scrim, which is what modal means. The attribute is put back at
 * once.
 *
 * Skipped, with the reason: buttons that are not visible at all
 * (`checkVisibility` walks the ancestors for `visibility` and `opacity`);
 * buttons whose centre is off-screen; and the dismiss layers — full-viewport
 * buttons whose centre is under the very thing they dismiss, by design, and
 * live at every uncovered pixel.
 */
function deadVisibleButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const dead: string[] = [];
    for (const b of document.querySelectorAll("button")) {
      if (
        !b.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      )
        continue;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width >= window.innerWidth && r.height >= window.innerHeight)
        continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (
        cx < 0 ||
        cy < 0 ||
        cx >= window.innerWidth ||
        cy >= window.innerHeight
      )
        continue;
      const name = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "?";
      const hit = document.elementFromPoint(cx, cy);
      if (hit && b.contains(hit)) continue;
      const inertRoot = b.closest<HTMLElement>("[inert]");
      if (inertRoot) {
        inertRoot.inert = false;
        const lifted = document.elementFromPoint(cx, cy);
        inertRoot.inert = true;
        if (lifted && b.contains(lifted))
          dead.push(`«${name}» — painted over the panel, inert`);
        continue;
      }
      dead.push(`«${name}» — covered by <${hit?.tagName.toLowerCase()}>`);
    }
    return dead;
  });
}

test("nothing visible is dead while a panel is open", async ({ page }) => {
  // Everything that rides at `--z-toast` is on screen at once — the lesson
  // banner (a suggestion in its window), the undo bar (a card just removed) —
  // and then each of the three panels opens over it, and the design session
  // removes a card of its own. R7-slutt S1-2, S1-3, S1-7: all three were
  // «visible but inert» before this guard existed.
  await installFixtures(page, { memberNames: ["Kari", "Ola"] });
  await page.clock.install({ time: new Date("2026-08-31T08:20:00") });
  await page.goto("/");

  // A second class, and a lesson for it at 08:30 — the banner's material.
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("8A");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "7B" }).click();
  await page.getByRole("button", { name: "Planlegger" }).click();
  const panel = plannerPanel(page);
  await panel.getByRole("button", { name: "Timeoppsett", exact: true }).click();
  await panel.getByRole("button", { name: "Legg til time" }).click();
  await panel.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(panel.getByText("Lagret")).toBeVisible();
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await panel.locator("button:has-text('—')").first().click();
  await panel
    .getByLabel("Klasse", { exact: true })
    .selectOption({ label: "8A" });
  await panel.getByLabel("Fag").fill("Norsk");
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await panel.getByRole("button", { name: "Lukk" }).click();

  // Into the window, and a card removed: both `--z-toast` residents are up.
  await page.clock.fastForward(6 * 60_000);
  const banner = page.locator('[data-status="suggestion"]');
  await expect(banner).toBeVisible();
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height - 8);
  await addWidget(page, "Tekst");
  const text = page.locator('[data-widget-kind="text"]');
  // A new card is born under the banner's column; walk it down first, or
  // «Fjern» is under the banner — which is the wall's own overlap and not
  // this guard's subject.
  await text.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowDown");
  await text.hover();
  await text.getByRole("button", { name: "Fjern" }).click();
  await expect(page.getByRole("button", { name: "Angre" })).toBeVisible();

  // The control: on the bare board the guard has nothing to say.
  expect(await deadVisibleButtons(page)).toEqual([]);

  // The planner.
  await page.mouse.move(size.width / 2, size.height - 8);
  await page.getByRole("button", { name: "Planlegger" }).click();
  await expect(panel).toBeVisible();
  expect(await deadVisibleButtons(page)).toEqual([]);

  // …and the design session inside it, with a card of its own removed: the
  // panel's own undo bar must be the one that is live.
  await panel.getByRole("button", { name: "Ukeplan" }).click();
  await panel.getByRole("button", { name: "8A Norsk" }).click();
  await panel
    .getByRole("button", { name: "Lag ny skjerm for denne timen" })
    .click();
  const nameField = panel.getByPlaceholder("Navn på skjermen …");
  await nameField.fill("Vaktskjerm");
  await nameField.press("Enter");
  await expect(panel.getByLabel("Skjerm", { exact: true })).not.toHaveValue("");
  await panel.getByRole("button", { name: "Design skjermen" }).click();
  await expect(panel.getByText("Du designer «Vaktskjerm»")).toBeVisible();
  await addWidget(page, "Klokke");
  const clock = panel.locator('[data-widget-kind="clock"]');
  await clock.hover();
  await clock.getByRole("button", { name: "Fjern" }).click();
  await expect(clock).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Angre" })).toBeVisible();
  expect(await deadVisibleButtons(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel.getByText("Du designer")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // The class list. The session's borrow cleared the wall's pending undo on
  // its way in (a board swap always does), so a fresh removal puts the bar
  // back up for this pass.
  await page.mouse.move(size.width / 2, size.height - 8);
  await addWidget(page, "Tekst");
  const text2 = page.locator('[data-widget-kind="text"]');
  await text2.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowDown");
  await text2.hover();
  await text2.getByRole("button", { name: "Fjern" }).click();
  await expect(page.getByRole("button", { name: "Angre" })).toBeVisible();
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await expect(
    page.getByRole("region", { name: "Klasser og navn" }),
  ).toBeVisible();
  expect(await deadVisibleButtons(page)).toEqual([]);
  await page.keyboard.press("Escape");

  // Attendance.
  await page.mouse.move(size.width / 2, size.height - 8);
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Hvem er her i dag?" }).click();
  await expect(
    page.getByRole("region", { name: "Hvem er her i dag?" }),
  ).toBeVisible();
  expect(await deadVisibleButtons(page)).toEqual([]);
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
