// The root shell. In F0 this is the empty stage: the surface, a wordmark and
// an honest status line. F1 replaces the centre with the widget surface and
// the bottom toolbar.

import styles from "./Shell.module.css";
import { t } from "./i18n";
import { appVersion } from "./state/app-info";
import { hydrated, hydrateError } from "./state/settings";

function statusText(): string {
  if (hydrateError.value) return t("boot.hydrateError");
  return hydrated.value ? t("boot.ready") : t("boot.loading");
}

export function Shell() {
  const status = hydrateError.value
    ? "error"
    : hydrated.value
      ? "ready"
      : "loading";
  return (
    <main class={styles.shell}>
      <div class={styles.center}>
        <h1 class={styles.wordmark}>{t("app.name")}</h1>
        <p class={styles.tagline}>{t("app.tagline")}</p>
        <p class={styles.status} data-status={status}>
          {statusText()}
        </p>
      </div>
      <footer class={styles.footer}>
        <span class={styles.version}>{appVersion.value}</span>
      </footer>
    </main>
  );
}
