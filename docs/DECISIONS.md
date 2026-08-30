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

## ADR-010 — Fravær er et datostempel, ikke en boolean (2026-08-30)

`class_member.absent_on TEXT` (migrasjon 0005). «Borte» betyr
`absent_on == dagens dato`. Alternativet — `present INTEGER` + en jobb som
nullstiller ved døgnskifte — kan MISTE en dag: klasseromsmaskiner står
avslått over natten, og en app som aldri kjørte ved midnatt starter
tirsdagen med mandagens fravær stående. Med datostempel er datoskiftet
implisitt og alltid riktig, uten noen jobb i det hele tatt.

Kolonnen OVERSKRIVES, aldri appenderes: det oppstår ingen fraværshistorikk.
Fraværsføring hører hjemme i skolens system, og PRIVACY.md lover ikke noe om
den datakategorien. Appen vet bare hvem som er her akkurat i dag, og bare
til i morgen.

Følgekrav som er lette å bomme på: trekker og gruppedeler får de
TILSTEDEVÆRENDE id-ene som grunnmengde — gir man dem hele klassen, blir
no-repeat-runden aldri komplett og «gjenstår»-tellingen lyver. Og «alle er
borte» er en EGEN feil, ikke samme melding som en tom klasse.

## ADR-011 — Referanseflate 1280×800, én felles skalar (2026-08-30)

`defaultSizePx` i widget-registeret er tunet mot 1280×800 og INGEN annen
flate. Det står nå erklært i koden (`REFERENCE_SURFACE` i coords-core), og
nye kort skaleres med **én felles skalar** `k = min(w/1280, h/800)`, gulvet
mot widgetens eget `minSizePx` og taket på 0,9.

To uavhengige aksebrøker ble forkastet: de gjør en 300×300-klokke til
450×405 på 16:9 — formen ryker, og widgets som tegner kvadratisk inni boksen
sin (ADR-002) får plutselig luft på sidene.

Konsekvens eieren bør kjenne: på 1080p blir kortene ~1,35× større, og
~4–5 får plass før kaskaden i stedet for ~6–7. Har man rutinemessig seks
widgets oppe samtidig, er grepet feil — da senkes heller registertallene og
brøken gjør resten.

## ADR-012 — «Flytt oppsettet»: én fil, alltid som NYTT (2026-08-30)

> Nummerhullet er ekte: **ADR-007** (config-felttoleranse) står i
> `docs/GRANSKING-v1.md`, ikke her. Den er ikke tapt, og dette dokumentet
> hopper fra 006 til 008 av den grunnen alene.

Læreren skal kunne flytte klasser, elevnavn, skjermer og timeoppsett til en
annen maskin uten sky og uten konto. Valgene som er låst:

- **Filformatet er ETT JSON-dokument** (`kind: "sundayscreen-setup"`,
  `schemaVersion: 1`), definert i `crates/sundayscreen-core/src/transfer.rs`
  — GUI-fritt og enhetstestet. Portene i rekkefølge: `kind` sjekkes FØRST (en
  fremmed fil får «dette er ikke en SundayScreen-fil», aldri en parsefeil);
  en NYERE `schemaVersion` avvises HELT, med `appVersion` i setningen (aldri
  halv-import — en nyere fils form er ukjent, og å adoptere halvparten er å
  miste resten i stillhet); ellers `#[serde(default)]` overalt og ukjente
  nøkler ignorert. `SCHEMA_VERSION` flyttes KUN ved brudd, aldri for et nytt
  felt — suite-presedensen er SundaySyncs `SCHEMA_VERSION: u32 = 1`.
  `appVersion` er ren diagnostikk og aldri en beslutningsakse.
- **Import legger ALLTID til.** Nye klasser, nye skjermer, nye ider. Ingenting
  slås sammen, overskrives eller slettes, og `app_setting` røres ikke i det
  hele tatt — importerer man midt i en time, endrer ingenting seg på tavla.
  Alternativet (fletting på navn) måtte gjettet om «7B» på to maskiner er
  samme klasse, og en feil gjetning ville kostet en navneliste.
- **Ukeplanen er unntaket, og den er alt-eller-ingenting.** Øktmalen er en
  GLOBAL singleton. `UNIQUE (weekday, period_id)` ser ut som et vern og er
  det ikke: de importerte øktene får FERSKE ider, så hver eneste importerte
  celle er unik mot alle eksisterende og begge lander — resultatet er en
  stille DOBBEL skoledag (`resolve_day` itererer alle øktrader, og editorens
  `periods_overlap`-gate omgås av en direkte INSERT). Derfor importeres
  planleggerdelen KUN inn i en TOM `period`-tabell; ellers hoppes den over,
  og kvitteringen SIER det.
- **Grensene avviser, de trunkerer ikke.** `members::reconcile` kapper en
  limt liste med `take(MEMBERS_MAX)` — riktig for et tekstfelt læreren ser,
  feil for en fil hun ikke ser. En import forbi en grense refuseres helt, før
  første INSERT (løfte 4).
- **Widgets reiser som RÅ `kind`/`config`-strenger.** Toleransen for en ukjent
  `kind` bor i `commands/layout.rs`, ikke i lagret — så en fil fra en NYERE
  SundayScreen bærer sine ukjente kort uendret gjennom en import, akkurat som
  en nedgradering bærer dem gjennom en lagring (løfte 3). To separate felter,
  fordi kolonnen er to felter: slått sammen blir «ukjent kind» og «korrupt
  config» det samme.
- **Fila inneholder ALDRI `absent_on`.** Betalt strukturelt, ikke ved å huske
  å filtrere: `TransferClass::members` er `Vec<String>`. ADR-010 og PRIVACY.md
  lover at det ikke finnes fraværshistorikk noe sted, og en fil på en
  minnepenn ville vært nettopp det. Heller ikke `draw_state`,
  `date_override`/`agenda_item`/`day_note` (dato-nøklede — fjorårets fil ville
  importert agendaer på passerte datoer, og de to siste har ingen UNIQUE) og
  ikke `app_setting`.
- **Fildialogen er ren Rust.** `tauri-plugin-dialog` registreres i `lib.rs` og
  kalles bare fra `commands/transfer.rs`; all fil-I/O er `std::fs` i Rust.
  `capabilities/default.json` er URØRT — Tauris ACL styrer IPC FRA webviewet,
  og webviewet ser aldri pluginen. Presedensen er appens egen updater, som
  har gått i produksjon uten capability-oppføring av samme grunn. Ingen
  npm-pakke; CSP-en er urørt. Dialogtitlene sendes INN som argumenter, slik
  `class_ensure_active(default_name)` gjør: en setning læreren leser skal
  aldri være kompilert inn i backenden.
