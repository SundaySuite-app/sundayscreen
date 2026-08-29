# Beslutningslogg (ADR)

## ADR-001 — Preact + signals, ikke React (2026-08-27)

SundayRec-mønsteret: minst mulig runtime, signal-basert i18n/state, JSX via
kompilatoren (ingen @preact/preset-vite på rolldown/oxc-stacken). Suiten har
begge leirer (Stage/Edit er React); SundayScreen kopierer den nyeste og best
gatede appen.

## ADR-002 — Normaliserte koordinater, ikke piksler (2026-08-27)

Projektorer varierer (1024×768 ↔ 1920×1080, 4:3 ↔ 16:9) og Windows-DPI
endrer CSS-px-viewporten. Lagrede piksler kan legge widgets utenfor skjermen;
0..1-fraksjoner per akse reflowes proporsjonalt overalt. Aspektfølsomme
widgets tegner kvadratisk inni boksen sin.

## ADR-003 — Timer på mål-epoch, dobbel implementasjon m/ delte vektorer (2026-08-27)

Veggklokke-epoch gjør dvale/throttling harmløst (deriver, aldri akkumuler;
`performance.now()` PAUSER over dvale på flere plattformer og er forkastet).
Transisjonene må også kjøre i ren nettleser (shim-fallback), så TS-utgaven
finnes uansett; Rust-utgaven er spesifikasjonen. Delte JSON-testvektorer
(`fixtures/timer-vectors.json`) asserted av begge testløp er divergensgaten —
samme grep som locale-paritetstesten.

## ADR-004 — WebAudio-syntetisert varsellyd (2026-08-27)

Ingen bundlede lydfiler: WKWebView mangler ogg, mp3 drar lisens/kvalitetsvalg,
og en fil er én ting til som kan mangle offline. To-tone-chime i ~15 linjer
WebAudio er offline by construction.

## ADR-005 — Ingen telemetri i v1 (2026-08-27)

Klasseromsdata (elevnavn!) skal aldri forlate maskinen. Updater-sjekken er
eneste nettkall, går mot `updates.sundaysuite.app` (IKKE telemetri-hosten) og
svelger alle feil. Eventuell telemetri senere er et eget eiervalg med suitens
samtykke-mønster.

## ADR-006 — Lys-først design (2026-08-27)

Klasserom er lyse rom og projektorer gjengir lyst best. Suite-gull #EBB84B som
aksent; verdier kopiert fra @sunday/design (ikke pakkeimport — ingen
desktop-app importerer pakken, og appen skal bygge standalone).

## ADR-008 — Versjonering: 0.x-betaer, ingen v1-milepæl (2026-08-27, eiervalg)

Eier vil ha beskjeden nummerering: produktet starter på **0.1** og går KUN som
beta inntil videre — planens `v0.9.0-beta.1 → v1.0.0`-løp er forlatt. Den alt
publiserte `v0.9.0-beta.1` (samme dag, samme innhold) ble trukket og
renummerert til `v0.1.0-beta.1`. Konsekvens av nedjusteringen: en maskin som
rakk å installere 0.9.0-beta.1 ser ALDRI 0.1.x-utgivelser i updateren
(semver-sammenligning klient-side) og må reinstallere manuelt én gang.
Stable-ringen tas i bruk først når eier eksplisitt ber om en stabil utgivelse.
(ADR-007, config-felttoleranse, står i docs/GRANSKING-v1.md.)

## ADR-009 — Runde 2-modellvalg (2026-08-29)

- **Globale skjermer er klasse-agnostiske og live-redigerte.** En skjerm er
  et oppsett; klassen er dataene (trekker/grupper leser alltid aktiv
  klasse). Redigering av en global skjerm gjelder biblioteket direkte —
  copy-on-write ville forgrenet stille; «Dupliser»/«Lagre som ny skjerm»
  er fluktveien. Klassens standardskjerm (deterministisk id
  `default-<klasseid>`) er ikke bibliotekvare og dør med klassen.
- **Agenda hektes på dato-instansen (dato, økt)** — neste tirsdag er ikke
  denne tirsdagen, og samme nøkkel virker uansett om timen kom fra
  ukeplanen eller et datoavvik. Skyggeregelen bor ETT sted:
  `core/schedule.rs::resolve_day`.
- **Tid uten chrono:** økter er minutter siden lokal midnatt, datoer er
  frontend-myntede `YYYY-MM-DD`-nøkler (JS eier veggklokka), ukedag
  ISO 1..5. Kjernen leser aldri klokke.
- **Banneret rendrer bare.** Pekere flyttes av lærerens klikk eller den
  eksplisitt påslåtte automatikken — aldri av rendering. Én nøkkel per
  time-instans gjør «Ikke nå» og fyr-én-gang strukturelle.
