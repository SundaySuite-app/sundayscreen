import { expect, test, type Locator, type Page } from "@playwright/test";

import { installFixtures } from "./harness";

// THE DIE, AS AN OBJECT IN THE ROOM.
//
// R12 replaced a 600 ms pip-scramble with an actual throw; R5 replaced the
// flat silhouettes with a real polyhedron — five bodies constructed from φ,
// turned by quaternions and projected per frame. `die-solids-core.test.ts`,
// `die-orient-core.test.ts` and `die-project-core.test.ts` prove the geometry
// (Euler's χ, opposite faces summing to n+1, every numeral inside the face it
// belongs to, the projection inside the grid for 2000 orientations); the
// physics core proves the flight. What none of them can prove is that the
// arithmetic reaches the DOM and then LETS GO of it — a residual `transform`
// on a face is invisible in a unit test and permanent on a projector, because
// the layout no longer owns that die. The other half of «lets go» is the rAF
// loop itself: it outlives Preact's own bookkeeping if nothing cancels it, so
// the last test in this file removes a die MID-THROW and counts frames.
//
// ## ⚠️ `data-value` and `data-face-up` are DIFFERENT ON PURPOSE
//
//   - `data-value` on the roll area is the ROLL'S PROTOCOL: what the class was
//     told, what is persisted, what comes back after a restart.
//   - `data-face-up` on each die is what is turned toward the room RIGHT NOW.
//
// They agree after a throw and diverge the moment a teacher turns a die with
// her finger to show the class the other sides — which is the whole point of
// the trackball. Nobody should «fix» that by making one read the other.
//
// ## The transform assertions below are the ARCHITECTURE LOCK
//
// The die's rotation lives in projected GEOMETRY, never in a CSS transform.
// That is what lets the flight own `transform` for a pure translation, and it
// is why «the computed transform is the identity at rest» stays true by
// construction rather than by cleanup. Left standing, unchanged, through the
// whole 3-D rewrite: if one of them ever goes red, a rotation has moved into
// CSS and the containment guarantees have quietly moved with it.

/** Add a widget through the TOOLBAR's add menu.
 *
 *  By `aria-label`, not by role+name: on an empty board — which is every board
 *  a test starts from — the empty-state door labels itself with the same
 *  visible text, and a by-role lookup matches both. Same reasoning, and the
 *  same locator, as `readability.spec.ts`. */
async function addWidget(page: Page, label: string): Promise<void> {
  await page.locator('button[aria-label="Legg til verktøy"]').click();
  await page.getByRole("menuitem", { name: label }).click();
}

/** Is `inner` fully inside `outer`? Playwright reports LAYOUT boxes, which an
 *  ancestor's `overflow: hidden` does not shrink — so a die that overhangs the
 *  card shows up here even though the screenshot would look tidy.
 *
 *  A local copy of `readability.spec.ts`'s helper: that file does not export
 *  it, and reaching across spec files for one assertion would couple two
 *  suites that have no other reason to know about each other. */
async function assertContained(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
  what: string,
): Promise<void> {
  const slack = 0.5; // sub-pixel layout rounding, nothing more
  expect(inner.x, `${what}: overhangs the left edge`).toBeGreaterThanOrEqual(
    outer.x - slack,
  );
  expect(inner.y, `${what}: overhangs the top edge`).toBeGreaterThanOrEqual(
    outer.y - slack,
  );
  expect(
    inner.x + inner.width,
    `${what}: overhangs the right edge`,
  ).toBeLessThanOrEqual(outer.x + outer.width + slack);
  expect(
    inner.y + inner.height,
    `${what}: overhangs the bottom edge`,
  ).toBeLessThanOrEqual(outer.y + outer.height + slack);
}

/** Drag the SE handle far up and left, so the widget lands on its own
 *  minSizePx — the worst case every «does it fit» claim has to survive. */
async function shrinkToMinimum(page: Page, kind: string): Promise<void> {
  const widget = page.locator(`[data-widget-kind="${kind}"]`);
  await widget.hover();
  const handle = page.getByRole("button", { name: "Endre størrelse" });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 700, hb.y - 700, { steps: 6 });
  await page.mouse.up();
}

/** The computed `transform` of every die face, as the browser reports it. */
function transforms(roll: Locator): Promise<string[]> {
  return roll
    .locator("svg")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
}

/** «No transform» is spelled two ways depending on how the property got
 *  there — an untouched element says `none`, one whose inline transform was
 *  cleared may report the identity matrix. Both mean the LAYOUT owns the
 *  position again, which is the thing being asserted. */
function isIdentity(value: string): boolean {
  return value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)";
}

/** Every face polygon of the first die, as the renderer last wrote them. The
 *  die's ORIENTATION, in other words: two different orientations of the same
 *  body cannot produce the same list. */
function geometry(dice: Locator): Promise<string> {
  return dice
    .locator("svg[data-solid]")
    .first()
    .locator("[data-face]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("points") ?? "").join("|"),
    );
}

/** A flick: press on the die, throw it across a good part of its own width,
 *  and let go while still moving. Well past `isDrag`'s 4 px, and fast enough
 *  that `flickSpin` returns a rate far above `SPIN_STOP_EPS` — so whether the
 *  die coasts afterwards is decided by the motion PREFERENCE, never by the
 *  gesture being too limp to have earned one. */
async function flick(page: Page, dice: Locator): Promise<void> {
  const die = (await dice.locator("svg[data-solid]").first().boundingBox())!;
  const cx = die.x + die.width / 2;
  const cy = die.y + die.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy + 25, { steps: 10 });
  await page.mouse.up();
}

/** How many rAF callbacks the page has actually RUN, from the counter
 *  `countFrames` installs.
 *
 *  This is a whole-page number and it can be one because the dice widget is
 *  the ONLY thing in `app/` that asks for an animation frame — the timer
 *  derives from the clock, the picker spins in CSS. So on a board whose last
 *  die has been removed, a count that keeps climbing is a loop that outlived
 *  its component, and there is nothing else it could be. */
function rafRuns(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __rafRuns: number }).__rafRuns,
  );
}

/** Install that counter. Must run BEFORE `page.goto`. */
async function countFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __rafRuns: number };
    w.__rafRuns = 0;
    const raf = window.requestAnimationFrame.bind(window);
    // Counted on the way IN to the callback, not when one is requested: a
    // cancelled frame is exactly the thing being asserted about, and a
    // request-side counter would count it anyway.
    window.requestAnimationFrame = (cb: FrameRequestCallback) =>
      raf((tMs) => {
        w.__rafRuns++;
        cb(tMs);
      });
  });
}

/** Open the appearance panel. The card must already be hovered — the settings
 *  row is `visibility: hidden` otherwise, and hidden means unhittable
 *  (F9-funn U#9). */
async function openLook(page: Page, dice: Locator): Promise<Locator> {
  await dice.hover();
  await dice.locator("[data-dice-look]").click();
  const panel = page.locator("[data-widget-overlay]");
  await expect(panel).toBeVisible();
  return panel;
}

/** Set the die type through the panel, and close it again. */
async function setFaces(page: Page, dice: Locator, faces: number) {
  const panel = await openLook(page, dice);
  await panel.locator(`[data-die-faces="${faces}"]`).click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}

test("a throw lands, and the class finds the same answer after a restart", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  // Before the first throw: the empty state, not a fabricated 1. The die is
  // still DRAWN — a real body at an idle tilt — which is exactly why the
  // absence of an answer has to be asserted on the protocol attribute rather
  // than on whether anything is on screen.
  await expect(roll).not.toHaveAttribute("data-value", /.*/);

  await roll.click();
  // `data-value` appears only when the throw has COMMITTED — the flight is
  // over and the value is in the config.
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  const landed = await roll.getAttribute("data-value");

  // …and the face turned toward the room is that value. Exactly one die,
  // exactly one up-face: `data-face-up` is per DIE, not per face.
  const upFaces = dice.locator("svg[data-face-up]");
  await expect(upFaces).toHaveCount(1);
  await expect(upFaces).toHaveAttribute("data-face-up", landed!);

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="dice"] [data-value]'),
  ).toHaveAttribute("data-value", landed!);
  // …and it is painted STILL. Promise 2 is «the screen comes back», not «the
  // screen replays»: a restart mid-lesson must not throw the dice again.
  expect((await transforms(roll)).every(isIdentity)).toBe(true);
  // ARCHITECTURE LOCK — see the header.
  await expect(
    page.locator('[data-widget-kind="dice"] svg[data-face-up]'),
  ).toHaveAttribute("data-face-up", landed!);
});

test("the dice fly, and then hand the position back to the layout", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });
  await dice.hover();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await dice.getByRole("button", { name: "Én terning til" }).click();

  await roll.click();

  // 1. The flight is real. Without this the two assertions below are also
  //    satisfied by a die that never moved, which is exactly the regression
  //    this round is guarding against.
  await expect
    .poll(async () => (await transforms(roll)).some((x) => !isIdentity(x)), {
      timeout: 1000,
      message: "no die ever left its slot — the throw did not animate",
    })
    .toBe(true);

  // 2. …and it stays in the card while it flies. The other widgets on the
  //    board are not the dice's playground.
  const cardMidFlight = (await dice.boundingBox())!;
  for (const die of await roll.locator("svg").all()) {
    await assertContained(
      (await die.boundingBox())!,
      cardMidFlight,
      "a die in flight",
    );
  }

  // 3. When it lands, the inline transform is GONE. A face left holding a
  //    translate looks right until the card is resized or focused, and then
  //    silently sits somewhere it was never laid out. ARCHITECTURE LOCK.
  await expect(roll).toHaveAttribute("data-value", /^\d+-\d+-\d+$/);
  expect(
    (await transforms(roll)).every(isIdentity),
    "a face is still wearing its flight transform",
  ).toBe(true);

  // 4. Three dice, three up-faces, and together they spell the roll. The
  //    tumble is the scramble now, so this is also what proves the landing is
  //    STEERED: the bodies stopped on the numbers the config committed.
  const landed = (await roll.getAttribute("data-value"))!;
  const up = await dice
    .locator("svg[data-face-up]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-face-up")));
  expect(up.join("-")).toBe(landed);

  const card = (await dice.boundingBox())!;
  await assertContained((await roll.boundingBox())!, card, "the landed dice");
});

test("the die type can be changed, and it survives a reload", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);

  await dice.hover();
  // The accessible name explains the control; the LABEL is the current type.
  // The two used to be the same word — the button cycled the type — and now
  // it opens the whole appearance panel, so the row still reads «D6» while
  // the command it performs is «Utseende».
  const look = dice.getByRole("button", { name: "Utseende" });
  await expect(look).toHaveText("D6");
  await setFaces(page, dice, 8);
  await expect(dice.locator("[data-dice-look]")).toHaveText("D8");

  // Changing the type clears the roll: 5-5-6 under a «D8» label is a lie
  // about what the class just watched.
  await expect(roll).not.toHaveAttribute("data-value", /.*/);

  // A d8 is not «a d6 whose numbers might go higher» — it is a different
  // BODY, and that is checkable without waiting for a lucky 7: the octahedron
  // is eight faces, and the renderer owns one node for each of them.
  await expect(dice.locator("svg[data-solid]")).toHaveAttribute(
    "data-solid",
    "8",
  );
  await expect(dice.locator("svg[data-solid] [data-face]")).toHaveCount(8);

  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-8]$/);
  // The number the class reads IS the persisted value — not a second roll.
  await expect(dice.locator("svg[data-face-up]")).toHaveAttribute(
    "data-face-up",
    (await roll.getAttribute("data-value"))!,
  );

  const landed = await roll.getAttribute("data-value");
  await page.reload();
  const reloaded = page.locator('[data-widget-kind="dice"]');
  await reloaded.hover();
  await expect(reloaded.locator("[data-dice-look]")).toHaveText("D8");
  await expect(reloaded.getByRole("button", { name: "Kast" })).toHaveAttribute(
    "data-value",
    landed!,
  );
  await expect(reloaded.locator("svg[data-solid] [data-face]")).toHaveCount(8);
});

test("the appearance panel escapes the card, and its choices stick", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  const landed = await roll.getAttribute("data-value");

  const panel = await openLook(page, dice);

  // ⚠️ THE SEALED BOX. Every card is `overflow: hidden` with
  // `container-type: size`, and layout containment makes it the containing
  // block for `position: fixed` too — so a panel a widget drew ITSELF would
  // be clipped at the card's edge and its backdrop would cover the card
  // instead of the viewport. The panel is drawn by the screen layer for
  // exactly that reason, and «it sticks out past the card» is the only
  // observable proof that it still is.
  const card = (await dice.boundingBox())!;
  const box = (await panel.boundingBox())!;
  const escapes =
    box.x < card.x - 0.5 ||
    box.y < card.y - 0.5 ||
    box.x + box.width > card.x + card.width + 0.5 ||
    box.y + box.height > card.y + card.height + 0.5;
  expect(escapes, "the panel is trapped inside the card").toBe(true);

  // Five finishes, drawn by the REAL renderer — that is what makes the
  // difference between «kasino» and «metall» visible at all, and the swatches
  // are real dice rather than pictures of them.
  await expect(panel.locator("[data-mini-die]")).toHaveCount(5);
  const minis = await panel
    .locator("[data-mini-die] [data-face]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("points") ?? ""));
  expect(minis.length).toBeGreaterThan(20);
  expect(
    minis.every((points) => points.includes(",")),
    "a finish swatch was never painted",
  ).toBe(true);

  await panel.locator('[data-die-color="red"]').click();
  await panel.locator('[data-die-material="wood"]').click();

  // Appearance is NOT protocol: re-cutting the same die out of red wood does
  // not change what it landed on.
  await expect(roll).toHaveAttribute("data-value", landed!);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await page.reload();
  const reloaded = page.locator('[data-widget-kind="dice"]');
  // The look lives on the die's own root, not on the shell: `.dice` is what
  // carries the ramp variables, so it is what carries the two attributes that
  // choose them.
  const look = reloaded.locator("[data-color][data-material]");
  await expect(look).toHaveAttribute("data-color", "red");
  await expect(look).toHaveAttribute("data-material", "wood");
  await expect(reloaded.getByRole("button", { name: "Kast" })).toHaveAttribute(
    "data-value",
    landed!,
  );
});

test("Escape peels the panel first, and «Vis stort» second", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  await dice.hover();
  await dice.getByRole("button", { name: "Vis stort" }).click();
  const scrim = page.locator("[data-focus-scrim]");
  await expect(scrim).toBeVisible();

  // The panel opens OVER the enlarged card and its scrim — which is the whole
  // reason `--z-popover` is a token of its own rather than «the toolbar plus
  // one». Changing the die's look during «Vis stort» is the ordinary case,
  // not an exotic one: that is when the class is looking at it.
  const panel = await openLook(page, dice);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(scrim).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(scrim).toHaveCount(0);
});

test("a die turns under the finger, and stays where it was left", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  const landed = await roll.getAttribute("data-value");
  const atRest = await geometry(dice);

  const die = (await dice.locator("svg[data-solid]").first().boundingBox())!;
  const cx = die.x + die.width / 2;
  const cy = die.y + die.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 12, { steps: 8 });
  await page.mouse.up();

  // 1. The body actually turned — the geometry changed…
  await expect
    .poll(async () => (await geometry(dice)) !== atRest, {
      timeout: 2000,
      message: "the die never moved under the finger",
    })
    .toBe(true);

  // 2. …in the GEOMETRY, not in a CSS transform. ARCHITECTURE LOCK: this is
  //    the assertion that keeps the rotation out of `transform` for good.
  expect((await transforms(roll)).every(isIdentity)).toBe(true);

  // 3. It coasts, and then it STOPS — and stays stopped. No idle return to
  //    square: showing the class the other sides IS the lesson, and a card
  //    that quietly rewinds itself is a card arguing with the teacher.
  //    (The flick's coast is about 2.5 s by construction — see
  //    `die-spin-core.test.ts`, which pins the number.)
  await page.waitForTimeout(3000);
  const stopped = await geometry(dice);
  await page.waitForTimeout(400);
  expect(await geometry(dice), "the die is still turning").toBe(stopped);
  expect(stopped, "the die snapped back to its resting pose").not.toBe(atRest);

  // 4. …and turning a die by hand is NOT a roll. The protocol is untouched;
  //    what the class now sees is a different question, asked with a
  //    different attribute.
  await expect(roll).toHaveAttribute("data-value", landed!);
});

test("a press is not a drag: under the threshold, the dice are thrown", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  const die = (await dice.locator("svg[data-solid]").first().boundingBox())!;
  const cx = die.x + die.width / 2;
  const cy = die.y + die.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Two pixels. Under `isDrag`'s 4 px threshold, so no capture is taken and
  // the click that follows reaches the roll area — the same discrimination
  // `useDrag` makes, from the same helper.
  await page.mouse.move(cx + 2, cy, { steps: 2 });
  await page.mouse.up();

  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
});

test("reduced motion: the answer still arrives, nothing flies", async ({
  page,
}) => {
  // A teacher who has asked the OS for less movement gets the scramble in
  // place: the body STANDS, the number on the face turned to the class
  // changes, and there is one orientation hop at the commit. The flight is a
  // rAF loop, which no media query can reach — so this is the one place the
  // preference is checked in JS, and the one place a regression would be
  // invisible everywhere else.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();
  // Sampled ACROSS the roll, not after it: «no transform at the end» is what
  // the flying version also produces. ARCHITECTURE LOCK.
  for (let i = 0; i < 6; i++) {
    expect(
      (await transforms(roll)).every(isIdentity),
      "a die moved despite prefers-reduced-motion: reduce",
    ).toBe(true);
    await page.waitForTimeout(90);
  }

  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  expect((await transforms(roll)).every(isIdentity)).toBe(true);
  await expect(dice.locator("svg[data-face-up]")).toHaveAttribute(
    "data-face-up",
    (await roll.getAttribute("data-value"))!,
  );
});

test("three d20 fit the smallest card, and so does the three-button row", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await dice.hover();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await dice.getByRole("button", { name: "Én terning til" }).click();
  await setFaces(page, dice, 20);

  // Two digits on three icosahedra is the widest the widget ever gets.
  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^\d+-\d+-\d+$/);

  await shrinkToMinimum(page, "dice");
  await dice.hover();

  const card = (await dice.boundingBox())!;
  await assertContained((await roll.boundingBox())!, card, "three d20");
  for (const die of await roll.locator("svg").all()) {
    await assertContained((await die.boundingBox())!, card, "one d20");
  }

  // The settings row gained a third button in R4 and did NOT gain a fourth in
  // R5 — the type button became the appearance trigger instead, which is the
  // receipt for merging three knobs into one panel. It is `width:
  // max-content` with a max-width cap and `flex-wrap: wrap`, so an overflow
  // does not clip — it WRAPS, onto a second line printed over the dice. Same
  // tops means one line.
  const tops = await dice
    .locator("[data-settings-btn]")
    .evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
  expect(tops).toHaveLength(3);
  expect(
    new Set(tops).size,
    `the three settings buttons wrapped onto ${new Set(tops).size} lines`,
  ).toBe(1);

  const row = dice.locator("[data-settings-row]");
  await assertContained((await row.boundingBox())!, card, "the settings row");
});

test("reduced motion: the die still follows the finger, but lets go of it", async ({
  page,
}) => {
  // Design choice 7, and the one half of `prefers-reduced-motion` no unit
  // test can reach: DIRECT MANIPULATION IS NOT «MOTION». A teacher who asked
  // her OS for less movement still gets a die that turns 1:1 under her
  // finger — taking that away would not be calm, it would be a broken
  // trackball. What she does not get is INERTIA: the die stops the instant
  // she lets go, because coasting is movement she did not ask for.
  await installFixtures(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();
  await expect(roll).toHaveAttribute("data-value", /^[1-6]$/);
  const landed = await roll.getAttribute("data-value");

  await page.emulateMedia({ reducedMotion: "reduce" });

  const atRest = await geometry(dice);
  await flick(page, dice);

  // 1. The body turned WHILE the finger was on it.
  const released = await geometry(dice);
  expect(released, "the die did not follow the finger").not.toBe(atRest);

  // 2. …and the moment the finger left, it was done. No coast, no flick.
  await page.waitForTimeout(300);
  expect(
    await geometry(dice),
    "the die coasted despite prefers-reduced-motion: reduce",
  ).toBe(released);

  // 3. Still in the geometry, still not in a transform. ARCHITECTURE LOCK.
  expect((await transforms(roll)).every(isIdentity)).toBe(true);

  // 4. …and turning it by hand did not re-roll it, here either.
  await expect(roll).toHaveAttribute("data-value", landed!);

  // 5. THE SAME GESTURE, with the preference lifted, DOES coast. Without
  //    this, assertion 2 is also satisfied by a flick too weak to have
  //    started a coast in the first place — a green test that proves the
  //    mouse moved slowly.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await flick(page, dice);
  const justReleased = await geometry(dice);
  await page.waitForTimeout(150);
  expect(
    await geometry(dice),
    "the flick never coasted even with motion allowed — assertion 2 proves nothing",
  ).not.toBe(justReleased);
});

test("a die removed mid-throw takes its animation loop with it", async ({
  page,
}) => {
  // The rAF loop is the one thing in the widget that keeps running after
  // Preact has stopped asking it to. `useEffect(() => cleanup, [])` cancels
  // the frame, the interval and the timeout — and a leak here is invisible
  // in every other test in this file, because they all let the throw finish.
  // On a projector it is an 8-hour school day of a loop repainting nodes
  // that are no longer in the document.
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  });

  await installFixtures(page);
  await countFrames(page);
  await page.goto("/");
  await addWidget(page, "Terning");

  const dice = page.locator('[data-widget-kind="dice"]');
  const roll = dice.getByRole("button", { name: "Kast" });

  await roll.click();

  // The loop is RUNNING — asserted, not assumed. This is what makes the
  // removal below happen mid-flight rather than after a throw that quietly
  // finished while Playwright was busy.
  const before = await rafRuns(page);
  await page.waitForTimeout(100);
  const during = await rafRuns(page);
  expect(during, "the throw never started a rAF loop to leak").toBeGreaterThan(
    before,
  );

  await dice.hover();
  await page.getByRole("button", { name: "Fjern" }).click();
  await expect(dice).toHaveCount(0);

  // One frame may already have been dispatched when the component went away;
  // let it land, then take the reading that has to hold still.
  await page.waitForTimeout(100);
  const atRemoval = await rafRuns(page);

  // Well past the throw's own 1100 ms — a loop that only stopped because the
  // flight ended would still be counting through this window.
  await page.waitForTimeout(1500);
  expect(
    await rafRuns(page),
    "a rAF loop survived the widget that started it",
  ).toBe(atRemoval);

  // …and it went quietly. A cleanup that throws on unmount leaves the board
  // in a half-rendered state that no later assertion in this file would see.
  expect(problems, problems.join("\n")).toEqual([]);

  // The board is still a working board: the removal is undoable, which is
  // also the cheapest proof that the shell survived the teardown.
  await page.getByRole("button", { name: "Angre" }).click();
  await expect(dice).toHaveCount(1);
});
