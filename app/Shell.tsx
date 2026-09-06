// The root shell: a boot splash until the settings have landed, then the
// surface and the toolbar. The hydrate-error chip is a STATE, not a toast —
// it stays until something changes.

import styles from "./Shell.module.css";
import type { BootFault } from "./bindings/BootFault";
import { t, tf } from "./i18n";
import { AttendancePanel } from "./manage/AttendancePanel";
import { ManagePanel } from "./manage/ManagePanel";
import { PlannerPanel } from "./planner/PlannerPanel";
import { SuggestionBanner } from "./screen/SuggestionBanner";
import { Surface } from "./screen/Surface";
import { Toolbar } from "./screen/Toolbar";
import { WidgetOverlay } from "./screen/WidgetOverlay";
import { attendancePanelOpen } from "./state/attendance";
import { bootFault } from "./state/boot";
import { managePanelOpen } from "./state/classes";
import {
  anyOverlayOpen,
  chromeActivity,
  chromeVisible,
  modalPanelOpen,
} from "./state/chrome";
import { plannerPanelOpen } from "./state/planner";
import { designSession } from "./state/design-session";
import {
  focusedWidget,
  layoutHydrated,
  saveError,
  undoRemove,
  undoSlot,
} from "./state/layout";
import { hydrated, hydrateError } from "./state/settings";

/**
 * What a boot fault reads as. Five sentences, and every one of them ends in
 * the path — because the promise being made is about a FILE, and a promise
 * about a file the reader cannot point at is not checkable.
 *
 * The schema number the backend carries is deliberately absent from all five:
 * `VersionMissing(5)` is a migration version, not an app version, and
 * "install version 5 or newer" would send a teacher looking for a
 * SundayScreen that does not exist. "A newer SundayScreen" is the true
 * sentence; the number stays in the log, where the person who needs it looks.
 */
function bootFaultText(fault: BootFault): string {
  switch (fault.kind) {
    case "databaseTooNew":
      return tf("boot.fault.databaseTooNew", { path: fault.dbPath });
    case "schemaUpdateStopped":
      return tf("boot.fault.schemaUpdateStopped", { path: fault.dbPath });
    case "unreadable":
      return tf("boot.fault.unreadable", { path: fault.dbPath });
    case "startedEmpty":
      return tf("boot.fault.startedEmpty", { path: fault.dbPath });
    case "rescueFailed":
      // The only one that does NOT say "the file is untouched": by then it
      // has been renamed. It says «nothing was deleted» instead, which is
      // still true and is what the reader actually needs to know.
      return tf("boot.fault.rescueFailed", { path: fault.dbPath });
  }
}

/** The one persistent error chip — priority-ordered so the shell never
 *  stacks several (and the degraded browser boot shows exactly one). */
function chipText(): string | null {
  const fault = bootFault.value;
  // FIRST, above everything: the other three are consequences of a boot fault
  // whenever one is set (no database means no settings, no layout, no save),
  // and the shell must name the cause, not the symptom.
  //
  // …with ONE exception, and it is the whole of R4-funn F6. `startedEmpty`
  // says «the old file could not be read, so we started on a fresh one» — the
  // app WORKS after it, for the rest of the day, and the chip is the single
  // slot the shell has. Ranked with the other four it masked every failure
  // that came later: a save that stopped landing at 10:40 had no way to reach
  // the screen, because a message about the boot was still sitting in its
  // place. The four below are CAUSES of what the teacher is seeing right now;
  // `startedEmpty` is information about something that already finished.
  if (fault && fault.kind !== "startedEmpty") return bootFaultText(fault);
  if (hydrateError.value) return t("boot.hydrateError");
  if (!layoutHydrated.value && hydrated.value) return t("layout.loadFailed");
  if (saveError.value) return t("layout.saveFailed");
  if (fault) return bootFaultText(fault);
  return null;
}

export function Shell() {
  if (!hydrated.value) {
    return (
      <main class={styles.splash}>
        <div class={styles.center}>
          <h1 class={styles.wordmark}>{t("app.name")}</h1>
          <p class={styles.tagline}>{t("app.tagline")}</p>
          <p class={styles.status} data-status="loading">
            {t("boot.loading")}
          </p>
        </div>
      </main>
    );
  }

  // A design session BORROWS the store's globals (state/design-session.ts), so
  // exactly ONE `<Surface/>` may be mounted at a time — the panel mounts its
  // own inside the little board. Two would mean two ResizeObservers writing
  // `surfaceSize`, and every normalised coordinate in the app converts through
  // that one number: the last observer to fire would decide where widgets are
  // on the wall. (Remounting is harmless by construction — promise #2 derives
  // every widget's state from its config and its epoch, which is why the board
  // comes back exactly after a restart in the first place. `toNorm` already
  // guards a zero-sized surface, so the gap between unmount and measure is
  // not a divide by nothing.)
  const designing = designSession.value !== null;

  return (
    <main class={styles.shell}>
      {/*
        THE WALL — the board and the chrome that belongs to it, i.e. everything
        a modal panel is drawn over, in one wrapper so the panel can turn it
        all off with a single attribute (R7-funn 2). `data-wall` is the hook a
        journey uses to say «the board the class is looking at» as opposed to
        the little one inside the design panel.

        `inert` is what makes a panel actually modal for the KEYBOARD. Measured
        before it: with the planner open, Tab walked the toolbar's screen
        switcher, class switcher and fullscreen button — all three behind the
        scrim — and then out of the panel onto a card's «Fjern». One stop too
        far deletes a card the teacher cannot see, and a timer removed
        mid-countdown is not something Undo can bring back (the instance
        returns; the running clock does not).

        `display: contents` on the wrapper, so it adds no box: `.topStack` and
        the snackbar are `position: absolute` against `.shell`, and a wrapper
        with a box would have become their containing block. Inert is a DOM
        property, not a layout one, so it applies through it.

        NOT `#app` itself, which is the mechanism index.html's comment
        describes: these panels are mounted INSIDE the shell (only the toast
        host lives in `#overlays`), so an inert `#app` would disable the very
        dialog that asked for it.

        `<WidgetOverlay/>` and the panels are deliberately OUTSIDE the wrapper.
        The overlay host is where a card's own popover is drawn, and during a
        design session that card is on the panel's little board (ADR-016) —
        inerting the host would put the die's appearance panel behind glass in
        the one place it is opened from a panel.
      */}
      <div class={styles.wall} data-wall inert={modalPanelOpen.value}>
        {!designing && <Surface />}
        <div class={styles.topStack}>
          {/* `role="alert"` — an ASSERTIVE live region, and the one place in the
            app that earns one. This chip is not a receipt: it says the
            database did not open, or the board has stopped saving, and it
            stays until the state changes (toast.ts draws that line). Unlike a
            polite `status`, an alert is announced when the node carrying the
            role is INSERTED, which is what lets the chip stay conditionally
            rendered — a permanently mounted empty `<p>` would draw an empty
            plate on the board. */}
          {chipText() !== null && (
            <p class={styles.errorChip} role="alert" data-status="error">
              {chipText()}
            </p>
          )}
          <SuggestionBanner />
        </div>
        {/* The undo bar steps into the RIGHT CORNER while a card is shown large
          (R4-funn F1). Centred on `--chrome-clearance` it lands exactly on the
          enlarged card's own settings row — the row is centred in the card's
          bottom edge, and the card's bottom edge IS that clearance — so with
          the snackbar at `--z-toast` every control in the row belonged to the
          snackbar: «Lydvarsel» hit «Angre», and the card the teacher had just
          deleted came back. */}
        {undoSlot.value && (
          <div
            class={styles.snackbar}
            data-focused={focusedWidget.value ? true : undefined}
          >
            <span>{t("undo.removed")}</span>
            <button class={styles.snackbarAction} onClick={undoRemove}>
              {t("undo.action")}
            </button>
          </div>
        )}
        {/* The toolbar goes away with the board it belongs to, and not merely
          because the panel covers it. Three reasons, in order of how badly
          each one bites:
          — the class switcher and the screen library are `adoptSnapshot`
            doors. Reached mid-session (a Tab away, behind the scrim) they
            would swap the globals out from under the borrow, and the way home
            would be gone;
          — the add menu is the same `addMenuOpen` signal the design panel
            uses, so a mounted toolbar would open a second copy of the menu
            under the scrim;
          — two «Legg til verktøy»-buttons in one accessibility tree is an
            ambiguous target for a screen reader and for every by-name test
            selector. */}
        {!designing && <Toolbar />}
        {/* The reveal handle may never appear on top of an open panel. The
            list of what counts as "open" lives ONCE, in state/chrome.ts — this
            condition used to carry its own copy and had already drifted past
            the planner, the screen library, the add menu and attendance. */}
        {!chromeVisible.value && !anyOverlayOpen.value && (
          <button
            class={styles.chromeHandle}
            aria-label={t("chrome.show")}
            title={t("chrome.show")}
            onClick={chromeActivity}
          />
        )}
      </div>
      {/* A widget's own popover, drawn HERE and not in the card that owns it:
          every card is `overflow: hidden` with `container-type: size`, which
          also makes it a containing block for `position: fixed`, so nothing a
          widget renders can leave its own box. Mounted after the toolbar so
          it comes later in paint order too, on top of a bar it may overlap.
          Renders nothing at all until a widget opens one. */}
      <WidgetOverlay />
      {/* All three gated HERE, so each panel's hooks — and its focus
          effect — exist exactly while it is open. The planner used to gate
          itself with an early `return null`, which meant its hooks ran on the
          SHELL's mount and never again: a mount effect there could not tell
          «the panel opened» from «the app booted». */}
      {managePanelOpen.value && <ManagePanel />}
      {attendancePanelOpen.value && <AttendancePanel />}
      {plannerPanelOpen.value && <PlannerPanel />}
    </main>
  );
}
