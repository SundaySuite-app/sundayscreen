// The bottom toolbar: the add menu, the class switcher, fullscreen and the
// version. It slips away after a few idle seconds (state/chrome.ts +
// chrome-core.ts) and comes back when the pointer reaches for it — never
// while one of its own menus is open.

import { appVersion } from "../state/app-info";
import { classMenuOpen, managePanelOpen } from "../state/classes";
import {
  addMenuOpen,
  chromeActivity,
  chromeVisible,
  fullscreen,
  toggleFullscreen,
} from "../state/chrome";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { sceneMenuOpen } from "../state/scenes";
import { AddMenu } from "./AddMenu";
import { ClassSwitcher } from "./ClassSwitcher";
import { SceneSwitcher } from "./SceneSwitcher";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  const shown =
    chromeVisible.value ||
    managePanelOpen.value ||
    classMenuOpen.value ||
    sceneMenuOpen.value ||
    addMenuOpen.value;
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
      <AddMenu />
      <span class={styles.meta}>
        <SceneSwitcher />
        <ClassSwitcher />
        <button
          class={styles.iconBtn}
          aria-label={fsLabel}
          title={fsLabel}
          aria-pressed={fullscreen.value}
          onClick={() => void toggleFullscreen()}
        >
          <Icon
            name={fullscreen.value ? "fullscreen-exit" : "fullscreen"}
            size="md"
          />
        </button>
        <span class={styles.version}>{appVersion.value}</span>
      </span>
    </footer>
  );
}
