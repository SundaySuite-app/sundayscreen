import { describe, expect, it } from "vitest";

import { defaultSceneId, isDefaultSceneId } from "./scene-ids";

// The shape MUST match `store::default_scene_id` in the Rust store and the
// 0003 migration's `'default-' || id` backfill.
describe("scene id convention", () => {
  it("mints the backend's deterministic default-scene id", () => {
    expect(defaultSceneId("c1")).toBe("default-c1");
    expect(defaultSceneId("0198-uuid")).toBe("default-0198-uuid");
  });

  it("recognises class defaults, not library scenes", () => {
    expect(isDefaultSceneId(defaultSceneId("c1"))).toBe(true);
    expect(isDefaultSceneId("e2e-7")).toBe(false);
  });
});
