// The bottom toolbar: add-widget buttons from the registry, the class
// switcher, fullscreen and the version. It slips away after a few idle
// seconds (state/chrome.ts + chrome-core.ts) and comes back when the
// pointer reaches for it — never while one of its own menus is open.

import { appVersion } from "../state/app-info";
import { classMenuOpen, managePanelOpen } from "../state/classes";
import {
  chromeActivity,
  chromeVisible,
  fullscreen,
  toggleFullscreen,
} from "../state/chrome";
import { addWidget } from "../state/layout";
import { t, tDyn } from "../i18n";
import { WIDGET_KINDS } from "../widgets/registry";
import { ClassSwitcher } from "./ClassSwitcher";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  const shown =
    chromeVisible.value || managePanelOpen.value || classMenuOpen.value;
  const fsLabel = fullscreen.value
    ? t("chrome.fullscreenOff")
    : t("chrome.fullscreenOn");

  return (
    <footer
      class={styles.toolbar}
      data-hidden={!shown || undefined}
      onPointerMove={chromeActivity}
      onPointerDown={chromeActivity}
    >
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
        <button
          class={styles.iconBtn}
          aria-label={fsLabel}
          title={fsLabel}
          aria-pressed={fullscreen.value}
          onClick={() => void toggleFullscreen()}
        >
          ⛶
        </button>
        <span class={styles.version}>{appVersion.value}</span>
      </span>
    </footer>
  );
}
