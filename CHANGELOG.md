# Changelog

## [Unreleased]

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
