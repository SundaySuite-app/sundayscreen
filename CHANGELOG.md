# Changelog

## [0.5.0-beta.2] — 2026-09-01

- **Tierterningen 0–9** (eierønske): den ekte klasseroms-tierterningen —
  samme kropp som D10, men fjesene leser 0 til 9 og motstående fjes
  summerer til 9. Egen pille i utseendevelgeren («0–9», ved siden av D10);
  bytte mellom 0–9 og 1–10 nullstiller kastet, akkurat som et kroppsbytte —
  de to deler kropp men ikke tallrom. Null er et ekte svar: det kastes,
  vises front-på og overlever omstart som alle andre tall.
- Utseendevelgeren er målt om: sju typepiller på én rad (348 px panel — den
  sjuende sto alene på egen linje).

## [0.5.0-beta.1] — 2026-08-31

Runde 5 «Terningen i rommet». Der beta.2 ga terningen tykkelse, er dette
noe annet: terningen er nå en **ekte 3D-modell** — fem legemer, kvaternioner
og perspektivprojeksjon, håndrullet i rene kjerner (ingen three.js, ingen
canvas).

- **Snurr terningen.** Dra på den, så roterer den under fingeren med
  treghet, og blir stående der du slapp — vis klassen hele tallrommet på en
  D20. Klikk kaster som før, nå som ekte 3D-tumling gjennom lufta.
- **Fem materialer og seks farger.** D-knappen åpner utseendevelgeren:
  terningtype, farge (klassisk, gull, grønn, rød, blå, skifer) og materiale
  (elfenben, kasino, tre, metall, glass — glasset er gjennomskinnelig med
  synlige bakkanter). Alle 30 kombinasjonene har bevist kontrast.
- **En ukastet terning hviler på hjørnet** — ingen fjes vendt mot klassen,
  så et tall aldri kan forveksles med et kast (granskingsfunn).
- **«Vis stort» gir faktisk stor terning** — 506 px mot før 368 på en
  1024×768-projektor (granskingsfunn).
- **Av-bryteren for automatisk oppdatering holder også ved lukking:** en
  allerede nedlastet oppdatering installeres ikke når bryteren er av, og
  panelteksten lover ikke lenger noe annet (granskingsfunn).
- Tastatur: utseendevelgeren tar fokuset med seg ved åpning og leverer det
  tilbake ved lukking.

## [0.4.0-beta.3] — 2026-08-31

- **Appen oppdaterer seg selv.** Når en ny versjon finnes, lastes den ned
  i bakgrunnen ved oppstart og installeres i det du lukker appen — aldri
  midt i en time, null klikk. Neste morgen starter du den nye versjonen
  uten å ha gjort noe. Kan slås av i panelet («Installer oppdateringer
  automatisk»). På Windows starter appen seg selv én gang etter en stille
  installasjon — det er forventet.
- Kjører du fortsatt den aller første betaen (0.9.0-beta.1): installer
  denne manuelt ÉN gang — deretter er alt automatisk.

## [0.4.0-beta.2] — 2026-08-31

- **Terningen er blitt fysisk** (eierønske): hver terning har nå tykkelse
  (som en terning på pulten), synlige sidefasetter med tynne kanter — D12
  og D20 viser frontfasetten omkranset av de skrå naboene — og prikkene på
  D6 er borete groper med lysglimt, lettere å telle fra avstand. Flate
  toner og 2-enhets kanter med vilje: det er det som overlever 40 px på en
  projektor.

## [0.4.0-beta.1] — 2026-08-31

Runde 4 «Veien tilbake» — den største runden siden verktøykassa ble bygd:
databasen kan ikke lenger gå tapt, tre nye funksjoner, og en terning som
faktisk kastes. Ingen ny migrasjon. Full historie i git-loggen (28
commits); eierpunkter i docs/NEEDS-RICHARD.md.

- **Databasen overlever alt.** Å installere en eldre beta over en nyere
  slettet før HELE databasen (klasser, elevnavn, ukeplan) uten et ord —
  nå røres fila aldri, og appen forklarer seg med en tydelig setning.
  Roterende sikkerhetskopi ved hver oppstart (aldri av en tom base — en
  kopi som kunne spist redningen din er verre enn ingen), og fem ærlige
  feiltekster som åpner med det viktigste: «Navnene dine er ikke borte.»
- **Flytt oppsettet.** Eksportér klasser, navnelister, skjermer og
  timeoppsett til én fil og hent den inn på en annen maskin. Import
  legger alltid til som nytt og overskriver aldri. Fila inneholder
  elevnavn (dialogen sier det selv) — men aldri fravær, dagens trekning
  eller gruppedeling.
- **«Vis stort».** Ett trykk forstørrer en widget til nesten hele tavla —
  tidtakeren under en prøve. En løpende nedtelling overlever både inn og
  ut, og Escape/skrimmet tar deg tilbake.
- **Terningen kastes.** Fysisk kast med sprett og rotasjon før den lander
  — og seks terningtyper: D4, D6, D8, D10, D12 og D20.
- **Trekk flere navn i ett trekk** («Trekk 3» til å dele ut roller) —
  atomisk, uten at samme elev kan få to roller, og med ærlig telling når
  det ikke er flere til stede.
- **Timen på tavla:** tidtakeren tilbyr «til timen slutter» når en time
  pågår, og agendaen kan skrives rett fra tavla (én linje = ett Enter),
  uten å åpne planleggeren foran klassen.
- **Oppdateringer synes:** når en ny versjon er klar, står det stille og
  rolig ved versjonsnummeret — ingen popup, ingen avbrytelse.
- **Feil skjuler seg ikke:** en feilet navnelesing kan ikke lenger ende
  med at «Lagre» sletter klassen; trekk/del inn/nullstill sier fra når de
  feiler; avviste importer vises der du ser; og «X av 1200 navn»-løgnen i
  panelet er lukket i begge ender.
- Pluss: vinduet skriver bare sin egen kolonne (en feilet oppstart kan
  ikke lenger bytte oppdateringskanal i det stille), planleggerens
  auto-bytte virker også dagen etter at maskinen sov, og 26 grensetall
  har fått én kilde med vakt.

## [0.3.0-beta.1] — 2026-08-30

Runde 3 «Bakerste pult» — kvalitetsrunde. Ingen ny modell, én ny kolonne:
dette er runden der appen begynner å holde det den allerede lovet. Full
gjennomgang i `docs/REVISJON-R3.md`.

- **Tavla leses fra bakerste pult.** Tallene var tunet på en 27-tommer i et
  mørkt kontor. Tekstwidgeten gikk fra 19 til 47 px på standardkortet (og
  vokser nå når du drar den bredere). Klokka med sekunder fikk aldri plass i
  noen størrelse og ble klippet i begge ender. Terningen tegnet seg 22 px.
  Dempet tekst og statusfarger består nå kontrastkravet — med en test som
  regner etterpå.
- **Trafikklyset var invertert:** den SLUKKEDE lampen var husets lyseste
  flate. Slukket er nå mørkt, tent rødt er det som lyser.
- **Fravær.** Marker hvem som er borte; navnetrekker og gruppedeler hopper
  over dem. Tavla sier «24 av 27 til stede» — men bare når noen faktisk er
  markert borte. Ingen fraværshistorikk lagres.
- **Klassen er dataene.** Bytter du fra 8A til 9B, blir ikke lenger 8As
  trukne navn og gruppeinndeling stående på tavla foran den nye klassen.
- **Tekstwidgeten har fått justering og skriftstørrelse** (feltene fantes,
  knappene manglet), og **tidtakeren faste lengder + «ett minutt til»** midt
  i en nedtelling. «Dere får 20 minutter» er ett klikk, ikke femten.
- **Tom tavle forklarer seg** i stedet for å la den eneste veien videre gli
  ut av bildet etter fire sekunder, og **planleggeren har fått navnet sitt**
  på verktøylinja.
- **Ting som ikke lenger forsvinner:** navnefelt forkastet stille det du
  skrev når du klikket utenfor; et dobbeltklikk kunne slette en hel skjerm;
  et klikk utenfor en meny lukket den aldri.
- **Vinduet åpner aldri større enn skjermen** (på en 1024×768-rigg stakk
  ~100 px under kanten, med verktøylinja i det usynlige), og en widget kan
  ikke lenger sprette ut over kanten og teleportere ved neste oppstart.
- **Dupliser widget**, snapping når du skalerer, angre som rekker 15 sekunder
  og svarer på ⌘Z, og en fokusring for den som bruker tastatur.

## [0.2.0-beta.1] — 2026-08-29

Runde 2 «Lærerens dag» — ikonspråk, planlegger, skjermbibliotek og fire
nye verktøy:

- **Ikonspråk:** eget tegnet strekikon-sett (33 ikoner). Verktøylinja er
  bygd om: «Legg til»-meny med ikoner erstatter tekstknappene, og alle
  innstillingsrader taler ikoner der det er trangt. Arbeidssymbolene er
  tegnede glyfer, ikke emoji.
- **Skjermbibliotek:** lagre skjermen som en navngitt «skjerm» og bruk den
  i alle klasser (navnetrekker m.m. følger alltid aktiv klasse). Bytt fra
  ny skjermvelger på verktøylinja; klassens standardskjerm består.
- **Planlegger:** definer skolens timeoppsett én gang, fyll den faste
  ukeplanen (klasse + fag + skjerm per økt), overstyr enkeltdatoer
  (prøve, tur, utgått time), og planlegg agenda og beskjeder per time —
  i forkant.
- **Ved timestart:** et diskret banner foreslår neste time — ett klikk
  bytter klasse og skjerm. Valgfri helautomatikk (av som standard).
- **Nye verktøy:** «Dagens time» (agendaen på tavla, klokkestyrt
  nå-markør med manuell pinning, avhaking rett i planen — også manuell
  modus uten planlegger), «Dagen i dag» (dato, timeplan og beskjeder),
  «Frist» (nedtelling i dager til en dato, med varselfarger) og
  «Sjekkliste» (store avkryssingsrader).
- **Fundament:** ukjente felter i kjente widget-configs og innstillinger
  overlever nå eldre versjoners lagringer (ADR-007) — trygg grunn for
  alle fremtidige utvidelser.

Alt virker som før helt uten nett; planleggerdata bor kun i den lokale
databasen.

## [0.1.0-beta.1] — 2026-08-27

Første beta — hele verktøysettet, gransket. (Utgitt tidligere samme dag som
`v0.9.0-beta.1`; eier valgte å starte nummereringen på 0.1 i stedet — se
ADR-008. Samme innhold, nytt nummer; 0.9.0-utgivelsen er trukket.)

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
plass (prøv å åpne først, så Systeminnstillinger → Personvern og sikkerhet →
«Åpne likevel» — «høyreklikk → Åpne» virker ikke lenger på macOS 15, se
docs/DISTRIBUTION.md); ikke notarisert (Apple-PLA).

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
