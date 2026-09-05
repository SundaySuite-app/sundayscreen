import { expect, test, type Page } from "@playwright/test";

import { E2E_IMAGE_ID, addWidget, installFixtures } from "./harness";

// «Bilde»: choose a picture, see it on the board, reload and find it standing.
//
// What this tier can and cannot reach. The native file dialog and the copy
// into the app's own directory are RUST, and invisible to Playwright by
// construction — that is the whole point of keeping them there (SECURITY.md).
// The fixture backend therefore answers `image_pick` with a fixed id and
// `image_load` with a fixed 1×1 PNG, and what these journeys actually test is
// the half that lives in the browser:
//
//   - the three honest states (no picture / a picture / the picture is
//     missing), which must never collapse into each other,
//   - the blob URL: made from bytes, re-ACQUIRED after a reload (promise 2 —
//     a restart mid-lesson restores the screen exactly),
//   - «fjern bilde» as an empty id and nothing else.
//
// The id-shape scrub, the size ceiling, the magic-byte sniff and the boot
// sweep are Rust's, and Rust's tests pin every one of them.

const card = (page: Page) => page.locator('[data-widget-kind="image"]');

/** The stored config for the one picture widget on the board. */
async function storedImageConfig(page: Page) {
  return page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__e2e_db__") ?? "{}") as {
      layouts?: Record<
        string,
        {
          id: string;
          config?: { kind?: string; imageId?: string; caption?: string };
        }[]
      >;
    };
    return (
      Object.values(db.layouts ?? {})
        .flat()
        .find((w) => w.config?.kind === "image")?.config ?? null
    );
  });
}

test("a picture is chosen, shown, and survives a reload", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Bilde");
  // The empty state is a BUTTON that says what it does — not a frame, not a
  // placeholder. Nothing on the projector may look like a picture that has
  // not finished loading.
  await expect(
    card(page).getByRole("button", { name: "Velg bilde …" }),
  ).toBeVisible();
  await expect(card(page).locator("img")).toHaveCount(0);

  await card(page).getByRole("button", { name: "Velg bilde …" }).click();

  // A blob URL, made in the page from bytes the backend sent — never a path
  // and never a `file:` URL. `toBeVisible` waits for the decode too.
  const img = card(page).locator("img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect(img).toHaveAttribute("data-fit", "contain");

  // The id — not the bytes — is what the board stores.
  expect((await storedImageConfig(page))?.imageId).toBe(E2E_IMAGE_ID);

  await card(page).hover();
  await card(page).getByLabel("Bildetekst …").fill("7B på tur");
  // The caption is DEBOUNCED (the text-widget contract); Enter commits it.
  // Waiting for the stored row rather than for a timeout is what makes the
  // reload below a test of persistence instead of a race.
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await storedImageConfig(page))?.caption)
    .toBe("7B på tur");

  // Promise 2: a restart mid-lesson restores the screen exactly. The blob URL
  // cannot survive a reload — it is per-document — so this is a real test of
  // the re-acquire path, not of a cached string.
  await page.reload();
  const after = card(page).locator("img");
  await expect(after).toBeVisible();
  await expect(after).toHaveAttribute("src", /^blob:/);
  await expect(card(page).getByLabel("Bildetekst …")).toHaveValue("7B på tur");
});

test("«fjern bilde» empties the card and leaves an empty id behind", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Bilde");
  await card(page).getByRole("button", { name: "Velg bilde …" }).click();
  await expect(card(page).locator("img")).toBeVisible();

  await card(page).hover();
  await card(page).getByRole("button", { name: "Fjern bilde" }).click();

  // Back to the empty state, and — the part that matters — the config holds
  // an EMPTY id. There is no delete command: the file is collected by the
  // boot sweep in Rust, which is why removing a picture is this cheap.
  await expect(card(page).locator("img")).toHaveCount(0);
  await expect(
    card(page).getByRole("button", { name: "Velg bilde …", exact: true }),
  ).toBeVisible();
  expect((await storedImageConfig(page))?.imageId).toBe("");
});

test("a picture this machine does not have SAYS so", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Bilde");
  await card(page).getByRole("button", { name: "Velg bilde …" }).click();
  await expect(card(page).locator("img")).toBeVisible();

  // Rewrite the stored id to one the backend has no bytes for — exactly the
  // state a setup imported from another machine lands in when its pictures
  // did not all fit in the file.
  await page.evaluate(() => {
    const KEY = "__e2e_db__";
    const db = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
      layouts?: Record<
        string,
        { config?: { kind?: string; imageId?: string } }[]
      >;
    };
    for (const widgets of Object.values(db.layouts ?? {})) {
      for (const w of widgets) {
        if (w.config?.kind === "image") {
          w.config.imageId = "0192aaaa-bbbb-7ccc-8ddd-eeeeffff0000";
        }
      }
    }
    localStorage.setItem(KEY, JSON.stringify(db));
  });
  await page.reload();

  // A SENTENCE, not an empty frame: on a projector a frame reads as "still
  // loading" for the rest of the lesson, and this state never resolves.
  await expect(card(page)).toContainText("Bildet mangler på denne maskinen");
  await expect(card(page).locator("img")).toHaveCount(0);
  // …and it is NOT the empty state either — the two have different remedies,
  // and offering «Velg bilde …» here would hide that a picture was lost.
  await expect(
    card(page).getByRole("button", { name: "Velg bilde …", exact: true }),
  ).toHaveCount(0);
});

test("the fit toggle is the teacher's, and it persists", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Bilde");
  await card(page).getByRole("button", { name: "Velg bilde …" }).click();
  await expect(card(page).locator("img")).toHaveAttribute(
    "data-fit",
    "contain",
  );

  await card(page).hover();
  await card(page).getByRole("button", { name: "Hele bildet" }).click();
  await expect(card(page).locator("img")).toHaveAttribute("data-fit", "cover");

  await page.reload();
  await expect(card(page).locator("img")).toHaveAttribute("data-fit", "cover");
  await card(page).hover();
  await expect(
    card(page).getByRole("button", { name: "Fyll kortet" }),
  ).toHaveAttribute("aria-pressed", "true");
});
