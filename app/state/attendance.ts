// Who is here today.
//
// The model is migration 0005's: `class_member.absent_on` is a DATE STAMP,
// not a boolean. "Away" means `absentOn === today`, so yesterday's absence
// expires on its own at midnight — there is no reset job that can miss a day
// and start Tuesday with Monday's absences. Nothing is ever appended, so no
// attendance HISTORY grows here; that belongs in the school's system, and
// PRIVACY.md promises nothing about that data category.
//
// There is NO save button anywhere in this feature: every click is one write
// that REJECTS on failure (promise 4), and the panel adopts the member list
// the backend answers with — so a dimmed chip always means a stored row.

import { signal } from "@preact/signals";

import type { Member } from "../bindings/Member";
import { localDateStr } from "../planner/date-core";
import { members } from "./classes";
import { activeClass } from "./layout";

/**
 * Is the attendance panel showing?
 *
 * The shell mounts on it, and — like `managePanelOpen` — the chrome's idle
 * clock (`state/chrome.ts`) and the Escape chain (`screen/keyboard.ts`) both
 * READ it. Every overlay has to be in both of those, or the toolbar slides
 * away underneath an open panel and Escape leaves fullscreen instead of
 * closing it. This module never imports either of them back.
 */
export const attendancePanelOpen = signal(false);

/**
 * The pupils who are HERE on `today` — the frontend mirror of the backend's
 * `store::list_present_members`. It exists so the two widgets, the panel and
 * the honest "24 of 27 present" line all ask the question exactly ONCE, in
 * one place: a second spelling of this filter is precisely the seam where a
 * pupil gets drawn after being marked away.
 */
export function presentOn(all: Member[], today: string): Member[] {
  return all.filter((m) => m.absentOn !== today);
}

/** Open the panel. */
export function openAttendance(): void {
  attendancePanelOpen.value = true;
}

/**
 * Mark one pupil away (or back). The date is minted HERE, per click — a
 * machine left on overnight must not stamp this morning's absence with
 * yesterday's date (and the widgets mint theirs the same way, at draw time).
 *
 * The command answers with the WHOLE updated member list, and that answer is
 * what the store adopts: the panel then renders what was actually stored,
 * never an optimistic guess. A rejection travels to the caller.
 */
export async function setAway(memberId: string, away: boolean): Promise<void> {
  const cls = activeClass.peek();
  if (!cls) return;
  members.value = await window.api.attendanceSet(
    cls.id,
    memberId,
    away,
    localDateStr(new Date()),
  );
}
