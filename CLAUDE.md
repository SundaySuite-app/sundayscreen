# SundayScreen — instruks for Claude

## Hva appen er

Offline klasseromsskjerm (desktop-Classroomscreen) for projektoren: klokke,
timer/stoppeklokke, tekst, trafikklys, arbeidssymboler, navnetrekker,
gruppegenerator, terning. Klasseprofiler: hver klasse har egen navneliste OG
eget skjermoppsett. Ett fullskjermsvindu — læreren styrer direkte på
visningsflaten. macOS + Windows.

## Produktløfter (brytes ALDRI)

1. **Null nettavhengighet i drift.** Updater er eneste nettfunksjon og feiler
   stille. Ingen telemetri i v1. Elevnavn forlater aldri maskinen.
2. **Restart midt i timen gjenoppretter skjermen eksakt** — siste synlige
   resultat (trukket navn, lysfarge, terningkast) persisteres i widget-config.
3. **En nedgradering sletter aldri en nyere versjons widgets** — ukjent `kind`
   beholdes i DB og hoppes over i API-et.
4. **En skrive som feiler REJECTER** — aldri fabrikkert suksess.

## Arkitektur (se docs/ARCHITECTURE.md for detaljer)

- **Typeautoritet i Rust:** `crates/sundayscreen-core/src/layout.rs` eier
  `WidgetInstance`/`WidgetConfig` (`#[serde(tag = "kind")]`); ts-rs genererer
  TS-typene (`npm run bindings` → committed `app/bindings/`).
- **Koordinater er normaliserte 0..1 per akse.** Render til px via
  `surfaceSize`-signal. Tekst i widgets skalerer med `cqw`/`cqmin`.
- **Timer = mål-epoch, aldri teller.** Deriver `remaining` fra `Date.now()`.
  Delte testvektorer i `fixtures/timer-vectors.json` holder Rust- og
  TS-implementasjonene i synk.
- **SQLite via sqlx** (ALDRI tauri-plugin-store). Hele Settings som JSON i
  `app_setting`; klasser/layouts i egne tabeller. `layout_save` = replace-all
  i én transaksjon.
- **api-shim:** ALLE `invoke()` gjennom `app/lib/api-shim.ts` (fixture-søm +
  feilring + typed fallback). Appen skal alltid boote i ren nettleser.
- **Widget-registry:** én mappe per widget under `app/widgets/`;
  `registry.ts` er eneste koblingspunkt. Ny widget = ny mappe + én
  registry-linje + én `WidgetConfig`-variant + i18n-nøkler.
- **Pure core-stil:** DOM-logikk reduseres til `*-core.ts` (node-testet);
  komponentene er tynne. Vitest er node-env — ALDRI jsdom.

## Konvensjoner

- i18n: `t(key)` UTEN fallback-argument (gate håndhever). Bokmål er
  kildespråk; `en.json` holdes i paritet (test). Dynamiske nøkler kun via
  `tDyn(literalPrefix, suffix)`.
- CSS: fargeliteraler KUN i `app/styles/tokens.css` (gate). Lys-først design,
  gull `#EBB84B` som aksent.
- Dev-port **1433** — asserted i vite.config, tauri.conf (devUrl + devCsp),
  playwright.config. CSP i `app/index.html` er byte-identisk med
  tauri.conf.json (test).
- Commits: conventional (commitlint). `npm run check` skal være grønn før
  hver PR; `npm run ci` speiler CI.
- Versjon i synk: package.json / src-tauri/Cargo.toml / tauri.conf.json.

## Gates

`npm run check` = prettier, eslint, tsc, vitest, version-sync, i18n-keys
(+unused, hardcoded-tsx, plurals), css-tokens, cargo fmt/clippy(-D
warnings)/test, bindings-drift. Playwright (`npm run e2e`) er egen tier.
