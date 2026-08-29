// The bottom toolbar: the add menu, the class switcher, fullscreen and the
// version. It slips away after a few idle seconds (state/chrome.ts +
// chrome-core.ts) and comes back when the pointer reaches for it — never
// while one of its own menus is open.

import { appVersion } from "../state/app-info";
import { attendancePanelOpen } from "../state/attendance";
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
import { openPlanner, plannerPanelOpen } from "../state/planner";
import { AddMenu } from "./AddMenu";
import { ClassSwitcher } from "./ClassSwitcher";
import { SceneSwitcher } from "./SceneSwitcher";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  const shown =
    chromeVisible.value ||
    plannerPanelOpen.value ||
    managePanelOpen.value ||
    attendancePanelOpen.value ||
    classMenuOpen.value ||
    sceneMenuOpen.value ||
    addMenuOpen.value;
  const fsLabel = fullscreen.value
    ? t("chrome.fullscreenOff")
    : t("chrome.fullscreenOn");

  return (
    // The dock is the centring wrapper, and it is NOT decoration: it keeps
    // the toolbar free of a `transform`, which would otherwise make it the
    // containing block for the switchers' full-screen backdrops. See
    // Toolbar.module.css.
    <div class={styles.dock}>
      <footer
        class={styles.toolbar}
        data-hidden={!shown || undefined}
        onPointerMove={chromeActivity}
        onPointerDown={chromeActivity}
      >
        <span class={styles.brand}>{t("app.name")}</span>
        <AddMenu />
        <span class={styles.meta}>
          {/* The app's biggest feature used to live behind a nameless icon.
           * No `aria-label` now that the word is on screen: it would OVERRIDE
           * the visible text for a screen reader and the two could drift
           * apart at the next translation. `title` (the tooltip) stays. */}
          <button
            class={styles.labelBtn}
            title={t("planner.title")}
            onClick={openPlanner}
          >
            <Icon name="planner" size="sm" class={styles.labelIcon} />
            {t("planner.title")}
          </button>
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
          <span>{appVersion.value}</span>
        </span>
      </footer>
    </div>
  );
}
