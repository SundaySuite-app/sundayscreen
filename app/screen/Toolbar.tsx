// The bottom toolbar: the add menu, the class switcher, fullscreen and the
// version. It slips away after a few idle seconds (state/chrome.ts +
// chrome-core.ts) and comes back when the pointer reaches for it — never
// while one of its own menus is open.

import { appVersion, updateReady, updateStaged } from "../state/app-info";
import {
  anyOverlayOpen,
  chromeActivity,
  chromeVisible,
  fullscreen,
  toggleFullscreen,
} from "../state/chrome";
import { t, tf } from "../i18n";
import { settings } from "../state/settings";
import { Icon } from "../ui/Icon";
import { openPlanner } from "../state/planner";
import { AddMenu } from "./AddMenu";
import { ClassSwitcher } from "./ClassSwitcher";
import { SceneSwitcher } from "./SceneSwitcher";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  // The list of what counts as "open" lives ONCE, in state/chrome.ts. This
  // was its third hand-rolled copy (the idle ticker and Shell's reveal handle
  // were the other two, and Shell's had already drifted past four panels).
  const shown = chromeVisible.value || anyOverlayOpen.value;
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
          {/* The silent boot check's ONE visible consequence. A tinted pill,
              not gold TEXT: gold reaches 1.80:1 on this surface (tokens.css
              — «gold is a surface, not ink»), and a marker nobody can read is
              not a marker. It never interrupts, never opens anything and
              never pulls the hidden toolbar back up: the teacher meets it the
              next time she reaches for the line herself. */}
          {/* The PILL text is the same either way, on purpose: `.meta` is a
              no-wrap flex row that already carries the brand, the planner, the
              scene, the class, fullscreen and the version, and «v0.5.0
              installeres når du lukker appen» in it is a real overflow on the
              1024 px projector ADR-011 sizes for. Only the tooltip changes,
              and the whole sentence lives in the manage panel. */}
          {updateReady.value !== null && (
            <span
              class={styles.updateMark}
              title={
                // Both facts, same as the panel: the exit hook re-reads the
                // switch, so staged bytes alone are not a promise to install.
                updateStaged.value && settings.value.autoUpdate
                  ? tf("update.pendingAuto", { v: updateReady.value })
                  : tf("update.pendingTitle", { v: updateReady.value })
              }
            >
              {tf("update.pending", { v: updateReady.value })}
            </span>
          )}
        </span>
      </footer>
    </div>
  );
}
