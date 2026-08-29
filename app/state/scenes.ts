// The scene library's state: the global scene list, the switcher menu, and
// the scene-level switch (same flush-then-swap sequencing as the class
// switch — the OLD scene's pending writes land before the pointer moves).

import { signal } from "@preact/signals";

import type { Scene } from "../bindings/Scene";
import { adoptSwitch } from "./classes";
import { activeClass, activeScene, flushPending } from "./layout";

export const scenes = signal<Scene[]>([]);
export const sceneMenuOpen = signal(false);

export async function loadScenes(): Promise<void> {
  scenes.value = await window.api.sceneList();
}

/** Show a scene in the active class. `null` = the class's default screen. */
export async function switchScene(sceneId: string | null): Promise<void> {
  sceneMenuOpen.value = false;
  const cls = activeClass.peek();
  if (!cls) return;
  await switchLesson(cls.id, sceneId);
}

/** THE lesson jump: class + scene in one flush-then-swap move — the
 *  suggestion banner's click and the auto-switch both land here. */
export async function switchLesson(
  classId: string,
  sceneId: string | null,
): Promise<void> {
  await flushPending();
  const snap = await window.api.lessonSwitch(classId, sceneId);
  adoptSwitch(snap);
}

/** «Lagre som ny skjerm»: copy what is on screen into the library and show
 *  the copy, so further edits land in the new scene. */
export async function saveCurrentAsScene(
  currentSceneId: string,
  name: string,
): Promise<void> {
  // The copy is taken from STORED rows — a debounced edit still in flight
  // would be missing from it (F-funn B7).
  await flushPending();
  const copy = await window.api.sceneDuplicate(currentSceneId, name);
  await loadScenes();
  await switchScene(copy.id);
}

export async function renameScene(id: string, name: string): Promise<void> {
  const renamed = await window.api.sceneRename(id, name);
  await loadScenes();
  // The toolbar trigger shows the ACTIVE scene's name — refresh it too
  // (F-funn F14), or it keeps the old one until the next switch.
  if (activeScene.peek()?.id === id) activeScene.value = renamed;
}

/** Delete a library scene. If it was on screen, land on the class default —
 *  the backend cleared the pointer; the frontend swaps explicitly so the
 *  surface never renders a dead scene. */
export async function deleteScene(id: string): Promise<void> {
  const wasActive = activeScene.peek()?.id === id;
  await window.api.sceneDelete(id);
  await loadScenes();
  if (wasActive) await switchScene(null);
}
