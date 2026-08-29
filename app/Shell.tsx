// The root shell: a boot splash until the settings have landed, then the
// surface and the toolbar. The hydrate-error chip is a STATE, not a toast —
// it stays until something changes.

import styles from "./Shell.module.css";
import { t } from "./i18n";
import { AttendancePanel } from "./manage/AttendancePanel";
import { ManagePanel } from "./manage/ManagePanel";
import { PlannerPanel } from "./planner/PlannerPanel";
import { SuggestionBanner } from "./screen/SuggestionBanner";
import { Surface } from "./screen/Surface";
import { Toolbar } from "./screen/Toolbar";
import { attendancePanelOpen } from "./state/attendance";
import { managePanelOpen } from "./state/classes";
import { anyOverlayOpen, chromeActivity, chromeVisible } from "./state/chrome";
import {
  layoutHydrated,
  saveError,
  undoRemove,
  undoSlot,
} from "./state/layout";
import { hydrated, hydrateError } from "./state/settings";

/** The one persistent error chip — priority-ordered so the shell never
 *  stacks several (and the degraded browser boot shows exactly one). */
function chipText(): string | null {
  if (hydrateError.value) return t("boot.hydrateError");
  if (!layoutHydrated.value && hydrated.value) return t("layout.loadFailed");
  if (saveError.value) return t("layout.saveFailed");
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
      {undoSlot.value && (
        <div class={styles.snackbar}>
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
