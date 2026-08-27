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
