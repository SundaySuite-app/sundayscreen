// What the planner's three tabs share.
//
// Split out of `PlannerPanel.tsx` when that file passed 1 400 lines (R7
// kodehelse #2): the tabs are independent forms, and the R6-F10 class of bug —
// the week grid and the day tab disagreeing about double-lesson semantics —
// lives in the SEAM between them, which is only readable when the seam has a
// name. Nothing here is new; every function moved verbatim.

import type { Scene } from "../bindings/Scene";
import { t } from "../i18n";
import { classes } from "../state/classes";
import { scenes } from "../state/scenes";
import { localeTag } from "@lib/i18n";
import { defaultSceneId } from "@lib/scene-ids";
import { dateAtNoon } from "./date-core";

/** What the «Timelengde» row offers. A DESIGN list, not a protocol: the
 *  store accepts anything in LIMITS.LESSON_MINUTES_MIN..MAX, and a stored
 *  value outside this list (a future version's 90) simply renders with no
 *  pill ticked — the row is an offer, never a validator. */
export const LESSON_MINUTE_OPTIONS: readonly number[] = [30, 45, 60];

export const LESSON_WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** The picture next to a lesson: small enough to sit in a header row without
 *  pushing the buttons onto a second line. */
export const HEAD_THUMB_SIZE = { w: 64, h: 40 };

/**
 * The STABLE code of a rejected `invoke`, or `null`.
 *
 * Tauri serialises `AppError` as `{ code, message }` — not as an `Error`
 * instance — and `code` is the half meant for switch statements
 * (`src-tauri/src/error.rs`: "validation", "not_found", "database", …). The
 * same reading `api-shim`'s `ipcErrText` does, asking for the other field.
 *
 * The `Error` branch is the FIXTURE tier: the e2e mini backend rejects with
 * `new Error("validation")`, mirroring the code it is standing in for. A real
 * `Error` with prose in it simply fails to match any code, which is the safe
 * direction — an unrecognised failure must not borrow a specific diagnosis.
 */
export function ipcErrCode(e: unknown): string | null {
  if (e && typeof e === "object" && !(e instanceof Error)) {
    const code = (e as Record<string, unknown>).code;
    if (typeof code === "string" && code) return code;
  }
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return null;
}

/** «mandag 31. august» — the key stays in a data attribute for tests
 *  (F-funn C4: the raw ISO key was shown to teachers). */
export function humanDate(date: string): string {
  return new Intl.DateTimeFormat(localeTag(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateAtNoon(date));
}

/** What screen a lesson points at, by NAME. `null` — and an id the library no
 *  longer holds, which the `ON DELETE SET NULL` in 0003 makes a transient
 *  state rather than a stored one — is the class's default screen, which is
 *  also what the resolver falls back to. */
export function sceneLabel(sceneId: string | null): string {
  if (sceneId == null) return t("scene.default");
  return scenes.value.find((s) => s.id === sceneId)?.name ?? t("scene.default");
}

/**
 * A class's DEFAULT screen, GUESSED from what the frontend already knows.
 *
 * Class defaults live outside `scene_list` (commands/scenes.rs), so `scenes`
 * does not hold this row and the fields have to come from somewhere. Only `id`
 * is load-bearing — it is the key every `layout_save` in the session carries,
 * and it is deterministic — while `name` reaches the panel header and matches
 * what the store actually holds (a default scene is created with the class's
 * own name, store.rs `insert_class`).
 *
 * `theme` is the one field this cannot know, and it is a LIE: the guess says
 * «standard», so the little board drew a white backdrop for a class that sees
 * near-black on the wall — a WYSIWYG lie in the editor that exists to prevent
 * WYSIWYG lies (R6-F4). Since `scene_get` that lie is the FALLBACK and not the
 * rule: `designTarget` below reads the real row, and only a rejected read
 * falls back here. A failed read must not cost the teacher her session — but
 * it is the exception now, not what happens every time.
 *
 * Never persisted either way (the session writes widgets, never the scene
 * row), and designing the screen already on the projector takes the same-scene
 * path in `enterDesign`, where the REAL object is used instead of this one.
 */
function defaultSceneFor(classId: string): Scene | null {
  const cls = classes.peek().find((c) => c.id === classId);
  if (!cls) return null;
  return {
    id: defaultSceneId(classId),
    classId,
    name: cls.name,
    sortIndex: 0,
    createdAt: 0,
    theme: "standard",
  };
}

/**
 * The `Scene` to open a design session on: the screen the lesson points at, or
 * the class's default screen — READ, not assembled.
 *
 * `scene` is already a real row when the lesson names a library screen
 * (`scenes` holds those). The default screen is the case that needed a door,
 * and `scene_get` is it. The fallback on rejection is deliberate and narrow:
 * the id is deterministic and the widgets are loaded by `enterDesign` anyway,
 * so a failed read costs the teacher a backdrop colour, not the session — and
 * blocking «Design skjermen» on a read that only decorates would be a worse
 * trade in the five minutes before a lesson.
 */
export async function designTarget(
  scene: Scene | null,
  classId: string | null,
): Promise<Scene | null> {
  if (scene) return scene;
  if (!classId) return null;
  const guess = defaultSceneFor(classId);
  if (!guess) return null;
  try {
    return await window.api.sceneGet(guess.id);
  } catch (e) {
    console.warn("[planner] scene_get failed — designing on a guessed row", e);
    return guess;
  }
}
