# SundayScreen

> **Status: under bygging (F0 — scaffold).** Første fullverdige versjon (v1.0)
> kommer etter faseplanen i `docs/ARCHITECTURE.md`.

**Klasseromsskjermen din — uten nett.** En desktop-app (macOS + Windows) som
viser verktøyene læreren trenger på projektoren: klokke, timer, beskjeder,
trafikklys, arbeidssymboler, navnetrekker, gruppegenerator og terning. Alt
lagres lokalt; ingenting krever internett i klasserommet.

En del av [Sunday Suite](https://sundaysuite.app).

## Hvorfor ikke bare Classroomscreen?

|                | Classroomscreen (web)        | SundayScreen                                             |
| -------------- | ---------------------------- | -------------------------------------------------------- |
| Uten nett      | ❌ krever nettleser + nett   | ✅ helt offline                                          |
| Klasseprofiler | betalt funksjon              | ✅ innebygd — navneliste + eget skjermoppsett per klasse |
| Lagring        | i skyen                      | ✅ lokal SQLite på maskinen                              |
| Pris           | abonnement for full funksjon | ✅ gratis, MIT-lisensiert                                |

## Stack

- **Tauri 2** (Rust-backend, systemwebview — én liten binær)
- **Preact + @preact/signals** og Vite; CSS Modules med tokens-gate
- **SQLite via sqlx** — innstillinger, klasser, layouts; alt lokalt
- Workspace-splitt: all beslutningslogikk i GUI-frie `crates/sundayscreen-core`

## Utvikling

```bash
npm install
npm run tauri dev     # appen
npm run dev           # bare skallet, i nettleser (port 1433)
npm run check         # hele gate-kjeden (JS + Rust + i18n + bindings)
npm run e2e           # Playwright-journeys (uten Tauri)
```

## Repo-kart

```
app/                  Preact-skallet (Vite root)
  i18n/locales/       katalogene (nb aktiv; en skalert, paritetstestet)
  lib/                api-shim + rene *-core-moduler
  bindings/           genererte ts-rs-typer (committes; npm run bindings)
crates/sundayscreen-core/   ren domenekjerne (settings, layout, timer, …)
src-tauri/            Tauri-skallet (kommandoer, sqlx, migrasjoner)
e2e/                  Playwright-browser-tier
scripts/              gates: i18n, css-tokens, version-sync, bindings
```

## Lisens

MIT © 2026 Richard Fossland
