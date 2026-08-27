// The promote script's pure rules — the ring mapping, the tag shape, and
// the manifest preflight — because a wrong promote is a fleet-wide event.

import { describe, expect, it } from "vitest";

import {
  channelForTag,
  isReleaseTag,
  manifestUrl,
  missingPlatforms,
  REQUIRED_PLATFORMS,
} from "./promote-release.mjs";

describe("channelForTag", () => {
  it("beta tags go to beta, plain tags to stable — no third answer", () => {
    expect(channelForTag("v0.9.0-beta.1")).toBe("beta");
    expect(channelForTag("v1.0.0")).toBe("stable");
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
