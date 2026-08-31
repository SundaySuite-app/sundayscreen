import { expect, test, type Page } from "@playwright/test";

import { addWidget, installFixtures } from "./harness";

// The timer under a MOCKED clock (Playwright's page.clock fakes Date and
// every timer), so the journeys are deterministic and instant.

test("a countdown runs, warns near zero, and finishes", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await expect(timer.getByText("05:00")).toBeVisible();

  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("04:00")).toBeVisible();
  await expect(timer.locator('[data-tone="calm"]')).toHaveCount(1);

  // Inside the last minute the tone shifts to warn.
  await page.clock.fastForward(3 * 60_000 + 30_000);
  await expect(timer.getByText("00:30")).toBeVisible();
  await expect(timer.locator('[data-tone="warn"]')).toHaveCount(1);

  await page.clock.fastForward(31_000);
  await expect(timer.getByText("00:00")).toBeVisible();
  await expect(timer.locator('[data-tone="done"]')).toHaveCount(1);
});

test("pause freezes the derived remainder; resume continues", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(90_000);
  await timer.getByRole("button", { name: "Pause" }).click();
  await expect(timer.getByText("03:30")).toBeVisible();

  // Paused: the wall clock keeps moving, the timer does not.
  await page.clock.fastForward(10 * 60_000);
  await expect(timer.getByText("03:30")).toBeVisible();

  await timer.getByRole("button", { name: "Fortsett" }).click();
  await page.clock.fastForward(30_000);
  await expect(timer.getByText("03:00")).toBeVisible();
});

test("the stopwatch counts up and banks across pauses", async ({ page }) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();
  await timer.getByRole("button", { name: "Stoppeklokke" }).click();
  await expect(timer.getByText("00:00")).toBeVisible();

  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(65_000);
  await expect(timer.getByText("01:05")).toBeVisible();

  await timer.getByRole("button", { name: "Pause" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("01:05")).toBeVisible();

  await timer.getByRole("button", { name: "Fortsett" }).click();
  await page.clock.fastForward(55_000);
  await expect(timer.getByText("02:00")).toBeVisible();
});

test("a preset sets the length in ONE click, and it persists", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await expect(timer.getByText("05:00")).toBeVisible();

  // «Dere får tjue minutter» used to be fifteen clicks in front of a
  // waiting class.
  await timer.hover();
  await timer.getByRole("button", { name: "Sett til 20 minutter" }).click();
  await expect(timer.getByText("20:00")).toBeVisible();
  await expect(
    timer.getByRole("button", { name: "Sett til 20 minutter" }),
  ).toHaveAttribute("data-current", "true");

  await page.reload();
  await expect(
    page.locator('[data-widget-kind="timer"]').getByText("20:00"),
  ).toBeVisible();
});

test("«two more minutes» moves the finish line, and the amber stops lying", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Start" }).click();

  // Inside the last minute: the class can see it is nearly over.
  await page.clock.fastForward(4 * 60_000 + 30_000);
  await expect(timer.getByText("00:30")).toBeVisible();
  await expect(timer.locator('[data-tone="warn"]')).toHaveCount(1);

  // The extension is possible AT ALL now — before, the only way to give two
  // more minutes was to reset the countdown the class was watching.
  await timer.hover();
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await timer.getByRole("button", { name: "Ett minutt til" }).click();
  await expect(timer.getByText("02:30")).toBeVisible();
  // Free with it: the colour stops claiming there is a hurry.
  await expect(timer.locator('[data-tone="calm"]')).toHaveCount(1);

  await timer.getByRole("button", { name: "Ett minutt mindre" }).click();
  await expect(timer.getByText("01:30")).toBeVisible();

  // The countdown was never restarted — it keeps running from where it was.
  await page.clock.fastForward(30_000);
  await expect(timer.getByText("01:00")).toBeVisible();

  // And the two groups never stand together: the presets are gone while the
  // clock runs, the ± is gone while it is idle.
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(0);
  await timer.getByRole("button", { name: "Nullstill" }).click();
  await timer.hover();
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(5);
  await expect(
    timer.getByRole("button", { name: "Ett minutt til" }),
  ).toHaveCount(0);
});

test("at its SMALLEST the timer keeps the five presets on one line", async ({
  page,
}) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();

  // Drag the SE handle far past the minimum; `minSizePx` (260×180) stops it.
  const hb = (await timer
    .getByRole("button", { name: "Endre størrelse" })
    .boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 500, hb.y - 500, { steps: 10 });
  await page.mouse.up();

  const box = (await timer.boundingBox())!;
  expect(Math.round(box.width)).toBe(260);
  expect(Math.round(box.height)).toBe(180);

  // The row WRAPS at this width — it is allowed to. What it must not do is
  // break up in the middle of the digits, which is the reason there are five
  // pills and not six.
  await timer.hover();
  const tops = await timer
    .getByRole("button", { name: /^Sett til/ })
    .evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
  expect(tops).toHaveLength(5);
  expect(new Set(tops).size).toBe(1);
});

test("at its SMALLEST «Start» is still the button under the pointer", async ({
  page,
}) => {
  // The row DOES wrap onto two lines at the timer's floor — that is allowed,
  // and the test above is what keeps the break out of the digits. What is not
  // allowed is where those two lines landed: `.timer` was the one narrow
  // widget with no bottom reserve, so the row printed itself over «Start» and
  // `elementFromPoint` in the middle of the button returned «Sett til 10
  // minutter» (R4-funn F14). The row appears exactly when the teacher reaches
  // for the card, so reaching for the card took the button away from her.
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();

  const hb = (await timer
    .getByRole("button", { name: "Endre størrelse" })
    .boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 500, hb.y - 500, { steps: 10 });
  await page.mouse.up();

  const card = (await timer.boundingBox())!;
  expect(Math.round(card.width)).toBe(260);
  expect(Math.round(card.height)).toBe(180);

  // With the row REVEALED — `visibility: hidden` is not hit-testable, so the
  // measurement is only worth anything while the pointer is on the card.
  await timer.hover();
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(5);
  const covered = await timer
    .getByRole("button", { name: "Start" })
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return hit && !el.contains(hit)
        ? (hit.closest("button")?.getAttribute("aria-label") ?? hit.tagName)
        : null;
    });
  expect(covered).toBeNull();

  // …and the price was paid in digit height, not in clipped digits: the
  // number is wholly inside the card (the shell's `overflow: hidden` would
  // simply have cut the top off it) and still twice the size of body text.
  const digits = timer.getByText("05:00");
  const box = (await digits.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(card.y);
  expect(box.y + box.height).toBeLessThanOrEqual(card.y + card.height);
  const px = await digits.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );
  expect(px).toBeGreaterThanOrEqual(20);
});

// ── «Til timen slutter» ─────────────────────────────────────────────────────
//
// The app has known when the lesson ends since the planner landed and has
// never said it. The pill is the sentence — and it may only exist while a
// lesson is actually running, which is the half a weekday-indexed planner is
// historically bad at (the R11 weekend lock).

/** One lesson in the template (08:30–09:15) on MONDAY, subject «Norsk». The
 *  planner UI is the only door into the fixture store, and one period plus
 *  one slot is the smallest week that resolves to a lesson. */
async function planMondayLesson(page: Page): Promise<void> {
  await page.goto("/?goto=planner:periods");
  // A fresh dev server can push one vite full-reload shortly after boot; let
  // it land BEFORE we interact, or it wipes the panel mid-journey.
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Legg til time" }).click();
  await page.getByRole("button", { name: "Lagre timeoppsett" }).click();
  await expect(page.getByText("Lagret")).toBeVisible();

  await page.getByRole("button", { name: "Ukeplan" }).click();
  await page.locator("button:has-text('—')").first().click();
  await page.getByLabel("Fag").fill("Norsk");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await page.getByRole("button", { name: "Lukk" }).click();
  await expect(page.getByRole("region", { name: "Planlegger" })).toHaveCount(0);
}

test("«resten av timen» is one click, and it replaces the 15", async ({
  page,
}) => {
  await installFixtures(page);
  // A Monday, inside the lesson planned below.
  await page.clock.install({ time: new Date("2026-08-31T08:34:00") });
  await planMondayLesson(page);
  // …and PAUSED exactly on the minute for the press. `install` alone leaves
  // the fake clock drifting, which used not to matter: the old pill answered
  // in whole minutes off a truncated clock, so a press at 08:35:00.9 and one
  // at 08:35:00.0 gave the same number. It counts SECONDS now (R4-funn F4),
  // and this journey asks its question in whole minutes.
  await page.clock.pauseAt(new Date("2026-08-31T08:35:00"));

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();

  // FIVE pills, not six: the row is width-bound at the timer's 260 px
  // minimum, so the conditional pill takes a preset's place rather than
  // joining them — and 15 is the one with a neighbour on both sides.
  const pill = timer.getByRole("button", {
    name: "Still tidtakeren på resten av timen (til 09:15)",
  });
  await expect(pill).toBeVisible();
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(4);
  await expect(
    timer.getByRole("button", { name: "Sett til 15 minutter" }),
  ).toHaveCount(0);

  // 09:15 − 08:35 = 40 minutes. «Vi har førti minutter igjen» used to be
  // start-then-adjust, in front of the class.
  await pill.click();
  await expect(timer.getByText("40:00")).toBeVisible();

  // And it is a real countdown from there: a minute later the board is inside
  // the 39th minute.
  //
  // Two deliberate looseneses, both of them about the FAKE clock rather than
  // the widget. `runFor`, not `fastForward`: on a PAUSED clock a jump fires
  // each due timer once at its own due time and then stops, so the 200 ms
  // re-derive would paint the frame it was scheduled for and never the one
  // the journey jumped to. And the seconds are matched loosely, because the
  // LAST re-derive inside the window lands up to one tick before its end —
  // which the display's `ceil` turns into 39:01 as readily as 39:00.
  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.runFor(60_000);
  await expect(timer.getByText(/^39:\d\d$/)).toBeVisible();
});

test("at its SMALLEST the lesson pill still shares the preset line", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T08:35:00") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await planMondayLesson(page);

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();

  // Drag the SE handle far past the minimum; `minSizePx` (260×180) stops it.
  const hb = (await timer
    .getByRole("button", { name: "Endre størrelse" })
    .boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 500, hb.y - 500, { steps: 10 });
  await page.mouse.up();
  expect(Math.round((await timer.boundingBox())!.width)).toBe(260);

  // THE constraint the pill is designed against: at 260 px the row has room
  // for about 236 px of buttons, so the pill's WIDTH is as capable of
  // breaking the line as a sixth pill's existence. «09:15» is five tabular
  // glyphs; a sentence on the face would wrap the row over the digits.
  await timer.hover();
  const tops = await timer
    .getByRole("button", { name: /^Sett til|resten av timen/ })
    .evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
  expect(tops).toHaveLength(5);
  expect(new Set(tops).size).toBe(1);
});

test("the lesson pill is absent on a Saturday and before the lesson starts", async ({
  page,
}) => {
  await installFixtures(page);
  // A SATURDAY — the day a weekday-indexed planner goes blind on.
  await page.clock.install({ time: new Date("2026-09-05T10:00:00") });
  await planMondayLesson(page);

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  const pill = timer.getByRole("button", { name: /resten av timen/ });
  await timer.hover();
  await expect(pill).toHaveCount(0);
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(5);

  // Monday morning, BEFORE the lesson: «Dagens time» shows it as the NEXT
  // lesson, and a lesson that has not started has no rest to offer.
  await page.clock.setSystemTime(new Date("2026-09-07T07:00:00"));
  await page.clock.fastForward(30_000); // the planner's date-rollover tick
  await timer.hover();
  await expect(pill).toHaveCount(0);
  await expect(timer.getByRole("button", { name: /^Sett til/ })).toHaveCount(5);

  // 08:30:30 — inside it now, and 09:15:00 − 08:30:30 is 44 minutes and
  // THIRTY SECONDS. The old pill answered 45:00 here, because it subtracted
  // whole minutes off a truncated clock (R4-funn F4) — and then rang thirty
  // seconds after the lesson it was named for had ended. `pauseAt` rather
  // than `fastForward`: the fake clock keeps drifting after a jump, and half
  // a second of drift is now visible on the board.
  await page.clock.pauseAt(new Date("2026-09-07T08:30:30"));
  await timer.hover();
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(timer.getByText("44:30")).toBeVisible();
});

test("the lesson pill counts the SECONDS, and refuses once it is stale", async ({
  page,
}) => {
  // Two bugs in one press (R4-funn F4), and both put a wrong number on the
  // board.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-31T09:00:00") });
  await planMondayLesson(page);
  // 09:00:50 — fifty seconds past the minute, inside the 08:30–09:15 lesson,
  // and FROZEN there: the seconds are the whole point of this journey, so the
  // fake clock must not drift through the press.
  await page.clock.pauseAt(new Date("2026-08-31T09:00:50"));

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.hover();
  const pill = timer.getByRole("button", { name: /resten av timen/ });
  await expect(pill).toBeVisible();

  // 09:15:00 − 09:00:50 is fourteen minutes and ten seconds. The old
  // arithmetic was `endMin - minutesOfDay(now)` — whole minutes against a
  // truncated clock — which answered 15:00 and rang the chime at 09:15:50,
  // fifty seconds after the time printed on the pill's own face.
  await pill.click();
  await expect(timer.getByText("14:10")).toBeVisible();

  // Now the lesson ends UNDER the pill. `setSystemTime` moves the wall clock
  // without firing timers, which is exactly the real gap: the pill's
  // visibility comes from the planner's 30 s tick, so for up to half a minute
  // it is still on the row after the lesson is over. Pressing it asked for a
  // negative remainder, and the clamp turned that into a five-second
  // countdown starting there and then, in front of the class.
  await page.clock.setSystemTime(new Date("2026-08-31T09:15:10"));
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(timer.getByText("14:10")).toBeVisible();
  await expect(timer.getByText("00:05")).toHaveCount(0);
});

test("the clock shows the mocked time, digital and analog", async ({
  page,
}) => {
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:37:00") });
  await page.goto("/");

  await addWidget(page, "Klokke");
  const clock = page.locator('[data-widget-kind="clock"]');
  await expect(clock.getByText("10:37")).toBeVisible();

  await clock.hover();
  await clock.getByRole("button", { name: "Analog" }).click();
  await expect(clock.getByRole("img")).toBeVisible();
  await expect(clock.getByText("10:37")).toHaveCount(0);

  await clock.getByRole("button", { name: "Dato" }).click();
  await expect(clock.getByText(/august/)).toBeVisible();
});

test("a running countdown survives «Vis stort» and the way back", async ({
  page,
}) => {
  // THE proof that focus is ONE swapped rect and not a re-mount. The running
  // state lives in the widget's own `useState` plus a local `setInterval`
  // (ADR-003: it is deliberately ephemeral), so a component that unmounted
  // and came back would show the configured 05:00 again — in the middle of a
  // test, in front of the class, with nothing anywhere going red.
  await installFixtures(page);
  await page.clock.install({ time: new Date("2026-08-27T10:00:00") });
  await page.goto("/");

  await addWidget(page, "Tidtaker");
  const timer = page.locator('[data-widget-kind="timer"]');
  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("04:00")).toBeVisible();

  await timer.hover();
  await timer.getByRole("button", { name: "Vis stort" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("03:00")).toBeVisible();

  // …and back to the board, still the same countdown running.
  await timer.getByRole("button", { name: "Avslutt stor visning" }).click();
  await page.clock.fastForward(60_000);
  await expect(timer.getByText("02:00")).toBeVisible();
  await expect(timer.getByRole("button", { name: "Pause" })).toBeVisible();
});
