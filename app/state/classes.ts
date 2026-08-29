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

export async function loadClasses(): Promise<void> {
  classes.value = await window.api.classList();
}

export async function loadMembers(classId: string): Promise<void> {
  members.value = await window.api.membersGet(classId);
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

/** Save the textarea's parsed names for the active class. */
export async function saveMembers(names: string[]): Promise<void> {
  const cls = activeClass.peek();
  if (!cls) return;
  members.value = await window.api.membersSet(cls.id, names);
}
