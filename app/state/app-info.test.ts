import { describe, expect, it } from "vitest";

import type { UpdateStatus } from "../bindings/UpdateStatus";
import { releaseNotesOf } from "./app-info";

// The release note travels `docs/release-notes/<tagg>.md` → `latest.json`'s
// `notes` → the plugin's `Update::body` → `release_notes` in
// `src-tauri/src/update/mod.rs` → the mailbox → here. The last leg used to be a
// bin: the phase enum had nowhere to put the text, so every version — one that
// MOVED a key the teacher has in her fingers, and one that fixed a typo — was
// announced with the same sentence and a button.
//
// This is the rule that decides when the note is on screen. It is asked from
// two places (the mailbox read and the manual check in `ManagePanel.tsx`), and
// that is exactly why it is one function and not two conditions.
describe("releaseNotesOf", () => {
  it("shows the note on an offered version", () => {
    const status: UpdateStatus = {
      phase: "available",
      version: "9.9.9",
      notes: "Terningen viser 0-9.\n\nTimeplanen tåler dobbelttimer.",
    };
    // The author's blank line is theirs to keep — the box renders `pre-wrap`,
    // and a helper that normalised the whitespace would be silently editing
    // something a person wrote for a teacher to read.
    expect(releaseNotesOf(status)).toBe(
      "Terningen viser 0-9.\n\nTimeplanen tåler dobbelttimer.",
    );
  });

  it("shows it on the downloaded phase too — the automatic path's only word", () => {
    // With automatic updates on, this is the ONLY sentence she ever meets
    // about the version her app becomes when she closes it. A note dropped
    // here would leave the whole automatic path mute about what it will do.
    expect(
      releaseNotesOf({
        phase: "downloaded",
        version: "9.9.9",
        notes: "Terningen viser 0-9.",
      }),
    ).toBe("Terningen viser 0-9.");
  });

  // ── The fallback: every release published before the note mechanism ────────
  it("says nothing for a version without a note, in all of its shapes", () => {
    // `null` is the shell's own normalisation; `undefined` is a status object
    // older than the field at all; whitespace is a manifest whose `notes` was
    // written empty. One answer out of all three, so the panel renders exactly
    // what it rendered yesterday — no heading, and no empty box under it.
    expect(
      releaseNotesOf({ phase: "available", version: "9.9.9", notes: null }),
    ).toBeNull();
    expect(
      releaseNotesOf({
        phase: "available",
        version: "9.9.9",
      } as UpdateStatus),
    ).toBeNull();
    expect(
      releaseNotesOf({
        phase: "available",
        version: "9.9.9",
        notes: "  \n\t ",
      }),
    ).toBeNull();
    expect(
      releaseNotesOf({ phase: "downloaded", version: "9.9.9", notes: null }),
    ).toBeNull();
  });

  it("stands aside for every phase that is not offering a version", () => {
    // A note under «Fikk ikke sjekket nå» would describe a version that never
    // arrived, and one under «Du har nyeste versjon» a version she already has.
    const quiet: (UpdateStatus | null)[] = [
      null,
      { phase: "upToDate" },
      { phase: "disabled" },
      { phase: "error", message: "offline" },
    ];
    for (const status of quiet) {
      expect(releaseNotesOf(status)).toBeNull();
    }
  });
});
