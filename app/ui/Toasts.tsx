// The toast host — mounted in #overlays (a SIBLING of #app, per
// index.html's contract), so no future inert-dialog can disable it.

import { t } from "../i18n";
import { dismissToast, toasts } from "./toast";
import { Icon } from "./Icon";
import styles from "./Toasts.module.css";

export function Toasts() {
  if (toasts.value.length === 0) return null;
  return (
    <div class={styles.stack}>
      {toasts.value.map((entry) => (
        <div key={entry.id} class={styles.toast} data-kind={entry.kind}>
          <span class={styles.msg}>{entry.msg}</span>
          <button
            class={styles.close}
            aria-label={t("toast.dismiss")}
            onClick={() => dismissToast(entry.id)}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
