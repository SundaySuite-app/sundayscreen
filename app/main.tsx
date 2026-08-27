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
import { Shell } from "./Shell";
import { loadAppInfo } from "./state/app-info";
import { hydrateSettings, settings } from "./state/settings";

// 2. The shell's own translator into the shim, before anything can fail.
setShimNotifier({ t });

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

// 3.
render(<Shell />, host);

void boot();

async function boot(): Promise<void> {
  // 4.
  await hydrateSettings();
  await setLocale(resolveStartupLocale(settings.peek().language));
  // A one-shot read the footer shows. No await — a line that can render "—"
  // until the number lands should not delay boot.
  void loadAppInfo();
}
