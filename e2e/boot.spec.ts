import { expect, test } from "@playwright/test";

import { installFixtures } from "./harness";

// The browser tier's first journey: the shell boots with NO backend. The
// fixture seam answers the boot commands — proof the whole chain (shim →
// settings → i18n → class bootstrap → render) holds together outside Tauri.

test("boots with fixtures into the working shell", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  // The toolbar is up, with the add menu and the active class.
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();
  await expect(page.getByText("7B")).toBeVisible();
  await expect(page.getByText("0.0.0-e2e")).toBeVisible();
  // No hydrate-error chip — the settings read succeeded.
  await expect(page.locator('[data-status="error"]')).toHaveCount(0);
});

// The planner is the app's biggest feature and it used to live behind an
// unlabelled icon. It now carries its name — and the name must NOT be
// duplicated into an aria-label, which would override the visible text for a
// screen reader and could drift from it at the next translation.

test("the planner button carries its name, not just an icon", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  const planner = page.getByRole("button", { name: "Planlegger", exact: true });
  await expect(planner).toBeVisible();
  await expect(planner).toHaveText("Planlegger");
  await expect(planner).not.toHaveAttribute("aria-label", /./);
  // The tooltip stays.
  await expect(planner).toHaveAttribute("title", "Planlegger");

  await planner.click();
  await expect(page.getByRole("button", { name: "Ukeplan" })).toBeVisible();
});

// The toolbar centres itself in a flex dock now (the old `left: 50%` +
// transform made it the containing block for every fixed-position backdrop
// inside it), but it is still ONE row that free text can overflow: a word on
// the planner button costs ~86 px, and it DID wrap at 1024×768 before the
// switcher labels got their ellipsis. Measured with long names in both.

test("the toolbar stays ONE row at 1024×768 with long names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installFixtures(page);
  await page.goto("/");

  // A long class name …
  await page.getByRole("button", { name: "Bytt klasse" }).click();
  await page.getByRole("menuitem", { name: "Administrer klasser …" }).click();
  await page.getByPlaceholder("Ny klasse …").fill("Innføringsklassen");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();

  // … and a screen name well past the trigger's ceiling, which is the one
  // free-text field a teacher can make arbitrarily long.
  await page.getByRole("button", { name: "Bytt skjerm" }).click();
  await page.getByRole("menuitem", { name: "Lagre som ny skjerm …" }).click();
  await page
    .getByPlaceholder("Navn på skjermen …")
    .fill("Skriveøkt med stillelesing og skriverammer");
  await page.getByPlaceholder("Navn på skjermen …").press("Enter");

  // Wake the chrome: it hides on idle, and `visibility: hidden` takes it out
  // of the a11y tree entirely.
  await page.mouse.move(512, 760);
  const footer = page.locator("footer");
  await expect(footer).toBeVisible();

  const m = await footer.evaluate((el) => {
    const cs = getComputedStyle(el);
    const kids = [...el.children];
    return {
      height: el.getBoundingClientRect().height,
      width: el.getBoundingClientRect().width,
      // Border included: `getBoundingClientRect` measures the border box.
      pad:
        parseFloat(cs.paddingTop) +
        parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) +
        parseFloat(cs.borderBottomWidth),
      tallest: Math.max(...kids.map((c) => c.getBoundingClientRect().height)),
      contentWidth: kids.reduce(
        (n, c) => n + c.getBoundingClientRect().width,
        0,
      ),
    };
  });
  // One row means the box is exactly its padding plus its tallest child.
  expect(m.height, JSON.stringify(m)).toBeLessThanOrEqual(
    m.pad + m.tallest + 1,
  );

  // And it is inside the screen, both edges.
  const box = (await footer.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
});

// Without fixtures every wired command legitimately rejects — the shell must
// still render (never a white screen), and it must be HONEST about the
// failed settings read rather than pretending defaults were chosen.

test("boots without fixtures into the honest degraded state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Legg til verktøy" }),
  ).toBeVisible();
  await expect(page.locator('[data-status="error"]')).toBeVisible();
});
