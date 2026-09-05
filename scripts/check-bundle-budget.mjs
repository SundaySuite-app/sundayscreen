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
// Budsjetter (målt 2026-09-02, R6-bølge W4 «bilde-widgeten»: 200 833 /
// 69 463 / 343 096 B):
//   - største enkelt-JS-fil   ≤ 206 000 B
//   - største enkelt-CSS-fil  ≤  73 000 B
//   - HELE dist/, alle filer  ≤ 350 000 B
//
// ## Hva W4 la til, ISOLERT målt
//
// Samme arbeidstre, to bygg: ett med bilde-widgeten koblet fra (registry-linje
// + ikon + i18n-nøkler ute) og ett med alt inne, ellers likt.
//
//   - største JS   196 858 → 200 833 B  (+3 975 B)
//   - største CSS   68 158 →  69 463 B  (+1 305 B)
//   - en-chunken    11 518 →  12 380 B  (+  862 B)
//   - dist totalt  336 954 → 343 096 B  (+6 142 B = 3 975 + 1 305 + 862)
//
// De +3 975 B er komponenten, blob-cachen og bilde-ikonet; ingen ny
// avhengighet (base64-dekodingen er `atob`, som allerede finnes i plattformen).
// CSS-veksten er én ny widgetmappes modul. `en.json` vokser fordi katalogen
// fikk elleve nye nøkler i begge språk — den lastes fortsatt som egen chunk,
// så norsk drift betaler ingenting for den.
//
// W4 eier hevingen av JS-taket og dist-totalen (målte tall over, + ~5 kB
// margin). CSS-taket står urørt: 69 463 B er innenfor 73 000 uten heving, og
// et tak som holder skal ikke flyttes «for sikkerhets skyld».
//
// Forrige måling: 2026-09-02, W2 «lenke-widgeten» — 187 237 / 62 133 /
// 315 889 B under taket 192 000 / 65 000 / 320 000. Og før den: 2026-08-31,
// etter 3D-terningen — 178 700 / 58 138 / 302 359 B.
//
// ## Hva W3 la til, isolert målt
//
// QR-koden kom som forutsett i en EGEN chunk, `dist/assets/qr-core-*.js`,
// 5 382 B. Isolert måling (samme arbeidstre, ett bygg med slot + CSS ute og
// ett med dem inne, alt annet likt):
//
//   - største JS   195 749 → 196 460 B  (+711 B)
//   - største CSS   67 895 →  68 158 B  (+263 B)
//   - dist totalt  330 200 → 336 556 B  (+6 356 B = 711 + 263 + 5 382)
//
// De +711 B er `LazyQr.tsx` — KOMPONENTEN, ikke koderen. Selve encoderen
// ligger med 0 B i index-chunken; verifisert ved å lete etter signaturene
// (0x11D, formatordet 0x5412, kodeordstabellen `26,44,70,100,134`,
// path-fragmentet `h1v1h-1z`) i index-*.js: null treff der, treff i
// qr-core-*.js. Lazy-lastingen lekker altså ikke — den ene tingen som MÅTTE
// bli i index er komponenten som tegner koden, og den er 0,7 kB.
//
// ## ⚠️ JS- og CSS-takene er sprengt av RUNDEN, ikke av W3
//
// Baselinjen OVER (195 749 / 67 895 B, uten W3 i det hele tatt) ligger
// allerede over 192 000 / 65 000. Den veksten kom fra de parallelle
// R6-bølgene i samme arbeidstre, og W3 hverken kjenner eller kan forklare
// den. Å heve et tak krever en ærlig begrunnelse i denne docstringen, så de
// to takene står urørt her: bølgen som eier veksten må måle sitt eget tall
// og skrive sin egen linje. Bare `DIST_TOTAL_MAX` er hevet, fordi det taket
// var W3s oppgave å måle på nytt.
//
// Regelen står: et tak heves med et MÅLT tall og en dato i denne
// docstringen, aldri ved å flytte kode mellom chunks for å komme under (det
// er å spille gaten, ikke å bestå den). En egen chunk er lov når den er en
// ekte lastegrense — `en.json` er presedensen (app/lib/i18n.ts) — men da
// teller den fortsatt i totalen, og det er nettopp derfor totalen finnes.
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

// Målt 2026-09-02 etter R6-bølge W4 (bilde-widgeten): største JS 200 833 B,
// dist totalt 343 096 B — se §«Hva W4 la til» i docstringen over for den
// isolerte målingen. Begge heves med det MÅLTE tallet pluss ~5 kB margin, og
// W4 er eieren. CSS-taket står urørt fra forrige bølge: 69 463 B er innenfor.
const LARGEST_JS_MAX = 206_000;
const LARGEST_CSS_MAX = 73_000;
const DIST_TOTAL_MAX = 350_000;

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
