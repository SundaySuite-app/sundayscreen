/**
 * The shell's entry — and the boot ORDER, which is the only thing here that
 * is not replaceable:
 *
 *   1. `@lib/api-shim` installs `window.api` as a SIDE EFFECT of the import.
 *      Everything else talks to the backend through it.
 *   2. `setShimNotifier` BEFORE the first possible failure, so an early error
 *      is surfaced with the shell's own translator.
 *   3. `render` — the shell in `#app`; `#overlays` is reserved for the dialog
 *      and toast trees (siblings of #app so an `inert` #app cannot disable
 *      its own dialog).
 *   4. `hydrateSettings` before `setLocale`, because the language IS a
 *      setting.
 */

import "./styles/base.css";

import { setShimNotifier } from "@lib/api-shim";
import { render } from "preact";

import { resolveStartupLocale, setLocale, t } from "./i18n";
import { installKeyboard } from "./screen/keyboard";
import { initWindowState } from "./screen/window-state";
import { Shell } from "./Shell";
import { loadAppInfo } from "./state/app-info";
import { loadClasses, loadMembers } from "./state/classes";
import { loadScenes } from "./state/scenes";
import { parseGoto } from "@lib/goto-core";
import {
  initPlanner,
  plannerPanelOpen,
  plannerTab,
  refreshPlanner,
  type PlannerTab,
} from "./state/planner";
import { managePanelOpen } from "./state/classes";
import { initChrome } from "./state/chrome";
import { activeClass, initLayout } from "./state/layout";
import { hydrateSettings, settings } from "./state/settings";
import { toast } from "./ui/toast";
import { Toasts } from "./ui/Toasts";

// 2. The shell's own surfaces into the shim, before anything can fail — the
// toast host is what makes the shim's failure pipeline actually REACH the
// screen (F9-funn U#2).
setShimNotifier({ t, toast });

const host = document.getElementById("app");
if (!host) {
  // A white screen with a console error is the failure mode this catches
  // loudly instead of silently.
  throw new Error('app/index.html mangler sitt <div id="app">-monteringspunkt');
}
const overlayHost = document.getElementById("overlays");
if (!overlayHost) {
  throw new Error(
    'app/index.html mangler sitt <div id="overlays">-monteringspunkt',
  );
}

// 3. TWO trees: the shell in #app, the toasts in #overlays — siblings, so
// no future inert-dialog in #app can disable its own error surface.
render(<Shell />, host);
render(<Toasts />, overlayHost);

// The chrome's global listeners — idempotent installs whose cleanups we
// never need (the shell lives as long as the window).
installKeyboard();
initChrome();

void boot();

async function boot(): Promise<void> {
  // 4. Settings before locale (the language IS a setting); locale before the
  // layout bootstrap (the default class name is translated copy).
  await hydrateSettings();
  await setLocale(resolveStartupLocale(settings.peek().language));
  // After the settings, before anything slow. It MEASURES the fullscreen
  // flag from the window rather than trusting the persisted setting: a
  // restore that lands on a monitor that is gone leaves the two disagreeing.
  void initWindowState();
  await initLayout();
  const cls = activeClass.peek();
  if (cls) void loadMembers(cls.id);
  void loadClasses();
  void loadScenes();
  void initPlanner();

  // `?goto=` deep links (dev + the browser test tier).
  const goto = parseGoto(location.search);
  if (goto?.page === "manage") managePanelOpen.value = true;
  if (goto?.page === "planner") {
    plannerPanelOpen.value = true;
    void refreshPlanner();
    const tab = goto.tab?.replace(/^planner-/, "");
    if (tab === "periods" || tab === "week" || tab === "day") {
      plannerTab.value = tab as PlannerTab;
    }
  }
  // A one-shot read the footer shows. No await — a line that can render "—"
  // until the number lands should not delay boot.
  void loadAppInfo();
}
