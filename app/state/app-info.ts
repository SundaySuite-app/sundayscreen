// App name/version for the status line. A one-shot read the shell shows;
// no `await` at the boot site — a line that can render "—" until the number
// lands should not delay anything.
//
// The version line is also where the SILENT boot check finally surfaces. It
// has run since v0.1 and reported to a terminal no classroom has open; the
// mark beside the version number is its whole receiving end.

import { signal } from "@preact/signals";

import type { UpdateStatus } from "../bindings/UpdateStatus";

export const appVersion = signal<string>("");

/** The version the boot check found waiting, or `null` — which is the normal
 *  state, and the only honest one until an answer has actually landed. */
export const updateReady = signal<string | null>(null);

/** …and is it already downloaded and verified, waiting only for the app to
 *  close? Then there is nothing for the teacher to DO, and the manage panel
 *  says so instead of asking her to press anything. */
export const updateStaged = signal(false);

/** …and what does that version say about itself? The release note the boot
 *  check brought back, or `null` — which is what every release published
 *  before the note mechanism answers, and what the panel renders as nothing at
 *  all rather than as an empty heading. */
export const updateNotes = signal<string | null>(null);

/**
 * The release note a status is offering, or `null` when there is none.
 *
 * ONE rule, asked from two places — the mailbox read below and the manual
 * check in `ManagePanel.tsx` — because "when is there a note on screen" must
 * not be answerable two different ways.
 *
 * Only the two phases that OFFER a version carry one. `upToDate`, `disabled`
 * and `error` deliberately answer `null`: a note under «Fikk ikke sjekket nå»
 * would be describing a version that never arrived.
 *
 * The trim is the fallback in one line. `null` (the shell's own
 * normalisation), `undefined` (a status object older than the field — every
 * fixture and every cached answer written before this) and `"  "` all land in
 * the same place, so a manifest without a note leaves the panel EXACTLY as it
 * was before any of this existed.
 */
export function releaseNotesOf(status: UpdateStatus | null): string | null {
  if (status?.phase !== "available" && status?.phase !== "downloaded")
    return null;
  const text = status.notes?.trim();
  return text ? text : null;
}

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

/**
 * Read the mailbox once and mirror what it says.
 *
 * ONLY a found version becomes a mark. "Up to date" and "could not check" are
 * answers the manage panel gives on request; putting either on the toolbar
 * would be noise on a projector. That is also why nothing here CLEARS the
 * signals: an answer that has already landed is not un-said by a later read.
 *
 * `available` and `downloaded` are the same news told at two different
 * moments — a version is waiting — and they differ only in whether anything
 * is left for the teacher to do. The read never rejects (`updatePending` goes
 * through the shim's typed fallback), so there is nothing to catch.
 */
export async function readUpdatePending(): Promise<void> {
  const status = await window.api.updatePending();
  if (status?.phase === "available") {
    updateReady.value = status.version;
    updateStaged.value = false;
    updateNotes.value = releaseNotesOf(status);
  } else if (status?.phase === "downloaded") {
    updateReady.value = status.version;
    updateStaged.value = true;
    // Written inside the branch, alongside the version it belongs to: the
    // panel re-reads the mailbox when it opens, and `available` → `downloaded`
    // is the same version told twice. A note assigned outside these two arms
    // would be cleared by every «up to date» read that followed.
    updateNotes.value = releaseNotesOf(status);
  }
}

/** Open the mailbox once, later. No polling and no retry: a check that did
 *  not answer within its own timeout has answered — with silence.
 *
 *  One read at 20 s is no longer the whole story: with automatic updates on,
 *  the backend posts `available` first and `downloaded` only when the bytes
 *  have landed, so this read can legitimately catch the middle of a download.
 *  The manage panel therefore reads AGAIN when it opens (ManagePanel.tsx) —
 *  a lookup on request, not a poller. */
export function scheduleUpdateRead(): void {
  setTimeout(() => {
    void readUpdatePending();
  }, UPDATE_READ_DELAY_MS);
}
