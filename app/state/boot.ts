// What the boot had to say for itself. One signal, read ONCE at startup.
//
// The backend's `setup` no longer refuses to start when the database will not
// open: it succeeds, leaves the reason in managed state, and lets the shell be
// the surface that says it out loud. Everything else in the app then runs in
// the same degraded mode a plain browser runs in — reads fall back to their
// typed defaults, writes reject honestly — which is a lesson that can still be
// held, unlike an app that does not open.

import { signal } from "@preact/signals";

import type { BootFault } from "../bindings/BootFault";

/** The boot's verdict. `null` means "nothing to say", which is the normal
 *  answer and also what a plain browser answers. */
export const bootFault = signal<BootFault | null>(null);

/**
 * Ask once. Never throws: the shim's typed fallback is `null`, so a failure to
 * READ the fault degrades into silence rather than into a fabricated one.
 */
export async function loadBootFault(): Promise<void> {
  bootFault.value = await window.api.bootFault();
}
