# SundayScreen — arkitektur

> Vedtatt 2026-08-27 (planfasen). Dette dokumentet er kartet; koden er
> terrenget. Avvik skal enten rettes i koden eller besluttes her (ADR i
> DECISIONS.md).

## Produktet

Ett fullskjermsvindu på projektoren. Læreren styrer alt direkte på
visningsflaten: verktøylinja nederst legger til widgets som flyttes, skaleres
og lukkes. Klasseprofiler bytter navneliste + layout atomisk med to klikk.
Helt offline i drift; updater er eneste nettfunksjon og feiler stille.

**v1-widgets:** klokke · timer/nedtelling/stoppeklokke · tekst · trafikklys ·
arbeidssymboler · navnetrekker · gruppegenerator · terning.
**Veikart (ikke i v1, arkitekturen stenger ikke):** dagsplan (v1.1), lydmåler,
tegning/whiteboard, toskjermsmodus, egne bakgrunnsbilder.

## Lagene

```
app/            Preact + signals. Tynne komponenter over rene *-core.ts.
  lib/api-shim  ALLE invoke() går her: fixture-søm, feilring, typed fallback.
  widgets/      én mappe per widget; registry.ts er eneste koblingspunkt.
crates/sundayscreen-core   Typeautoritet + all beslutningslogikk (headless).
src-tauri/      Tynt I/O-skall: kommandoer, sqlx, vindushåndtering.
```

## Nøkkelbeslutninger

1. **Typeautoritet i Rust.** `layout.rs` eier `WidgetInstance { id, kind,
rect: NormRect, z, config }` og `WidgetConfig` som `#[serde(tag =
"kind")]`-enum med én variant per widget (+ clamping per felt). ts-rs
   eksporterer TS-typene. DB lagrer `kind` og `config` i separate kolonner:
   ødelagt config → den widgeten får sin kinds defaults (overlever); ukjent
   kind → beholdes i DB, hoppes over i API (nedgradering sletter aldri).
2. **Normaliserte koordinater 0..1 per akse** (x,w mot flatebredde; y,h mot
   høyde). Px-konvertering via `surfaceSize`-signal (ResizeObserver). Løser
   projektorbytte, 4:3↔16:9 og Windows-DPI. Tekst skalerer med
   container-query-enheter (`cqw`/`cqmin`). `clamp_layout` i core garanterer
   [0,1], min-størrelse, endelige tall, re-indeksert z. Pikselminima per kind
   håndheves i interaksjonslaget (mot live flatestørrelse), ikke i persistert
   clamp.
3. **Interaksjon hand-rullet:** `app/screen/interact-core.ts` (pure,
   table-testet): hitTest, dragCandidate, snap (kanter+senter+søsken, 8 px),
   bringToFront, renormalizeZ. Tynn `useDrag` med pointer events +
   `setPointerCapture`. Ingen grid; snapping dekker justering.
4. **Timer = mål-epoch.** `Running { targetEpochMs }`; hver frame DERIVERER
   `remaining = target − Date.now()` → dvale/throttling kan ikke drifte. rAF
   pluss 1 s interval-backstop. `tick()` avgjør lyd-ved-oppvåkning (krysset
   < 60 s siden → lyd, ellers stille Finished). Spesifisert i
   `core/src/timer.rs` OG kjørt i `timer-core.ts`, holdt i synk med delte
   testvektorer `fixtures/timer-vectors.json` (asserted av cargo OG vitest).
   Løpende timer persisteres bevisst ikke.
5. **Lyd = WebAudio-syntetisert** tonespill. Null lydfiler, null
   kodek-matrise, offline by construction.
6. **Lagring:** replace-all `layout_save(class_id, widgets)` i én transaksjon
   (idempotent, atomisk). Umiddelbart ved diskrete commits (pointerup,
   add/delete, klikk-bytter); debounce 500 ms for tekst-skriving.
   Klassebytte: flush → `class_switch(id) → ClassSnapshot` (én transaksjon)
   → signal-swap i `batch()`.
7. **Fullskjerm:** boot i vindu (dra til projektor) → F11/knapp; macOS
   `set_simple_fullscreen`, Windows borderless `set_fullscreen` — ALDRI
   always-on-top/exclusive. Lagdelt Escape (popover → overlay → fullskjerm).
   `windowState` persisteres m/ monitor-sanity-clamp.

## SQLite-skjema

Se `src-tauri/migrations/0001_init.sql`: `app_setting` (Settings-JSON),
`class`, `class_member` (duplikatnavn OK — identitet er id), `widget_instance`
(én layout per klasse i v1; normaliserte koordinater), `draw_state`
(navnetrekkerens «ingen gjentak»-pool). Konvensjoner: TEXT UUID v7, REAL
epoch-ms, FK håndhevet.

## IPC-flate (mål for v1)

`settings_get/save` · `class_list/create/rename/delete/switch` ·
`members_set` · `layout_load/save` · `picker_draw/reset` · `groups_split` ·
`update_check_silent/manual`, `update_install`. Alle med typed shim-fallback.

## Faseplan

- **F0 Scaffold** (alle gates armert) ✅
- **F1** Flate + widget-rammeverk + tekst-widget + Playwright-tier ✅
- **F2** Interaksjonslag (drag/resize/snap/z + angre-snackbar) ✅
- **F3** Klasser (CRUD, lim-inn-navneliste, atomisk bytte) ✅
- **F4** Klokke + timer/stoppeklokke (vektorparitet) ✅
- **F5** Navnetrekker + grupper + terning (egenskapstester) ✅
- **F6** Trafikklys + arbeidssymboler + standard innstillingsrad ✅
- **F7** Chrome/auto-hide + fullskjerm + vindusminne + bundlet Inter ✅
- **F8** Updater (suite-ringer, stille feiling) + pakking + release.yml ✅
- **F9** Gransking — 39 funn, 30 fikset (docs/GRANSKING-v1.md) ✅
- **F10** `v0.9.0-beta.1` publisert + promotert til beta-ringen (08-27) ✅
  → 👤 riggtest i klasserom → `v1.0.0`
- **F11** Nettside-kort + nedlastingsfunksjon på sundaysuite.app
