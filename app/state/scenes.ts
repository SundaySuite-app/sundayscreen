// The scene library's state: the global scene list, the switcher menu, and
// the scene-level switch (same flush-then-swap sequencing as the class
// switch — the OLD scene's pending writes land before the pointer moves).

import { signal } from "@preact/signals";

import type { Scene } from "../bindings/Scene";
import type { SceneTheme } from "../bindings/SceneTheme";
import { adoptSwitch, classMenuOpen } from "./classes";
import { activeClass, activeScene, flushPending } from "./layout";

export const scenes = signal<Scene[]>([]);
export const sceneMenuOpen = signal(false);

/**
 * The five backdrops, in the order the picker offers them — the standard
 * board first, then the three light tints, then the one dark board.
 *
 * A list rather than `Object.keys` of something: the ORDER is a design
 * decision (five swatches a teacher scans in half a second), and a key order
 * is not. Same reasoning as `DIE_COLORS`.
 */
export const SCENE_THEMES: readonly SceneTheme[] = [
  "standard",
  "papir",
  "varm",
  "kjolig",
  "tavle",
];

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

/**
 * Switch CLASS from the toolbar, keeping the screen where that means
 * anything (R3-funn 3.2).
 *
 * ADR-009: a scene is a LAYOUT and the class is the DATA. A global library
 * screen («Morgensamling») is class-agnostic, so following the teacher to
 * 9B is what she asked for; a class DEFAULT screen belongs to the class she
 * just left, so 9B lands on its own default instead of inheriting 8A's.
 *
 * Lives here rather than in `classes.ts` because `switchLesson` is here and
 * the other direction would be an import cycle. `switchClass` keeps serving
 * `createClass`/`deleteClass` unchanged — those want the backend's own
 * pointer, not the screen on the wall.
 */
export async function switchClassKeepingScreen(classId: string): Promise<void> {
  classMenuOpen.value = false;
  if (activeClass.peek()?.id === classId) return;
  const scene = activeScene.peek();
  const keep = scene && scene.classId === null ? scene.id : null;
  await switchLesson(classId, keep);
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

/**
 * Recolour the screen that is on the board.
 *
 * The rename pattern (above), and for the same reason: the backend's answer
 * is the row as STORED, so adopting it keeps `activeScene` and the database
 * from drifting apart until the next switch. `loadScenes()` refreshes the
 * library list so a menu that is still open shows the new colour on its
 * swatch too.
 *
 * A rejection TRAVELS — the caller reports it. A colour that looks applied
 * and was never written is exactly the quiet lie promise 4 forbids.
 */
export async function setSceneTheme(theme: SceneTheme): Promise<void> {
  const scene = activeScene.peek();
  if (!scene) return;
  const updated = await window.api.sceneSetTheme(scene.id, theme);
  activeScene.value = updated;
  await loadScenes();
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
