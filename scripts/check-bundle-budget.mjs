#!/usr/bin/env node
// Bundle-budsjettvakt for `dist/`.
//
// Dette er IKKE en ytelsesmåling — appen kjører i Tauri og laster alt fra
// lokal disk, så et par hundre kB ekstra JS koster ingen nedlastningstid noe
// sted. Vakten er mot noe annet: en widgetmappe som ved et uhell
// eager-importerer HELE ikonsettet (eller noe like grovt — en hel
// lokale-katalog, en debug-avhengighet som sniker seg inn i prod-bundlen)
// uten at noen la merke til det, fordi ingenting målte det.
//
// RÅ bytes, ALDRI gzip: zlib-versjonen varierer mellom CI-runneren og en Mac,
// så en gzip-størrelse for identisk kildekode kan svinge mellom miljøer —
// enten en falsk regresjon ingen kan reprodusere lokalt, eller en falsk grønn
// som skjuler en ekte økning. Rå filstørrelse er den samme overalt.
//
// Budsjetter (målt 2026-08-30, god margin foreløpig: 141 718 / 47 761 /
// 251 402 B):
//   - største enkelt-JS-fil   ≤ 185 000 B
//   - største enkelt-CSS-fil  ≤  65 000 B
//   - HELE dist/, alle filer  ≤ 320 000 B
//
// FORUTSETNING: dist/ er FERSK. Dette skriptet bygger IKKE selv — det leser
// bare det som ligger der fra sist. Kjør `npm run build` rett før, i samme
// steg-kjede (se ci-local.sh og .github/workflows/ci.yml): kjør det FØR
// bygget, og du måler forrige commits bundle mens denne commiten går grønn.
//
// Bruk: node scripts/check-bundle-budget.mjs

import { readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(root, "dist");

const LARGEST_JS_MAX = 185_000;
const LARGEST_CSS_MAX = 65_000;
const DIST_TOTAL_MAX = 320_000;

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch (e) {
  console.error(`✗ could not read ${relative(root, DIST)}/: ${e.message}`);
  console.error(
    "  this script only READS dist/ — it never builds it. Run `npm run build` first.",
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(
    `✗ ${relative(root, DIST)}/ is empty. Run \`npm run build\` first.`,
  );
  process.exit(1);
}

const sized = files.map((f) => ({ file: f, bytes: statSync(f).size }));
const totalBytes = sized.reduce((sum, f) => sum + f.bytes, 0);

const largestByExt = (ext) =>
  sized
    .filter((f) => extname(f.file) === ext)
    .sort((a, b) => b.bytes - a.bytes)[0];

const largestJs = largestByExt(".js");
const largestCss = largestByExt(".css");

let failed = false;

function check(label, entry, max) {
  if (!entry) {
    console.log(`  (no ${label} file in dist/ — nothing to check there)`);
    return;
  }
  const rel = relative(root, entry.file);
  const ok = entry.bytes <= max;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label}: ${entry.bytes.toLocaleString()} B ` +
      `(max ${max.toLocaleString()} B) — ${rel}`,
  );
}

console.log("bundle budget — raw bytes, dist/:");
check("largest JS file", largestJs, LARGEST_JS_MAX);
check("largest CSS file", largestCss, LARGEST_CSS_MAX);

const totalOk = totalBytes <= DIST_TOTAL_MAX;
if (!totalOk) failed = true;
console.log(
  `  ${totalOk ? "✓" : "✗"} dist/ total: ${totalBytes.toLocaleString()} B ` +
    `(max ${DIST_TOTAL_MAX.toLocaleString()} B) across ${files.length} files`,
);

if (failed) {
  console.error(
    "\n✗ bundle budget exceeded. Not a performance regression by itself — find " +
      "what grew and decide whether it should have: `npm run build` locally, " +
      "then inspect dist/assets/ (a per-widget import that pulled in more than " +
      "it needed is the usual shape of this).",
  );
  process.exit(1);
}

console.log("\n✓ bundle within budget");
