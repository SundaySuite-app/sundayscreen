// The settings store: one module-level signal, hydrated once on boot.

import { signal } from "@preact/signals";

import { SETTINGS_DEFAULTS } from "@lib/settings-defaults";
import type { Settings } from "../bindings/Settings";

/** The live settings. Defaults until `hydrateSettings` has run. */
export const settings = signal<Settings>({ ...SETTINGS_DEFAULTS });

/** Has the stored value landed? */
export const hydrated = signal(false);

/**
 * Did the settings READ fail? Because the shim's `getSettings` falls back to
 * defaults on IPC failure, a broken store looks identical to a fresh install —
 * so we cross-check the failure ring for a `settings_get` entry and let the
 * shell raise a banner instead of quietly pretending everything is default.
 */
export const hydrateError = signal(false);

export async function hydrateSettings(): Promise<void> {
  const s = await window.api.getSettings();
  settings.value = s;
  hydrateError.value = window.api
    .getRecentIpcFailures()
    .some((f) => f.cmd === "settings_get");
  hydrated.value = true;
}
