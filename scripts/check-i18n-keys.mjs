#!/usr/bin/env node
/**
 * i18n-nøkkelgate for `app/` — hver nøkkel finnes, i riktig FORM, i både
 * no.json og en.json.
 *
 * ## Hvorfor dette ikke kan stilles med regex
 *
 * `app/` er TSX skrevet mot fem oversetterfunksjoner: `t`, `tf`, `tn`, `tArr`,
 * `tDyn` (se `scripts/lib/tsx-i18n-scan.mjs`). Et kall kan stå hvor som helst
 * i treet, og de fire formene (streng / interpolert / flertallsgruppe / array)
 * feiler på fire ulike STILLE måter når kallet og katalog-oppføringen ikke er
 * enige om formen:
 *
 *   t()    på en flertallsgruppe → objektet er ingen streng → tom tekst
 *   tn()   på en flat streng     → alle språk får entallsformen for alt
 *   tArr() på en streng          → reservelista (tom) rendres som ingenting
 *   tDyn() på et tomt subtre     → hver eneste dynamiske nøkkel bommer
 *
 * Ingen av dem kaster. Alle fire ser ut som «teksten mangler bare litt». Denne
 * gaten spør derfor TypeScripts egen AST (ikke tekstlig regex) om formen kallet
 * forutsetter, og slår den opp mot begge katalogene.
 *
 * ## Hvorfor BÅDE no.json og en.json
 *
 * Bokmål er kildespråket appen faktisk tilbyr (`ACTIVE_LOCALES` i
 * `app/i18n/index.ts` er `["no"]` i dag); engelsk er SCAFFOLDET, ikke
 * tilbudt — katalogen finnes og holdes i paritet nettopp så aktivering
 * senere blir denne ene linjen. `REQUIRED_LOCALES` under er derfor `["no",
 * "en"]`, ikke bare `["no"]`: et krav som bare så no.json ville latt en.json
 * råtne usett fram til dagen noen slår på engelsk, og da er det en bruker som
 * oppdager tomrommet, ikke CI.
 *
 * ## `--unused`
 *
 * Lister nøkler i no.json ingen leser — en nøkkel ingen leser er likevel en
 * setning som må oversettes, holdes i paritet med en.json og leses på nytt
 * hver gang katalogen ryddes.
 *
 * ⚠️ «Ingen leser» er IKKE det samme som «ingen `t()` i `app/`». De rene
 * modulene under `app/lib/**` (CLAUDE.mds "Pure core-stil": DOM-fri logikk i
 * `*-core.ts`) svarer ofte med en NØKKEL og lar komponenten oversette den —
 * siden kaller så `t(k)` med en variabel, som AST-vandringen ser som
 * «dynamisk» og ikke kan slå opp. En prune som bare talte `app/` ville derfor
 * slettet nøkler som FAKTISK rendres, og feilen ville vært tom tekst på en
 * flate ingen test åpner.
 *
 * Derfor to kilder til «brukt»:
 *   1. AST-vandringen over `app/**` (nøyaktig, ser formen kallet forutsetter),
 *   2. et STRENGLITERAL-søk over `app/lib/**` sine kildefiler — samme metode
 *      som `scripts/check-command-reachability.mjs` bruker og begrunner, og
 *      av samme grunn: det er bredere enn nødvendig, og det er den riktige
 *      retningen å ta feil i for en gate som SLETTER.
 *
 * `*.test.ts` teller IKKE som leser. En test som pinner katalogen er ikke en
 * flate en frivillig ser, og «behold strengen, en test nevner den» er hvordan
 * en katalog aldri blir mindre.
 *
 * Bruk:
 *   node scripts/check-i18n-keys.mjs            # gate (baseline 0)
 *   node scripts/check-i18n-keys.mjs --list     # vis alle kall gaten fant
 *   node scripts/check-i18n-keys.mjs --unused   # gate: 0 ubrukte nøkler
 *
 * Mutasjonsvern: skriptet kjører først seg selv mot en innebygd TSX-fixtur med
 * fasit — én kjent feil per feilklasse. Sløyfer noen ut en klasse, feiler
 * selvtesten (exit 2) før gaten får uttale seg. En gate som kan mutere til
 * «alltid grønn» er ingen gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectI18nCalls,
  parseSource,
  sourceFiles,
} from "./lib/tsx-i18n-scan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LOCALE_DIR = path.join(ROOT, "app", "i18n", "locales");
const APP_DIR = path.join(ROOT, "app");
/**
 * Den delte kjernen `app/` når gjennom `@lib/*`. Se `--unused` over.
 *
 * `LIB_DIR` er eksplisitt holdt utenfor AST-vandringen
 * (`sourceFiles(APP_DIR, [LIB_DIR])`), og det er ikke en glipe: katalog-
 * lasteren `app/lib/i18n.ts` beholder med vilje den eldre `t(key,
 * fallback = "")`-signaturen (api-shimmens varsler leser tekst gjennom den
 * FØR skallets katalog-baserte `app/i18n/index.ts` er installert — se den
 * filas hode), og fallback-argumentet er nettopp det denne gaten forbyr for
 * `app/`s egen `t()`. En vandring som også dekket `app/lib/` ville derfor
 * felle et bevisst designvalg som en gate-feil. Modulene der teller likevel
 * med — som strengliteral-kilde under `--unused` (se over).
 */
const LIB_DIR = path.join(APP_DIR, "lib");

/**
 * Katalogene denne gaten holder i paritet — IKKE det samme som
 * `ACTIVE_LOCALES` i `app/i18n/index.ts` (`["no"]` i dag; engelsk er
 * scaffoldet, ikke tilbudt — se filhodet over). Gaten dekker begge likevel:
 * en.json skal aldri kunne råtne mens ingen bruker ser det, for da er
 * aktivering («legg «en» til i ACTIVE_LOCALES») dagen katalogen brister i
 * stedet for den ene linjen den er ment å være.
 */
const REQUIRED_LOCALES = ["no", "en"];

const CLDR = new Set(["zero", "one", "two", "few", "many", "other"]);

/** En flertallsgruppe: bare CLDR-kategorier som nøkler, og `other` er
 *  påkrevd (det er `tn`s universelle reserve). Samme definisjon som
 *  `app/i18n/locales/parity.test.ts` og `check-i18n-plurals.mjs`. */
export function isPluralGroup(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return (
    keys.length > 0 &&
    keys.every((k) => CLDR.has(k)) &&
    typeof v.other === "string"
  );
}

/**
 * Nøkler en DELT KJERNE navngir som en strengliteral.
 *
 * De rene modulene svarer med en nøkkel og lar siden oversette; AST-vandringen
 * over `app/` ser da bare `t(«dynamisk»)`. Metoden er den samme som
 * `check-command-reachability.mjs`: strip kommentarer, og spør så om nøkkelen
 * står som en literal noe sted i kilden. Bredere enn et kallsted — og det er
 * den riktige retningen for en gate hvis handling er å SLETTE.
 *
 * `*.test.ts` er utelatt med vilje: en test er ingen flate.
 */
function keysNamedInSharedCore(allKeys) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name))
        files.push(p);
    }
  };
  walk(LIB_DIR);
  const source = files
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const literals = new Set(
    [...source.matchAll(/["'`]([A-Za-z][A-Za-z0-9_.]*)["'`]/g)].map(
      (m) => m[1],
    ),
  );
  return new Set(allKeys.filter((k) => literals.has(k)));
}

const lookup = (tree, key) =>
  key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), tree);

/** Logiske nøkler: en flertallsgruppe er ÉN nøkkel, ikke én per form. */
function flattenKeys(tree, prefix = "") {
  return Object.entries(tree).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) && !isPluralGroup(v)
      ? flattenKeys(v, prefix + k + ".")
      : [prefix + k],
  );
}

/**
 * Hvor mange argumenter hver funksjon har lov til.
 *
 * Den øvre grensen ER fallback-forbudet: legacy-signaturene tar alle sammen et
 * siste `fallback`-argument, og en fallback skjuler en manglende nøkkel bak
 * korrekt norsk tekst — UI-et leser riktig, og de andre språkene får stille
 * norsk. `app/`s egne innpakninger (`app/i18n/index.ts`) har ikke argumentet i
 * det hele tatt; denne gaten er det som gjør at ingen kan legge det tilbake.
 */
const ARITY = {
  t: { min: 1, max: 1 },
  tf: { min: 2, max: 2 },
  // tn(key, count) og tn(key, count, params).
  tn: { min: 2, max: 3 },
  tArr: { min: 1, max: 1 },
  tDyn: { min: 2, max: 2 },
};

/**
 * Sjekk ett kall mot katalogene. Returnerer en liste feilmeldinger (uten
 * fil/linje — den som kaller setter det på).
 *
 * Ren funksjon av (kall, kataloger), slik at selvtesten kan drive hver
 * feilklasse uten å gå via filsystemet.
 */
export function checkCall(call, trees) {
  const problems = [];
  const arity = ARITY[call.fn];

  if (call.argCount > arity.max) {
    problems.push(
      call.fn === "tDyn"
        ? `${call.fn}() tar (prefiks, suffiks) — ${call.argCount} argumenter`
        : `${call.fn}() med ${call.argCount} argumenter — fallback-argumentet ` +
            `er forbudt i app/ (en fallback skjuler en manglende nøkkel bak riktig norsk)`,
    );
  }
  if (call.argCount < arity.min) {
    problems.push(`${call.fn}() mangler argumenter (${call.argCount})`);
  }

  if (call.key === null) {
    // `tDyn` er den sanksjonerte veien til en DYNAMISK nøkkel — men prefikset
    // er nettopp den delen som må være statisk, ellers er det ingenting igjen
    // å sjekke og hjelperen er bare en `t()` med et annet navn.
    problems.push(
      call.fn === "tDyn"
        ? `tDyn()-prefikset må være en literal streng (suffikset er den dynamiske halvdelen)`
        : `${call.fn}() med en nøkkel som ikke er en literal streng — bruk tDyn(prefiks, suffiks)`,
    );
  }
  // Egen setning, ikke `else` på den over: en mutasjon som fjerner MELDINGEN
  // skal felles av selvtesten, ikke krasje i katalogoppslaget under med en
  // stakksporing som ser ut som en bug i gaten selv.
  if (typeof call.key !== "string") return problems;

  for (const lang of REQUIRED_LOCALES) {
    const node = lookup(trees[lang], call.key);
    if (call.fn === "tn") {
      if (!isPluralGroup(node)) {
        problems.push(
          `tn('${call.key}') — ${lang}.json har ingen flertallsgruppe der` +
            (typeof node === "string" ? " (nøkkelen er en flat streng)" : ""),
        );
      }
      continue;
    }
    if (call.fn === "tArr") {
      if (!Array.isArray(node)) {
        problems.push(`tArr('${call.key}') — ${lang}.json har ingen array der`);
      }
      continue;
    }
    if (call.fn === "tDyn") {
      if (
        !node ||
        typeof node !== "object" ||
        Array.isArray(node) ||
        isPluralGroup(node) ||
        Object.keys(node).length === 0
      ) {
        problems.push(
          `tDyn('${call.key}', …) — ${lang}.json har ikke et ikke-tomt objekt-subtre der`,
        );
      }
      continue;
    }
    // t / tf
    if (typeof node !== "string") {
      problems.push(
        `${call.fn}('${call.key}') — ${lang}.json har ingen streng der` +
          (isPluralGroup(node)
            ? " (det er en flertallsgruppe — bruk tn())"
            : Array.isArray(node)
              ? " (det er en array — bruk tArr())"
              : ""),
      );
    }
  }
  return problems;
}

// ── Selvtest (mutasjonsvern) ────────────────────────────────────────────────

/**
 * Én kjent feil per feilklasse, skrevet som ekte TSX og kjørt gjennom den ekte
 * vandringen — ikke som håndlagde kall-objekter, for da ville selvtesten
 * bekreftet seg selv og ikke parseren.
 */
const SELFTEST_TSX = `
import { t, tf, tn, tArr, tDyn } from "./i18n";
const which = "a";
export function Fixture() {
  return (
    <div>
      {t("fix.ok")}
      {tf("fix.interp", { n: 1 })}
      {tn("fix.group", 2)}
      {tArr("fix.list")}
      {tDyn("fix.tree", which)}
      {t("fix.ok", "Reservetekst")}
      {t(\`fix.\${which}\`)}
      {t("fix.nope")}
      {tn("fix.ok", 1)}
      {tArr("fix.ok")}
      {tDyn("fix.ok", which)}
    </div>
  );
}
`;

const SELFTEST_TREE = {
  fix: {
    ok: "Greit",
    interp: "{n} ting",
    group: { one: "en", other: "flere" },
    list: ["a", "b"],
    tree: { a: "A", b: "B" },
    empty: {},
  },
};

function selfTest() {
  const problems = [];
  const say = (ok, what) => {
    if (!ok) problems.push(what);
  };

  const sf = parseSource("selftest.tsx", SELFTEST_TSX);
  const calls = collectI18nCalls(sf);
  say(calls.length === 11, `vandringen fant ${calls.length} kall, fasit 11`);

  const trees = { no: SELFTEST_TREE, en: SELFTEST_TREE };
  const verdicts = calls.map((c) => checkCall(c, trees));

  // De fem første er riktige og må være STILLE — en gate som feiler på korrekt
  // kode blir slått av, og da beskytter den ingenting.
  for (let i = 0; i < 5; i++) {
    say(
      verdicts[i].length === 0,
      `kall ${i} (${calls[i].fn}) skulle vært OK, fikk: ${verdicts[i].join(" | ")}`,
    );
  }
  // …og de seks siste er én feilklasse hver.
  const classes = [
    [5, /fallback-argumentet/, "fallback-argument"],
    [6, /ikke er en literal streng/, "ikke-literal nøkkel"],
    [7, /ingen streng der/, "nøkkel mangler i katalogen"],
    [8, /ingen flertallsgruppe/, "tn på ikke-gruppe"],
    [9, /ingen array/, "tArr på ikke-array"],
    [10, /ikke et ikke-tomt objekt-subtre/, "tDyn på ikke-subtre"],
  ];
  for (const [i, re, name] of classes) {
    say(
      verdicts[i].some((p) => re.test(p)),
      `feilklassen «${name}» ble ikke fanget (kall ${i}: ${verdicts[i].join(" | ") || "ingen feil"})`,
    );
  }

  // Et tomt subtre er like ubrukelig som et manglende — og ser identisk ut i UI.
  say(
    checkCall({ fn: "tDyn", key: "fix.empty", argCount: 2 }, trees).length > 0,
    "tomt objekt-subtre må avvises",
  );
  // En flertallsgruppe er en VERDI, ikke et navnerom: tDyn over den ville
  // plukket «one»/«other» som om de var sidenavn.
  say(
    checkCall({ fn: "tDyn", key: "fix.group", argCount: 2 }, trees).length > 0,
    "flertallsgruppe er ikke et gyldig tDyn-prefiks",
  );
  // Nøkkelen finnes i no.json, men ikke i en.json: engelsk må ikke kunne
  // oppdages av en bruker i stedet for av CI.
  say(
    checkCall(
      { fn: "t", key: "fix.ok", argCount: 1 },
      {
        no: SELFTEST_TREE,
        en: {},
      },
    ).length > 0,
    "manglende nøkkel i en.json må feile",
  );

  say(isPluralGroup({ one: "a", other: "b" }), "gruppedeteksjon");
  say(!isPluralGroup({ one: "a" }), "gruppe uten `other` teller ikke");
  say(
    !isPluralGroup({ title: "a", other: "b" }),
    "ikke-CLDR-nøkkel diskvalifiserer",
  );

  if (problems.length) {
    console.error("check-i18n-keys SELVTEST FEILET:");
    for (const p of problems) console.error("  ✗ " + p);
    process.exit(2);
  }
}

// ── Gate ────────────────────────────────────────────────────────────────────

function main() {
  selfTest();

  const args = process.argv.slice(2);
  const trees = Object.fromEntries(
    REQUIRED_LOCALES.map((l) => [
      l,
      JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, l + ".json"), "utf8")),
    ]),
  );

  const files = sourceFiles(APP_DIR, [LIB_DIR]);
  const errors = [];
  const used = new Set();
  const usedPrefixes = [];
  let callCount = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const sf = parseSource(file, fs.readFileSync(file, "utf8"));
    for (const call of collectI18nCalls(sf)) {
      callCount++;
      if (args.includes("--list")) {
        console.log(
          `${rel}:${call.line}  ${call.fn}(${call.key ?? "«dynamisk»"})`,
        );
      }
      if (call.key !== null) {
        if (call.fn === "tDyn") usedPrefixes.push(call.key + ".");
        else used.add(call.key);
      }
      for (const p of checkCall(call, trees)) {
        errors.push(`${rel}:${call.line}: ${p}`);
      }
    }
  }

  if (args.includes("--unused")) {
    const all = flattenKeys(trees.no);
    const named = keysNamedInSharedCore(all);
    const unused = all
      .filter((k) => !used.has(k))
      .filter((k) => !named.has(k))
      .filter((k) => !usedPrefixes.some((p) => k.startsWith(p)))
      .sort();
    if (unused.length) {
      console.error("i18n-ryddegate FEILET — nøkler ingen leser:\n");
      for (const k of unused) console.error("  ✗ " + k);
      console.error(
        `\n${unused.length} nøkkel/nøkler i app/i18n/locales/*.json som verken ` +
          "et `t/tf/tn/tArr/tDyn`-kall i app/ eller en delt kjerne under " +
          "app/lib/ nevner.\nSlett dem i BEGGE katalogene, no.json og en.json " +
          "(parity.test.ts krever «ingen ekstra nøkler» i begge).",
      );
      process.exit(1);
    }
    console.log(
      `✓ i18n-ryddegate: ingen ubrukte nøkler — ${all.length} nøkler i ` +
        `no.json, alle lest fra app/ eller navngitt av en delt kjerne.`,
    );
    return;
  }

  if (args.includes("--list")) return;

  // En gate uten kall å se på er grønn av tomhet. `app/` skal alltid ha minst
  // ett — skallets overskrift er en katalognøkkel nettopp for å bevise at
  // `@lib/*` når fram.
  if (callCount === 0) {
    errors.push(
      "app/ har ingen i18n-kall i det hele tatt — gaten ville vært tom. " +
        "Enten er vandringen ødelagt, eller så rendrer skallet ingen tekst.",
    );
  }

  if (errors.length) {
    console.error("i18n-nøkkelgate (app/) FEILET:\n");
    for (const e of errors) console.error("  ✗ " + e);
    console.error(`\n${errors.length} problem(er).`);
    process.exit(1);
  }

  console.log(
    `i18n-nøkkelgate OK — ${callCount} kall i ${files.length} app-filer, ` +
      `hver nøkkel funnet i riktig form i ${REQUIRED_LOCALES.join(" + ")}.json.`,
  );
}

main();
