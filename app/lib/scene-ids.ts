// The class-default scene id convention, spelled ONCE on the frontend.
//
// The backend mints these ids in `store::default_scene_id` (and the 0003
// migration's backfill). Three copies of the template string had already
// appeared (F-funn B10/C21); a drift would silently break the suggestion
// banner's "already on target" check, so the rule lives here and
// `scene-ids.test.ts` pins the shape.

/** The deterministic id of a class's default scene. */
export function defaultSceneId(classId: string): string {
  return `default-${classId}`;
}

/** Is this scene id a class default (rather than a library scene)? */
export function isDefaultSceneId(sceneId: string): boolean {
  return sceneId.startsWith("default-");
}
