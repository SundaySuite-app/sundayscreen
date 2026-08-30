// Class-level state: the class list, the active class's members, the manage
// panel, and the SWITCH — the two-click promise. The switch flushes the OLD
// class's pending layout writes first (the sequencing seam), then swaps
// everything inside one batch so no frame can render a torn combination.

import { batch, signal } from "@preact/signals";

import type { Class } from "../bindings/Class";
import type { ClassSnapshot } from "../bindings/ClassSnapshot";
import type { Member } from "../bindings/Member";
import { activeClass, adoptSnapshot, flushPending, initLayout } from "./layout";
import { settings } from "./settings";

export const classes = signal<Class[]>([]);
export const members = signal<Member[]>([]);
export const managePanelOpen = signal(false);
export const classMenuOpen = signal(false);

/**
 * WHICH class the `members` signal holds an actual READ list for — `null`
 * while nothing has landed, and `null` again after a read fails.
 *
 * The id, not a boolean: `members_get` is a read behind a REPLACE-ALL write,
 * so "we have a list" is never enough — the question is always "a list of
 * WHOM". A `[]` that came from a failed read of 7B, adopted as fact while 7B
 * is on screen, is one click on «Lagre navneliste» away from deleting 7B.
 */
export const membersHydratedFor = signal<string | null>(null);

/** Did the last member read FAIL? Separate from the signal above, because
 *  «has not landed yet» (a blank moment during boot) and «could not be read»
 *  (a sentence the panel has to say out loud) are different states, and only
 *  one of them is an error. */
export const membersReadFailed = signal(false);

/** Does `members` hold a real read of `classId`? Reads the signal, so a
 *  component calling it during render subscribes to it. */
export function membersHydrated(classId: string | null | undefined): boolean {
  return classId != null && membersHydratedFor.value === classId;
}

export async function loadClasses(): Promise<void> {
  classes.value = await window.api.classList();
}

/**
 * Read the class's names. NEVER rejects: `main.tsx` voids this call, so an
 * unhandled rejection at boot (every plain-browser boot, where the command
 * legitimately fails) is the alternative. The failure is carried in the two
 * signals instead — which is what lets the manage panel say what happened
 * and refuse to write over a list it never got.
 */
export async function loadMembers(classId: string): Promise<void> {
  try {
    const list = await window.api.membersGet(classId);
    batch(() => {
      members.value = list;
      membersHydratedFor.value = classId;
      membersReadFailed.value = false;
    });
  } catch (e) {
    console.warn("[classes] members_get failed — the name list is UNKNOWN", e);
    batch(() => {
      // Empty, and explicitly UNREAD: the widgets show their "no names yet"
      // state (an honest "nothing to draw from"), and every writer of the
      // list is blocked until a read succeeds.
      members.value = [];
      membersHydratedFor.value = null;
      membersReadFailed.value = true;
    });
  }
}

export async function switchClass(id: string): Promise<void> {
  classMenuOpen.value = false;
  if (activeClass.peek()?.id === id) return;
  await flushPending();
  const snap = await window.api.classSwitch(id);
  adoptSwitch(snap);
}

/** Shared tail of every switch: swap everything inside one batch so no
 *  frame renders a torn combination, and keep the settings signal's
 *  pointers in step (F9-funn S#1). */
export function adoptSwitch(snap: ClassSnapshot): void {
  batch(() => {
    adoptSnapshot(snap);
    members.value = snap.members;
    // The snapshot IS a read of this class's names — the switch is the other
    // way the list arrives, and it hydrates just as much as `loadMembers`.
    membersHydratedFor.value = snap.class.id;
    membersReadFailed.value = false;
    settings.value = {
      ...settings.peek(),
      activeClassId: snap.class.id,
      activeSceneId: snap.scene.id,
    };
  });
}

export async function createClass(name: string): Promise<void> {
  const created = await window.api.classCreate(name);
  await loadClasses();
  await switchClass(created.id);
}

export async function renameClass(id: string, name: string): Promise<void> {
  const renamed = await window.api.classRename(id, name);
  await loadClasses();
  if (activeClass.peek()?.id === id) activeClass.value = renamed;
}

export async function deleteClass(id: string): Promise<void> {
  await window.api.classDelete(id);
  await loadClasses();
  if (activeClass.peek()?.id !== id) return;
  const remaining = classes.peek();
  if (remaining.length > 0) {
    // Force the swap even though the backend already repointed the settings.
    activeClass.value = null;
    await switchClass(remaining[0].id);
  } else {
    // Last class gone — bootstrap a fresh default, like first boot.
    activeClass.value = null;
    await initLayout();
    await loadClasses();
    const cls = activeClass.peek();
    if (cls) await loadMembers(cls.id);
  }
}

/**
 * Save the textarea's parsed names for the active class.
 *
 * REJECTS rather than returning quietly, in both refusals: the panel shows
 * its «Lagret»-receipt from the resolved `.then()`, so a silent return is a
 * receipt for a write that never happened (promise 4).
 *
 * The hydration guard is the load-bearing one. `members_set` is a
 * replace-all reconcile, so sending it a list parsed from a draft that was
 * never seeded from a real read deletes every pupil in the class. The panel
 * already hides the button in that state; this is the same refusal one layer
 * down, where it cannot be routed around.
 */
export async function saveMembers(names: string[]): Promise<void> {
  const cls = activeClass.peek();
  if (!cls) throw new Error("saveMembers: ingen aktiv klasse");
  if (membersHydratedFor.peek() !== cls.id) {
    throw new Error(
      `saveMembers: navnelista for «${cls.id}» er ikke lest — nekter å skrive over den`,
    );
  }
  const saved = await window.api.membersSet(cls.id, names);
  batch(() => {
    members.value = saved;
    membersHydratedFor.value = cls.id;
    membersReadFailed.value = false;
  });
}
