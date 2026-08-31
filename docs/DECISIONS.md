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
- **Ett unntak fra toleransen: `TransferPeriod.kind`** (R4). Alle andre
  enum-felter i krateret er `lenient` — en stavemåte vi ikke kan lese koster
  feltet, ikke blobben. Her koster den HELE fila, med vilje: fallbacken er
  `Lesson`, og en time er noe appen HANDLER på (banner, forslag om å bytte
  klasse og skjerm, auto-bytte, pille på tavla). En fremtidig `"assembly"`
  som stille blir en time, setter en oppdiktet time på projektoren foran en
  klasse. Fraværende felt defaulter fortsatt — det er den gamle fila, ikke en
  ny verdi.
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
  og kvitteringen SIER det. R4 la til at ukeplanens EGEN integritet valideres
  før første INSERT: en celle som peker på en økt fila ikke inneholder ble
  hoppet over med `continue` mens kvitteringen sa «Importert», og to celler
  på samme `(ukedag, økt)` traff `UNIQUE` midt i transaksjonen og ble en
  generisk feil. Begge er samme faktum — fila kan ikke leses — og får samme
  setning.
- **Grensene avviser, de trunkerer ikke.** `members::reconcile` kapper en
  limt liste med `take(MEMBERS_MAX)` — riktig for et tekstfelt læreren ser,
  feil for en fil hun ikke ser. En import forbi en grense refuseres helt, før
  første INSERT (løfte 4). Fra R4 kjører SAMME `check_limits` på EKSPORTEN,
  før fildialogen åpnes: eksporten validerte ingenting, og de to halvdelene
  er ikke enige av seg selv (et ukeplan-fag har ingen lengdegate på vei inn,
  men en grense på vei ut). Ellers skriver vi en fil som ser perfekt ut og
  avvises HELT på den andre maskinen — der ingenting kan gjøres med det.
  Bruddet reiser som `AppError::Validation` og navngir hva som er for langt;
  `ImportOutcome` er en KVITTERING for en fil man har valgt, og her finnes
  det ingen fil ennå.
- **Widgets reiser som RÅ `kind`/`config`-strenger.** Toleransen for en ukjent
  `kind` bor i `commands/layout.rs`, ikke i lagret — så en fil fra en NYERE
  SundayScreen bærer sine ukjente kort uendret gjennom en import, akkurat som
  en nedgradering bærer dem gjennom en lagring (løfte 3). To separate felter,
  fordi kolonnen er to felter: slått sammen blir «ukjent kind» og «korrupt
  config» det samme.
- **…men navnefeltene løftes ut av configen på vei ut** (R4,
  `commands/transfer.rs::without_names`): `lastDrawn`/`lastDrawnMany` for
  navnetrekkeren og `lastResult` for gruppegeneratoren. Kirurgi på JSON-en —
  parse til `Value`, fjern nøyaktig de nøklene, la ALT annet stå ordrett,
  inkludert felter en nyere versjon har skrevet. Ikke en rundtur gjennom
  `WidgetConfig`, som ville mistet nettopp de ukjente kortene. Kinds vi ikke
  kjenner røres ALDRI: vi vet ikke hvilke av deres felter som er navn, og å
  gjette på en ukjent form er akkurat det denne funksjonen nekter å gjøre med
  en kjent.
- **Fila inneholder ALDRI `absent_on` — og ikke dagens gruppedeling.** Det
  første er betalt strukturelt: `TransferClass::members` er `Vec<String>`, så
  kolonnen har ingen steder å reise. Det andre er kirurgien over, og den er
  minst like viktig: `lastResult` deles ut fra de TILSTEDEVÆRENDE (ADR-010),
  så en lagret gruppeliste er en oppteling av hvem som var i rommet den
  dagen — nøyaktig den fraværshistorikken ADR-010 og PRIVACY.md sier ikke
  finnes noe sted, på en minnepenn. Heller ikke `draw_state`,
  `date_override`/`agenda_item`/`day_note` (dato-nøklede — fjorårets fil ville
  importert agendaer på passerte datoer, og de to siste har ingen UNIQUE) og
  ikke `app_setting`.
- **Fildialogen er ren Rust.** `tauri-plugin-dialog` registreres i `lib.rs` og
  kalles bare fra `commands/transfer.rs`; all fil-I/O er `std::fs` i Rust.
  `capabilities/default.json` er URØRT — Tauris ACL styrer IPC FRA webviewet,
  og uten en `dialog:`-oppføring er pluginens tre kommandoer
  (`plugin:dialog|open`, `|save`, `|message`) NEKTET derfra. Presedensen er
  appens egen updater, som har gått i produksjon uten capability-oppføring av
  samme grunn. Ingen npm-pakke; CSP-en er urørt. Dialogtitlene sendes INN som
  argumenter, slik `class_ensure_active(default_name)` gjør: en setning
  læreren leser skal aldri være kompilert inn i backenden.

  Presisert i R4: formuleringen «webviewet ser aldri pluginen» var FEIL, selv
  om konklusjonen holder. `tauri_plugin_dialog::init()` injiserer et
  init-skript (`init-iife.js`) i hver side og BYTTER UT to globale:
  `window.alert` → `plugin:dialog|message` og `window.confirm` →
  `plugin:dialog|confirm`. Begge kall avvises — det første på ACL-en, det
  andre fordi `confirm` ikke engang er en registrert kommando — men
  utbyttingen er reell, og den har en felle verdt å skrive ned: den
  injiserte `window.confirm` er ASYNK. Den returnerer et Promise, og et
  Promise er alltid sant, så `if (confirm("…"))` ville tatt ja-grenen hver
  gang. Appen kaller ingen av dem (verifisert i `app/`), og det er DET —
  sammen med ACL-en — som holder sikkerhetsposituren, ikke at pluginen er
  usynlig.

## ADR-013 — Kvarantene er kun for BEVIST ødelagte filer, også når det koster oss (2026-08-31)

`should_quarantine` (`src-tauri/src/error.rs`) flytter databasefila til side
KUN ved primærkode `SQLITE_CORRUPT` (11) eller `SQLITE_NOTADB` (26), og de når
oss gjennom to dører: `Database` og `Migration(Execute(..))` — sqlx' egen
bokføring av `_sqlx_migrations`.

Den tredje døra, `Migration(ExecuteMigration(err, n))` — «mens migrasjon n
kjørte» — er BEVISST utelatt, også når feilen bærer en korrupsjonskode. Det er
VÅR SQL som feiler; retten til å døpe om en lærers klasselister skal ikke
følge av en bug hos oss.

Konsekvensen skal stå skrevet, for den er ikke gratis: er fila FAKTISK ødelagt
på en måte som først merkes mens en fremtidig migrasjon kjører, blir den aldri
satt i kvarantene. Appen booter degradert med `schemaUpdateStopped` hver
eneste gang, for alltid, til noen fjerner eller redder fila for hånd.
Symptomet er «Skjemaoppdateringen stoppet. Fila er urørt: …» som ikke går bort
av seg selv.

I dag er dette utelukkende teoretisk: siste migrasjon er 0005, en fersk
installasjon kjører alle på en tom fil, og en eksisterende installasjon har
ingen ventende migrasjon å snuble i. Første gang vi legger til 0006 blir det
en reell mulighet. Da er avveiningen fortsatt den samme — permanent degradert
boot med en forklaring på skjermen er bedre enn en automatisk omdøping som
kan ha vært vår egen feil — men den skal tas med åpne øyne, og
utrullingssjekken av 0006 bør inkludere hva en ekte korrupt fil gjør.

## ADR-014 — Appen oppdaterer seg selv: last ned ved oppstart, installer ved LUKKING (2026-08-31)

Oppstartssjekken har funnet oppdateringer siden v0.1 og etterlatt et merke
ingen nødvendigvis har handlet på. Fra nå henter den dem også — men
installasjonen legges til det ene øyeblikket i en skoledag hvor en omstart
ikke koster noe: når læreren lukker appen.

**Hvorfor ikke bare `download_and_install()`.** Pluginens
`Update::download_and_install` laster ned OG installerer i ett kall, og på
Windows ender `install_inner` i `std::process::exit(0)`
(`tauri-plugin-updater-2.10.1/src/updater.rs:786–863`). En bakgrunnsjobb som
kaller den ville drept appen midt i en time, uten et ord. Derfor er
`download()` og `install()` holdt fra hverandre: nedlastingen (som også gjør
minisign-verifiseringen, l. 707) skjer i bakgrunnen, byte-ene ligger i minnet i
`update::Staged`, og `install()` kalles først på vei ut.

**Kroken er `RunEvent::Exit`, ikke `ExitRequested`.** Dette er rundens
viktigste funn, og det er en skjøtefeil av samme familie som SundayRec sin:
`ExitRequested` sendes fra nøyaktig to steder i `tauri-runtime-wry-2.11.4`
— `TaoWindowEvent::Destroyed` når vinduskartet blir tomt (l. 4316) og
`Message::RequestExit`, altså `app.exit()`/`app.restart()` (l. 4356). macOS
Cmd+Q treffer INGEN av dem: `NSApp terminate:` går rett i
`applicationWillTerminate` (`tao-0.35.3/.../macos/app_delegate.rs:131`) →
`AppState::exit()` → `Event::LoopDestroyed` → `RunEvent::Exit`. Ikke ett vindu
blir noensinne `Destroyed`. `Exit` dekker BEGGE veiene, fyrer nøyaktig én
gang, og kjører rett før `cleanup_before_exit()`
(`tauri-2.11.5/src/app.rs:1430`). Det koster omleggingen
`.run(generate_context!())` → `.build(...)?.run(closure)` i `lib.rs` — som er
det samme kallet: `Builder::run` ER `build(ctx)?.run(|_, _| {})` (app.rs:2449).

**Installasjonen har et 30 s-tak, og taket er ikke pyntet.** macOS-installeren
faller tilbake på admin-passord via AppleScript når `rename` gir
`PermissionDenied` (en `.app` IT har lagt i `/Applications` for en
standardbruker). Den veien gjør `(self.run_on_main_thread)(...)` +
`rx.recv().unwrap()` (updater.rs l. 1281–1290). `run_on_main_thread` poster
til event-loopen — som under `RunEvent::Exit` alt er destruert. Closuren
kjører aldri og mottaket returnerer aldri: **en app som nekter å lukke**.
Derfor kjøres installasjonen på en arbeidstråd og ventes på med
`recv_timeout(30 s)`; timeout er `warn` + normal avslutning. Ingenting er
halvgjort da — AppleScript-grenen nås kun ETTER at `rename` feilet, altså før
noe er flyttet.

**Windows kommer tilbake én gang, og det er med vilje ikke fjernet.**
`tauri.conf.json` setter ingen `plugins.updater.windows.installMode`, så
default er `passive` → NSIS-flaggene `/P /R`, og `/R` er Restart
(`.../src/config.rs:36–44`). Appen relanseres altså av installeren etter en
stille oppdatering. Eneste modus uten `/R` er `basicUi`, som gir full
installer-GUI med klikk — verre for en lærer som nettopp lukket appen. Vi
dokumenterer oppførselen (NEEDS-RICHARD) og rører ikke `tauri.conf.json`.

**Default PÅ.** En klasseromsmaskin ingen administrerer er tryggere oppdatert
enn låst til det som lå på den da den ble satt opp. Avkryssingen står i
Oppsett-panelet; skrus den av, oppfører merket, den manuelle sjekken og den
manuelle installasjonen seg nøyaktig som før.

**Feil koster kun automatikken.** Slår nedlastingen feil, blir det en `warn`
— postkassa beholder `Available`, og merket + «Oppdater og start på nytt»
virker som de alltid har gjort. Lukkes appen midt i en nedlasting, hoppes
installasjonen over (`StagePhase::Downloading` ⇒ nei): ubekreftede byte
installeres aldri.

**`update_install` tømmer slissen.** Den manuelle knappen tar de staged
byte-ene via `try_state` (ALDRI `State<'_, Staged>` som argument — samme felle
`channel_for` dokumenterer: `databaseTooNew` er nettopp feilen denne knappen
skal kurere). At det er et TAK og ikke en lesing er det som gjør «manuelt
installert» og «installert ved lukking» gjensidig utelukkende: `app.restart()`
utløser `RunEvent::Exit` den også.
