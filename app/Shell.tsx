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
import { attendancePanelOpen } from "./state/attendance";
import { bootFault } from "./state/boot";
import { managePanelOpen } from "./state/classes";
import { anyOverlayOpen, chromeActivity, chromeVisible } from "./state/chrome";
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

  return (
    <main class={styles.shell}>
      <Surface />
      <div class={styles.topStack}>
        {chipText() !== null && (
          <p class={styles.errorChip} data-status="error">
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
      <Toolbar />
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
      {managePanelOpen.value && <ManagePanel />}
      {/* Gated here so the panel's hooks only exist while it is open. */}
      {attendancePanelOpen.value && <AttendancePanel />}
      <PlannerPanel />
    </main>
  );
}
