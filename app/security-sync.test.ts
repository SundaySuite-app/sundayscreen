// The CSP in app/index.html must be BYTE-IDENTICAL to app.security.csp in
// src-tauri/tauri.conf.json. The meta tag is what makes a plain `npm run dev`
// browser boot enforce the SAME policy the shipped webview does — and two
// policies that drift apart is how "works in Chrome, blocked in WKWebView"
// ships.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

it("index.html's CSP meta is byte-identical to tauri.conf.json's csp", () => {
  const html = readFileSync(join(root, "app", "index.html"), "utf8");
  const conf = JSON.parse(
    readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
  );

  const metaMatch = html.match(
    /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/,
  );
  expect(metaMatch, "index.html must carry a CSP meta tag").not.toBeNull();
  expect(metaMatch![1]).toBe(conf.app.security.csp);
});

it("devCsp only ADDS the dev websocket — it never weakens the shipped policy", () => {
  const conf = JSON.parse(
    readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const { csp, devCsp } = conf.app.security;
  expect(devCsp.startsWith(csp.replace(/;?\s*$/, ""))).toBe(true);
  expect(devCsp).toContain("ws://localhost:1433");
});
