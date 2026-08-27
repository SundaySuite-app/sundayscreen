# Changelog

## [0.9.0-beta.1] — 2026-08-27

Første beta — hele v1-verktøysettet, gransket:

- 8 widgets: tekst, klokke (digital/analog), tidtaker/stoppeklokke (m/
  lydvarsel og varselfarge), trafikklys, arbeidssymboler, navnetrekker (m/
  «ingen gjentak»-runder), gruppegenerator, terning.
- Klasseprofiler: egen navneliste + eget skjermoppsett per klasse, atomisk
  bytte på to klikk; lim-inn-navneliste fra Excel.
- Auto-hide-verktøylinje, F11-fullskjerm, vindusminne, bundlet Inter.
- Auto-oppdatering på suitens beta/stable-ringer (stille offline).
- F9-gransking: 39 funn fra tre fiendtlige granskere, 30 fikset (se
  docs/GRANSKING-v1.md).

Kjente begrensninger: macOS-bygget er ad-hoc-signert til `MAC_CERTS` er på
plass (høyreklikk → Åpne første gang); ikke notarisert (Apple-PLA).

## [Unreleased]

### F1–F5 (2026-08-27)

- **F1:** widget-rammeverket — typeautoritet i Rust (`WidgetConfig` m/
  kind-tag), normaliserte koordinater, toleransesøm (ukjent kind overlever
  nedgradering), tekst-widget, Playwright-tier m/ fixture-harness,
  reachability-gate.
- **F2:** interaksjonslaget — dra m/ snapping og gullguider, SE-skalering m/
  minstestørrelser, klikk-vs-dra-terskel, «legg øverst»,
  slett-med-angre-snackbar.
- **F3:** klasser — CRUD m/ typed-confirm-sletting, lim-inn-navneliste
  (identitet bevares ved navn → trekkerunden overlever re-lagring), atomisk
  klassebytte m/ flush-sekvensering, klassebytter i verktøylinja.
- **F4:** klokke (digital/analog, sekunder, dato) og timer/stoppeklokke —
  mål-epoch-design m/ delte Rust/TS-testvektorer, WebAudio-chime,
  varselfarge.
- **F5:** navnetrekker (no-repeat-runde i draw_state, spinn-animasjon),
  gruppegenerator (seedet shuffle + round-robin, størrelser differ ≤ 1),
  terning 1–3 m/ persistert kast.

### F0 — Scaffold (2026-08-27)

- Nytt repo etter SundayRec-mønsteret: Tauri 2 + Preact/signals + Vite
  (port 1433), CSS Modules m/ tokens-gate, sqlx/SQLite, workspace-splitt med
  GUI-fri `sundayscreen-core`.
- Full gate-kjede fra dag én: prettier/eslint/tsc/vitest, version-sync,
  i18n-gates (keys/unused/hardcoded/plurals), css-tokens, cargo
  fmt/clippy/test, ts-rs bindings-drift, Playwright-browser-tier.
- Skjema v1: `app_setting`, `class`, `class_member`, `widget_instance`,
  `draw_state` (FK + kaskade, testet).
- Kommandoer: `app_info`, `settings_get`, `settings_save` (validert
  Settings-modell i core m/ lenient merge).
