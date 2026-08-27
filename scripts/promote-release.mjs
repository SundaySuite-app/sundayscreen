#!/usr/bin/env node
// Promote a PUBLISHED SundayScreen release to a ring, pause/resume a ring,
// or show the channel state — against the suite's update Worker.
//
//   node scripts/promote-release.mjs beta   v0.9.0-beta.1
//   node scripts/promote-release.mjs stable v1.0.0
//   node scripts/promote-release.mjs --pause beta
//   node scripts/promote-release.mjs --resume beta
//   node scripts/promote-release.mjs --status
//
// Rules enforced Worker-side and mirrored here: a `-beta.N` tag may only go
// to `beta`, a plain `vX.Y.Z` only to `stable`. Before promoting, the tag's
// published `latest.json` is fetched and must carry the platform keys our
// updater looks up — promoting a manifest the fleet cannot read is a no-op
// outage.
//
// The admin key comes from the macOS Keychain (never an env var, never an
// argument):
//   security add-generic-password -s 'SundayRec telemetry admin key' -a sundayscreen -w '<key>'
// (The service name is the SUITE's one admin key — shared across apps.)

import { execFileSync } from "node:child_process";

export const APP = "sundayscreen";
export const GITHUB_REPO = "SundaySuite-app/sundayscreen";
export const ADMIN_BASE_URL = "https://telemetry.sundaysuite.app";
export const KEYCHAIN_SERVICE = "SundayRec telemetry admin key";

/** The platform keys tauri-plugin-updater looks up on our two targets.
 *  `windows-x86_64-msi` is deliberately NOT required (betas are NSIS-only). */
export const REQUIRED_PLATFORMS = ["darwin-aarch64", "windows-x86_64"];

/** Which ring a tag belongs to — the rule, in one exported place. */
export function channelForTag(tag) {
  return tag.includes("-beta.") ? "beta" : "stable";
}

/** A tag we could have cut: `vX.Y.Z` or `vX.Y.Z-beta.N`. */
export function isReleaseTag(tag) {
  return /^v\d+\.\d+\.\d+(-beta\.\d+)?$/.test(tag);
}

/** The published manifest URL for a tag. */
export function manifestUrl(tag) {
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/latest.json`;
}

/** Platform keys missing from a manifest, if any. */
export function missingPlatforms(manifest) {
  const platforms = manifest?.platforms ?? {};
  return REQUIRED_PLATFORMS.filter((key) => !(key in platforms));
}

function adminKey() {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    console.error(
      "✗ admin key not found in the Keychain. Add it with:\n" +
        `    security add-generic-password -s '${KEYCHAIN_SERVICE}' -a ${APP} -w '<the admin key>'`,
    );
    process.exit(1);
  }
}

async function call(method, path, key, body) {
  const res = await fetch(`${ADMIN_BASE_URL}${path}`, {
    method,
    headers: {
      "x-admin-key": key,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    console.error(`✗ ${method} ${path} → ${res.status}`);
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }
  return parsed;
}

async function preflightManifest(tag) {
  const url = manifestUrl(tag);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `✗ ${url} → ${res.status}. Is the release PUBLISHED (not a draft)?`,
    );
    process.exit(1);
  }
  const manifest = await res.json();
  const missing = missingPlatforms(manifest);
  if (missing.length > 0) {
    console.error(
      `✗ latest.json lacks platform key(s) the fleet looks up: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  const expected = tag.replace(/^v/, "");
  if (manifest.version !== expected) {
    console.error(
      `✗ manifest version «${manifest.version}» is not the tag's «${expected}».`,
    );
    process.exit(1);
  }
  console.log(
    `✓ manifest ok — version ${manifest.version}, platforms complete`,
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--status") {
    const result = await call("GET", "/v1/admin/channels", adminKey());
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args[0] === "--pause" || args[0] === "--resume") {
    const channel = args[1];
    if (channel !== "stable" && channel !== "beta") {
      console.error("✗ usage: --pause|--resume <stable|beta>");
      process.exit(1);
    }
    const paused = args[0] === "--pause";
    const result = await call("POST", "/v1/admin/channel", adminKey(), {
      app: APP,
      channel,
      paused,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const [channel, tag] = args;
  if ((channel !== "stable" && channel !== "beta") || !tag) {
    console.error(
      "✗ usage: promote-release.mjs <stable|beta> <vX.Y.Z[-beta.N]> | --pause/--resume <ring> | --status",
    );
    process.exit(1);
  }
  if (!isReleaseTag(tag)) {
    console.error(`✗ «${tag}» is not a release tag (vX.Y.Z or vX.Y.Z-beta.N).`);
    process.exit(1);
  }
  if (channelForTag(tag) !== channel) {
    console.error(
      `✗ «${tag}» belongs to the ${channelForTag(tag)} ring, not ${channel}.`,
    );
    process.exit(1);
  }

  await preflightManifest(tag);
  const result = await call("POST", "/v1/admin/promote", adminKey(), {
    app: APP,
    channel,
    tag,
  });
  console.log(JSON.stringify(result, null, 2));
}

// Only run as a script — the exports above are unit-tested.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
