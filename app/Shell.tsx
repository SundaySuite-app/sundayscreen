// The root shell: a boot splash until the settings have landed, then the
// surface and the toolbar. The hydrate-error chip is a STATE, not a toast —
// it stays until something changes.

import styles from "./Shell.module.css";
import { t } from "./i18n";
import { ManagePanel } from "./manage/ManagePanel";
import { Surface } from "./screen/Surface";
import { Toolbar } from "./screen/Toolbar";
import { classMenuOpen, managePanelOpen } from "./state/classes";
import { chromeActivity, chromeVisible } from "./state/chrome";
import { undoRemove, undoSlot } from "./state/layout";
import { hydrated, hydrateError } from "./state/settings";

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
      {hydrateError.value && (
        <p class={styles.errorChip} data-status="error">
          {t("boot.hydrateError")}
        </p>
      )}
      {undoSlot.value && (
        <div class={styles.snackbar}>
          <span>{t("undo.removed")}</span>
          <button class={styles.snackbarAction} onClick={undoRemove}>
            {t("undo.action")}
          </button>
        </div>
      )}
      <Toolbar />
      {!chromeVisible.value &&
        !managePanelOpen.value &&
        !classMenuOpen.value && (
          <button
            class={styles.chromeHandle}
            aria-label={t("chrome.show")}
            title={t("chrome.show")}
            onClick={chromeActivity}
          />
        )}
      {managePanelOpen.value && <ManagePanel />}
    </main>
  );
}
