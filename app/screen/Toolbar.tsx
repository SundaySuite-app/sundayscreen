// The bottom toolbar (v0): add-widget buttons from the registry, the active
// class, the version. Auto-hide and the full add-menu arrive in F7/F6 — the
// bar itself already iterates the registry, so new kinds appear here for
// free.

import { appVersion } from "../state/app-info";
import { addWidget } from "../state/layout";
import { t, tDyn } from "../i18n";
import { WIDGET_KINDS } from "../widgets/registry";
import { ClassSwitcher } from "./ClassSwitcher";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  return (
    <footer class={styles.toolbar}>
      <span class={styles.brand}>{t("app.name")}</span>
      <div class={styles.actions}>
        {WIDGET_KINDS.map((kind) => (
          <button key={kind} class={styles.add} onClick={() => addWidget(kind)}>
            <span aria-hidden="true" class={styles.plus}>
              +
            </span>
            {tDyn("widget.label", kind)}
          </button>
        ))}
      </div>
      <span class={styles.meta}>
        <ClassSwitcher />
        <span class={styles.version}>{appVersion.value}</span>
      </span>
    </footer>
  );
}
