// The toast host — mounted in #overlays (a SIBLING of #app, per
// index.html's contract), so an inert shell can never disable it.
//
// ## The stack is ALWAYS mounted, and that is the whole a11y fix
//
// `role="status"` is a POLITE live region, and a polite region is only
// announced when the element carrying it was already in the accessibility
// tree before the text arrived: assistive technology subscribes to changes
// INSIDE a live region, and a region that appears together with its first
// message is a whole new subtree, not a change. So the host used to return
// `null` on an empty stack, which would have made every first toast — the
// shim's save failures, «Fikk ikke åpnet lenken», «Noe gikk galt» — silent
// for a screen-reader user however the role were spelled.
//
// The empty stack is a 0×0 box in a corner, and `pointer-events` are handed
// to the toasts themselves (Toasts.module.css), so a permanently mounted host
// takes nothing away from the board.

import { t } from "../i18n";
import { focusedWidget } from "../state/layout";
import { dismissToast, toasts } from "./toast";
import { Icon } from "./Icon";
import styles from "./Toasts.module.css";

export function Toasts() {
  return (
    // The stack steps DOWN while a card is shown large (R4-funn F7): the
    // enlarged card's collapse button lives in its top-right corner, and the
    // toast stack is anchored to the same corner of the window — measured,
    // `elementFromPoint` on the button returned the toast. This is the one
    // control the mode has, so the receipt gives way to it, not the other way
    // round.
    <div
      class={styles.stack}
      // Polite, never assertive: a toast is a RECEIPT for something that just
      // happened (toast.ts), and the sticky STATES a teacher must not miss are
      // the shell's chip, which is the `alert`.
      role="status"
      data-toast-stack
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
