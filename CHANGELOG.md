# Changelog

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
