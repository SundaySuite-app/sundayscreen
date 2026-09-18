// The promote script's pure rules — the ring mapping, the tag shape, the
// asymmetric channel/tag rule, and the manifest preflight — because a wrong
// promote is a fleet-wide event.

import { describe, expect, it } from "vitest";

import {
  channelForTag,
  isReleaseTag,
  manifestUrl,
  missingPlatforms,
  REQUIRED_PLATFORMS,
  tagChannelProblem,
} from "./promote-release.mjs";

describe("channelForTag", () => {
  it("maps a tag's shape to its default ring — beta for -beta.N, stable for plain", () => {
    expect(channelForTag("v0.9.0-beta.1")).toBe("beta");
    expect(channelForTag("v1.0.0")).toBe("stable");
  });
});

// The asymmetric ring rule (THE RULE at the top of promote-release.mjs,
// 2026-09, sunday-telemetry#11): a `-beta.N` tag still clears only "beta",
// but a plain `vX.Y.Z` tag now clears BOTH channels — an official release
// reaches the beta ring too, so a beta tester never ends up running
// something older than the fleet. Table-driven so the four corners (and the
// invalid-tag case) read as one shape instead of separate assertions that
// could silently drift apart from each other.
describe("tagChannelProblem", () => {
  it.each([
    ["beta", "v0.7.1", null],
    ["stable", "v0.7.1", null],
    ["beta", "v0.8.0-beta.1", null],
    [
      "stable",
      "v0.8.0-beta.1",
      "«v0.8.0-beta.1» is a beta tag — it can only be promoted to the beta ring, not stable.",
    ],
    [
      "beta",
      "not-a-tag",
      "«not-a-tag» is not a release tag (vX.Y.Z or vX.Y.Z-beta.N).",
    ],
  ])("channel=%s tag=%s → %s", (channel, tag, expected) => {
    expect(tagChannelProblem(channel, tag)).toBe(expected);
  });

  it("lets a plain tag clear the beta channel (the new half of the rule)", () => {
    // Before 2026-09 this was the one rejected corner — a plain tag could
    // only ever be promoted to "stable". An official release is now fair
    // game for the beta ring too, so beta testers are never left running
    // something older than the fleet.
    expect(tagChannelProblem("beta", "v0.7.1")).toBeNull();
  });

  it("still refuses a beta tag on stable — that half of the rule is unchanged", () => {
    expect(tagChannelProblem("stable", "v0.8.0-beta.1")).toContain(
      "can only be promoted to the beta ring",
    );
  });
});

describe("isReleaseTag", () => {
  it("accepts exactly the two shapes we cut", () => {
    expect(isReleaseTag("v1.0.0")).toBe(true);
    expect(isReleaseTag("v0.9.0-beta.12")).toBe(true);
    expect(isReleaseTag("v1.0")).toBe(false);
    expect(isReleaseTag("1.0.0")).toBe(false);
    expect(isReleaseTag("v1.0.0-rc.1")).toBe(false);
    expect(isReleaseTag("main")).toBe(false);
  });
});

describe("manifestUrl", () => {
  it("points at the tag's published latest.json in OUR repo", () => {
    expect(manifestUrl("v1.0.0")).toBe(
      "https://github.com/SundaySuite-app/sundayscreen/releases/download/v1.0.0/latest.json",
    );
  });
});

describe("missingPlatforms", () => {
  it("requires every platform the fleet looks up — and only those", () => {
    const complete = {
      platforms: Object.fromEntries(
        REQUIRED_PLATFORMS.map((k) => [k, { url: "…", signature: "…" }]),
      ),
    };
    expect(missingPlatforms(complete)).toEqual([]);
    expect(missingPlatforms({ platforms: { "darwin-aarch64": {} } })).toEqual([
      "windows-x86_64",
    ]);
    expect(missingPlatforms({})).toEqual(REQUIRED_PLATFORMS);
    // The msi key is deliberately not required (betas are NSIS-only).
    expect(REQUIRED_PLATFORMS).not.toContain("windows-x86_64-msi");
  });
});
