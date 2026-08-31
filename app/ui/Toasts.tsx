// The toast host — mounted in #overlays (a SIBLING of #app, per
// index.html's contract), so no future inert-dialog can disable it.

import { t } from "../i18n";
import { focusedWidget } from "../state/layout";
import { dismissToast, toasts } from "./toast";
import { Icon } from "./Icon";
import styles from "./Toasts.module.css";

export function Toasts() {
  if (toasts.value.length === 0) return null;
  return (
    // The stack steps DOWN while a card is shown large (R4-funn F7): the
    // enlarged card's collapse button lives in its top-right corner, and the
    // toast stack is anchored to the same corner of the window — measured,
    // `elementFromPoint` on the button returned the toast. This is the one
    // control the mode has, so the receipt gives way to it, not the other way
    // round.
    <div
      class={styles.stack}
      data-focused={focusedWidget.value ? true : undefined}
    >
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
