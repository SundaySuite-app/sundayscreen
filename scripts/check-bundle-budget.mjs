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
// Budsjetter (målt 2026-09-06, R7-bølge C «panelene lastes ved første
// åpning» + fraværspanelet bak samme grense: 173 817 / 48 229 / 357 688 B):
//   - største enkelt-JS-fil   ≤ 180 000 B
//   - største enkelt-CSS-fil  ≤  55 000 B
//   - HELE dist/, alle filer  ≤ 362 000 B
//
// ## Hva R7-bølge C flyttet, ISOLERT målt
//
// Samme arbeidstre, to bygg rett etter hverandre: ett med lazy-grensen i
// `app/Shell.tsx` (`import()` ved første åpning, ADR-019) og ett med de gamle
// statiske importene, ellers likt.
//
//   - største JS      209 098 → 174 921 B  (−34 177 B)
//   - største CSS      72 254 →  49 997 B  (−22 257 B)
//   - PlannerPanel-chunken     0 →  24 418 B JS + 12 339 B CSS
//   - ManagePanel-chunken      0 →  11 740 B JS +  9 920 B CSS
//   - dist totalt     355 339 → 357 322 B  (+1 983 B, 8 → 12 filer)
//
// Og rett etter, samme dag, fraværspanelet bak den samme grensen (åpneren
// flyttet fra panelfila til `state/attendance.ts` — se ADR-019):
//
//   - største JS      174 921 → 173 817 B  (−1 104 B)
//   - største CSS      49 997 →  48 229 B  (−1 768 B)
//   - AttendancePanel-chunken  0 →   1 468 B JS +  1 769 B CSS
//   - dist totalt     357 322 → 357 688 B  (+  366 B, 12 → 14 filer)
//
// Les de fem linjene sammen, for de sier to forskjellige ting. JS-en som
// FORLOT index er 34 177 B og kommer tilbake som 36 158 B i to chunks: 1 981 B
// dyrere, som er hva to ekstra modul-preambler og lastehjelperen koster. CSS-en
// deler seg gratis (22 257 ut, 22 259 inn). Derfor VOKSER totalen med 1 983 B
// selv om ingen oppstart lenger laster noe av det — nøyaktig slik totalen er
// ment å oppføre seg: en chunk teller fortsatt, og gevinsten er at den ikke
// LASTES. Førsteåpning betaler 1,3–2,4 ms for JS-chunken og 1,0–2,0 ms for
// CSS-en (Resource Timing, prod-bygg, 8 målinger) — hentet i parallell, altså
// ~2–3 ms, langt under terskelen der en prefetch etter boot hadde vært verdt
// kompleksiteten. Andre åpning laster ingenting (`e2e/lazy-panels.spec.ts`).
//
// C eier alle tre takene, satt fra de målte tallene + ~5 kB margin:
//
//   - JS-taket NED fra 206 000. Et tak 31 kB over målt hadde vært blindt for
//     nettopp den feilen vakta finnes for: én statisk `import` av en panelfil
//     smelter hele klynga tilbake i index-chunken, og med det gamle taket
//     hadde den regresjonen vært grønn.
//   - CSS-taket NED fra 73 000, av samme grunn og med enda tydeligere tall:
//     en gjeninnsmeltet panel-CSS gir 72,3 kB index-CSS, som lå 746 B UNDER
//     det gamle taket. Den regresjonen hadde vært usynlig.
//   - dist-totalen OPP fra 350 000. Kun 1 983 + 366 B av den hevingen er
//     lastegrensens egne (tallene over). Baselinjen i C sin måling — 355 339 B
//     UTEN grensen i det hele tatt — lå allerede 5 339 B over det gamle taket,
//     og 10 760 B over sluttmålingen ved v0.6.0-beta.1 (344 579 B). Den
//     veksten er R7-fiksrundens, bølge for bølge, målt av hver bølge på sitt
//     eget tre (isolerte bygg med og uten bølgens filer):
//       - bølge A (planlegger-, oppdaterings- og widgetfiksene, tre
//         agenter): dist 344 579 → 351 653 B, +7 074 B — det er
//         gruppeskaleringen, «Vis stort»-fikset, oppdateringsnotatet og de
//         splittede planleggerfanene (splitten selv koster preambler)
//       - bølge B1 (tastaturnudge, veggen, fokusring, live-regioner):
//         +1 940 B JS, +131 B CSS, +2 071 B totalt
//       - bølge B2 (bilde-LRU, fromBase64-grenen, tre bildeutfall,
//         flush-før-åpne): +637 B JS, +131 B CSS, +768 B totalt
//       - bølge B3 (terningens malelag til egen fil): +4 B
//       - orkestratorens småredigeringer og byggstøy: ~843 B
//     Ingen ny avhengighet i noen av dem; alt er appens egen kode. Summen
//     (~10 760 B) er hva rundt 45 granskingsfunn kostet i bytes.
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
// W4 eide hevingen av JS-taket og dist-totalen (målte tall over, + ~5 kB
// margin). CSS-taket sto urørt: 69 463 B var innenfor 73 000 uten heving, og
// et tak som holder skal ikke flyttes «for sikkerhets skyld». (Alle tre er
// siden satt på nytt av R7-bølge C — se avsnittet over.)
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

// Målt 2026-09-06 etter R7-bølge C (panelene lastes ved første åpning):
// største JS 174 921 B · største CSS 49 997 B · dist totalt 357 322 B — se
// §«Hva R7-bølge C flyttet» i docstringen over for den isolerte målingen og
// for hvorfor de to første går NED mens totalen går opp. Alle tre er satt til
// det MÅLTE tallet pluss ~5 kB margin, og C er eieren.
const LARGEST_JS_MAX = 180_000;
const LARGEST_CSS_MAX = 55_000;
const DIST_TOTAL_MAX = 362_000;

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
