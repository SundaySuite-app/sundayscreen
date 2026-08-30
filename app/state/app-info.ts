// App name/version for the status line. A one-shot read the shell shows;
// no `await` at the boot site — a line that can render "—" until the number
// lands should not delay anything.
//
// The version line is also where the SILENT boot check finally surfaces. It
// has run since v0.1 and reported to a terminal no classroom has open; the
// mark beside the version number is its whole receiving end.

import { signal } from "@preact/signals";

export const appVersion = signal<string>("");

/** The version the boot check found waiting, or `null` — which is the normal
 *  state, and the only honest one until an answer has actually landed. */
export const updateReady = signal<string | null>(null);

/**
 * How long after boot the mailbox is opened. The backend's check sleeps 5 s
 * before touching the network and gives the request a 15 s timeout, so ~20 s
 * is the first moment an answer is guaranteed to have landed OR failed.
 *
 * By then the toolbar has long since slipped away (it hides after 4 s of
 * idleness). That is the design, not an oversight: an update is never worth
 * pulling the chrome back up over a lesson. The teacher meets the mark the
 * next time she reaches for the toolbar herself.
 */
export const UPDATE_READ_DELAY_MS = 20_000;

export async function loadAppInfo(): Promise<void> {
  const info = await window.api.appInfo();
  appVersion.value = info.version;
}

/** Open the mailbox once, later. No polling and no retry: a check that did
 *  not answer within its own timeout has answered — with silence. */
export function scheduleUpdateRead(): void {
  setTimeout(() => {
    void (async () => {
      const status = await window.api.updatePending();
      // ONLY `available` becomes a mark. "Up to date" and "could not check"
      // are answers the manage panel gives on request; putting either on the
      // toolbar would be noise on a projector.
      if (status?.phase === "available") updateReady.value = status.version;
    })();
  }, UPDATE_READ_DELAY_MS);
}
