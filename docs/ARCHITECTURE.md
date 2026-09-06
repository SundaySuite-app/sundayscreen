# SundayScreen — arkitektur

> Vedtatt 2026-08-27 (planfasen). Dette dokumentet er kartet; koden er
> terrenget. Avvik skal enten rettes i koden eller besluttes her (ADR i
> DECISIONS.md).

## Produktet

Ett fullskjermsvindu på projektoren. Læreren styrer alt direkte på
visningsflaten: verktøylinja nederst legger til widgets som flyttes, skaleres
og lukkes. Klasseprofiler bytter navneliste + layout atomisk med to klikk.
Helt offline i drift; updater er eneste nettfunksjon og feiler stille.

**Widgets:** klokke · timer/stoppeklokke · tekst · trafikklys ·
arbeidssymboler · navnetrekker · gruppegenerator · terning · dagens time ·
dagen i dag · frist · sjekkliste (Runde 2) · lenke · bilde (Runde 6). Lista
er `WidgetConfig`-variantene i `layout.rs` og `WIDGET_REGISTRY` — tell dem
DER, aldri her. **Skjermbibliotek:** navngitte, globale
oppsett per time; klassens standardskjerm består. **Planlegger:**
timeoppsett → ukeplan → datoavvik → agenda/beskjeder; forslag-banner +
valgfritt auto-bytte ved timestart.
**Veikart (arkitekturen stenger ikke):** klassekart/plassering, poengteller,
lydmåler, friminutt-skjerm, A/B-uker, touch, tegning, toskjermsmodus.

## Lagene

```
app/            Preact + signals. Tynne komponenter over rene *-core.ts.
  lib/api-shim  ALLE invoke() går her: fixture-søm, feilring, typed fallback.
  widgets/      én mappe per widget; registry.ts er eneste koblingspunkt.
                WidgetDef har en valgfri Overlay-slot (se pkt. 9).
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
   always-on-top/exclusive. Lagdelt Escape (widgetoverlay → addmenu → menu →
   overlay → fokus → fullskjerm). `windowState` persisteres m/
   monitor-sanity-clamp.
8. **Terningen er en 3D-modell** (ADR-015). Fem konvekse legemer utledet fra
   φ/√5, kvaternion-orientering og perspektivprojeksjon, i tre rene kjerner
   (`die-solids-core` · `die-orient-core` · `die-project-core`); komponenten
   er en tynn rAF-driver som maler SVG imperativt. Ingen three.js —
   budsjettaket er 185 000 B rå JS. Konveksitet gir kulling uten
   z-sortering; ett Lambert-trinn per fjes slår opp i en CSS-rampe (flate
   toner er fysikk, ikke kompromiss). **Rotasjonen bor i geometrien, aldri i
   en CSS-transform** — e2e-påstandene om det er arkitekturlåsen. Orientering er
   view-tilstand og persisteres aldri; `lastRoll` bærer løfte 2 alene.
9. **`WidgetDef.Overlay`:** valgfri slot for et panel som ikke får plass i
   kortet. Hvert kort er `overflow: hidden` + `container-type: size`, og
   layout containment gjør kortet til containing block for `position: fixed`
   — ingen widget kan tegne en popover ut av sitt eget kort. Skjermlaget
   (`screen/WidgetOverlay.tsx`) rendrer panelet på Shell-nivå, plassert av
   `screen/popover-core.ts`; `--z-popover: 200` og øverste Escape-rung.
   Registeret forblir eneste koblingspunkt, så evnen arves av alle kinds.
   Verten og alt den rendrer må aldri bære `transform`/`filter`/`contain`/
   `container-type` (ADR-015).

## SQLite-skjema

`0001`: `app_setting` (Settings-JSON), `class`, `class_member` (duplikatnavn
OK — identitet er id), `widget_instance`, `draw_state`. `0002`: indeks på
`draw_state.member_id` (FK-oppslaget kunne ikke bruke PK-en `(class_id,
member_id)` alene; hver medlemssletting full-scannet ellers). `0003`: `scene`
(class_id NULL = global; klassens standard = `default-<klasseid>`) og
widget_instance GJENOPPBYGD scene-nøklet. `0004`: `period`, `week_slot`,
`date_override`, `agenda_item`, `day_note` (tid = minutter siden midnatt,
dato = frontend-myntet `YYYY-MM-DD`). `0005`: `class_member.absent_on` — en
DATOSTEMPEL (ikke en boolean), overskrevet aldri akkumulert; ingen
fraværshistorikk lagres (ADR-010). `0006`: `scene.theme` (TEXT NOT NULL
DEFAULT `'standard'`) — et NAVNGITT vokabular eid av
`sundayscreen_core::theme::SceneTheme`, lest lempelig (ukjent staving →
`standard`). `0007`: `week_slot.merged_with_next` (INTEGER NOT NULL,
default 0) og `date_override.merged_with_next` (INTEGER, NULLBAR og dermed
TRI-STATE: NULL = arv fra uka, 1 = slå sammen i dag, 0 = del opp i dag) —
dobbelttimen er et FLAGG, ikke en ny radform. Konvensjoner: TEXT UUID v7,
REAL epoch-ms, FK håndhevet. Migrasjonsfiler er APPLIED-FOREVER — aldri
rediger en anvendt fil (checksum-avvik leses som korrupsjon). 0006 og 0007
er de første som har kjørt mot EKSISTERENDE filer (v0.6.0-beta.1); begge er
rene `ALTER TABLE ADD COLUMN`, så en eldre build ser dem ikke (løfte 3), og
hva en fil som snubler UNDER migrasjonen gjør, står i ADR-013.

## IPC-flate

Sannhetskilden er `generate_handler!`-lista i `src-tauri/src/lib.rs`; denne
seksjonen skal speile den kommando for kommando (47 i dag):

`app_info` · `boot_fault` · `settings_get/save/set_window` ·
`class_ensure_active → ActiveContext` ·
`class_list/create/rename/delete/switch` · `members_get/set` ·
`attendance_set` · `layout_load/save` (scene-nøklet) · `image_pick/load` ·
`link_open` (tar en WIDGET-ID, aldri en URL — ADR-017) · `scene_list/get/
create/rename/delete/duplicate` · `scene_set_theme` · `scene_usage` ·
`lesson_switch → ClassSnapshot` ·
`picker_draw_many/reset` · `groups_split` · `planner_periods_get/set` ·
`planner_week_get` · `planner_slot_set` · `planner_override_set` ·
`planner_day_get → DayPlan` · `planner_agenda_set/check` ·
`planner_notes_set` · `transfer_export/import` · `update_check/install` ·
`update_pending` · `window_set_fullscreen` · `window_is_fullscreen`. Alle
gjennom api-shimmen; skriv REJECTer. `boot_fault`, `update_pending` og
`window_*` er med vilje Db-frie, så de svarer også i en degradert boot.

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
- **F10** første beta publisert + promotert til beta-ringen (08-27) ✅ —
  utgitt som `v0.9.0-beta.1`, senere samme dag renummerert til
  `v0.1.0-beta.1` (ADR-008: 0.x-betaer, ingen v1-milepæl).
  → 👤 riggtest i klasserom; stable først når eier ber om det
- **F11** Nettside (08-27) ✅ — ellevte kjerneprodukt på sundaysuite.app:
  produktside EN+NO, kort i «Tilgjengelig i dag», grønn juveltile-logo,
  `/download/sundayscreen/{mac,windows,version}` (leser suite-feeden,
  stable-ring først, så beta — flipper selv ved v1.0.0). Live-verifisert.

### Runde 2 «Lærerens dag» (2026-08-29)

- **R0** ADR-007: flatten-extra på hele config-vokabularet + Settings ✅
- **R1** Ikonsystem (app/ui/icon-paths + Icon, WidgetDef.icon) ✅
- **R2** Verktøylinje: «Legg til»-meny, ikon-chrome, U#9-fiks ✅
- **R3** Ikonsveip: rader, ManagePanel, tegnede arbeidssymboler ✅
- **R4/R5** Skjermbibliotek: migrasjon 0003 (scene-nøklet widget_instance),
  lesson_switch, SceneSwitcher, harness re-nøklet ✅
- **R6/R7** Planlegger: migrasjon 0004, schedule.rs (skyggeregelen),
  panel m/ Timeoppsett/Ukeplan/I dag, ?goto=planner ✅
- **R8** «Dagens time» + «Dagen i dag» (planner-bundet, state/planner.ts:
  hendelsesdrevet henting + 30s derive-tick) ✅
- **R9** «Frist» + «Sjekkliste» (blur committer med umiddelbar lagring) ✅
- **R10** Forslag-banner + auto_switch_scenes (suggest-core) ✅
- **R11** Gransking: 3 granskere, 55 funn, 23 fikset (docs/GRANSKING-R2.md)
  → v0.2.0-beta.1 ✅

### Runde 3 «Bakerste pult» (2026-08-30)

Kvalitetsrunde, ingen ny modell (én kolonne: `absent_on`, migrasjon 0005).
Seks granskere → motbevisnings-agent per forslag (85 forslag inn, 62
overlevde). Full gjennomgang i docs/REVISJON-R3.md.

- **Kontrast/typografi** for projektor-avstand: WCAG-luminans-vakt i
  tokens.css (mutasjonstestet), trafikklysets slukkede/tente lampe snudd
  (var invertert — den slukkede var husets lyseste flate), tekstwidget/
  klokke/terning skalert opp.
- **Widget-ergonomi:** tekst-, tidtaker- og gruppewidgetens hover-rad fikk
  knappene komponentene allerede lovet (align/fontScale, faste
  tidtaker-lengder, «Del inn» av tavla mellom økter).
- **Fravær** (migrasjon 0005, ADR-010): datostempel per elev per dag;
  navnetrekker/gruppedeler hopper over de markert borte.
- **Klassebytte er ikke-destruktivt** for trukne navn/grupper (8A stod ikke
  lenger foran 9B), og to «measure mot feil ramme»-rotårsaker (halvbredde-
  fella, transform-fella) rettet i skallet der alle arver fiksen.
- **Vindu/flate:** vinduet åpner aldri større enn skjermen, fullskjerm-
  flagget måles (ikke bare antatt) ved vindusgjenoppretting, en widget kan
  ikke lenger sprette ut over kortets minstemål og teleportere ved neste
  oppstart.

→ v0.3.0-beta.1 ✅

### Runde 4 «Veien tilbake» (2026-08-31)

Ingen ny migrasjon. Boot-stien bygd om: en nedgradering RØRER ALDRI fila
(`should_quarantine` — kun bevist ødelagte bytes, ADR-013), roterende
sikkerhetskopi ved hver oppstart, og fem ærlige feiltekster i stedet for en
panikk uten vindu. «Flytt oppsettet» (ADR-012, `transfer.rs` i krateret +
`commands/transfer.rs`) og updateren som installerer ved LUKKING (ADR-014).

→ v0.4.0-beta.1…3 ✅

### Runde 5 «Terningen i rommet» (2026-08-31)

Terningen ble en ekte 3D-modell i tre rene kjerner (ADR-015), og registeret
fikk `WidgetDef.Overlay` for paneler som må ut av kortet. «Vis stort» gir
faktisk stor terning — e2e måler pikslene (`e2e/readability.spec.ts`).

→ v0.5.0-beta.1…3 ✅

### Runde 6 «Skjermen er planen» (2026-09-05)

- **Designøkta er en LÅNT TAVLE** (ADR-016): den ekte editoren, i miniatyr,
  som skriver til timens scene mens veggen står urørt. Flush-rekkefølgen er
  den farlige linja, begge veier.
- **Dobbelttimen er et FELT** (migrasjon 0007), ikke en ny radform — alt
  nedstrøms utledes av `resolve_day`.
- **Skjermfarge** (migrasjon 0006), navngitt vokabular, lempelig lest.
- **Lenke** (ADR-017: knappen er aldri et anker, URL-en kommer fra
  databasen) og **Bilde** (ADR-018: filer i app-data, boot-sweep-GC).

→ v0.6.0-beta.1 ✅
