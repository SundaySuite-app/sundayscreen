# Gransking — Runde 2 «Lærerens dag» (2026-08-29)

Tre fiendtlige granskere over hele runden (commits `f76a3d3..8158f11`), én
per domene: backend/datasømmer, frontend-state/UX, og
kvalitetsinfrastruktur (i18n/a11y/CSS/testærlighet).

**55 funn totalt. 23 fikset i denne runden, 32 vurdert og dokumentert
nedenfor.** Ingen av de fiksede kunne vært funnet av gatene: samtlige
levde i skjøtene mellom to lag som hver for seg var korrekte —
[[reference-seam-bugs]]-formen, igjen.

## Fikset

### De fire som ville rammet en ekte skoledag

| #     | Funn                                           | Hva som skjedde                                                                                                                                                                                                                                                                                                                                                                                                      | Fiks                                                                                                                                                     |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1/C1 | **Planleggeren var død i helgene**             | `valid_weekday` godtok bare 1–5, men frontend sender ISO-ukedag. Lørdag/søndag → `planner_day_get` avviste → `plannerHydrated=false` → **alle tre faner** erstattet av «redigering er sperret», med en «Prøv igjen» som aldri kunne lykkes før mandag. Verst tenkelige treffpunkt: søndag kveld er når timeplanlegging faktisk skjer. Kunne også låse seg midt i uka (naviger til lørdag, lukk panelet, åpne igjen). | LESING godtar hele uka (helgen har bare ingen ukeplan-rader); SKRIVING til ukeplanen er fortsatt mandag–fredag, siden rutenettet ikke har helgekolonner. |
| F2/B2 | **Utkast fulgte med til feil dato**            | `DayLesson`/`NotesEditor` var nøklet på økt-id alene, så Preact gjenbrukte komponentene ved datobytte mens `props.date` endret seg. En ubemerket beskjed skrevet på mandag ble lagret på tirsdag — med grønn «Lagret»-kvittering. Med beholdte id-er ble det i stedet en kryptisk PK-kollisjon uten vei ut.                                                                                                          | Nøklene bærer datoen.                                                                                                                                    |
| F1    | **Ukeplan-editoren skrev forrige celles time** | `CellEditor` initialiserte feltene ved mount; klikk på en annen celle byttet props, ikke tilstand. Klikk mandag (7B/Norsk) → klikk tom tirsdagscelle → «Lagre» kopierte Norsk dit.                                                                                                                                                                                                                                   | `key` per celle.                                                                                                                                         |
| B3/B4 | **Auto-byttet slåss mot læreren**              | Fyr-én-gang-nøkkelen ble bare «brukt opp» når et bytte faktisk skjedde. Sto skjermen alt riktig ved timestart (det vanlige), forble nøkkelen ubrukt — og når læreren så byttet til noe annet midt i timen, dro automatikken tavla tilbake innen 30 sekunder. Restart midt i timen kunne dessuten overstyre den eksakt gjenopprettede skjermen.                                                                       | Nøkkelen brukes opp for hver time vi er inne i, uansett hva som vises; timer som alt pågikk ved oppstart overlates til banneret.                         |

### Datamodell og backend

- **B8** `valid_date` godtok `2026-99-99` (kun form sjekket) → rader i en
  nøkkel ingen kalenderdag når. Nå ekte månedslengder, skuddår inkludert.
- **C11/B12** Harnesset speilet ikke backendens kaskader og klemminger
  (klassesletting rørte ikke ukeplan/avvik, ingen tak på agenda/beskjeder,
  ingen navnekrav på skjermer) — nettopp gapet som gjemte helge-låsen. Nå
  speiles alle fire.
- **B7/F9** «Lagre som ny skjerm» kopierte LAGREDE rader før ventende
  skrivinger landet → siste tastetrykk manglet i kopien. Nå flushes først.
- **B10/C21** Konvensjonen `default-<klasseid>` sto tre steder. Nå én
  kilde (`app/lib/scene-ids.ts`) med test som pinner formen.

### Ærlighet på tavla

- **F13** En feilet dag-lesing viste «ingen timer i dag» — umulig å skille
  fra en ekte fri dag. Nå sier widgetene «Fikk ikke lest planen».
- **F10/C-silent** Frontend lot deg legge til flere punkter og lengre
  tekster enn backend beholder → linjer forsvant ved restart (brudd på
  løftet «restart gjenoppretter eksakt»). Nå håndheves samme tak ved
  inntasting.
- **F3** Tom økt-etikett droppet raden stille, og replace-all slettet
  økta med hele uka si. Nå en feilmelding.
- **F12/B5** «Rediger avvik» åpnet blankt og visket feltene du ikke skrev
  på nytt. Nå forhåndsutfylt fra avviket som står der.
- **F11** Avhaking i widgeten oppdaterte bare tavla; panelet lå igjen med
  gammel tilstand og skrev avhakingen bort ved neste lagring.
- **C5** «+ 0 timer», «0 dager igjen» og «0 timer igjen» (mens 59 minutter
  gjensto). Siste time sier nå «Under én time igjen».
- **F14** Nytt skjermnavn viste seg ikke i verktøylinja før neste bytte.

### Flater og tilgjengelighet

- **F7/C3** Feil-chipen og timebanneret var forankret piksel-identisk
  øverst — chipen la seg oppå banneret akkurat når begge betydde noe. Nå
  én felles kolonne.
- **C2** Begge datopilene pekte samme vei (et fikseforsøk hadde duplisert
  vinkelen i stedet for å snu den).
- **C4** Rå ISO-dato «2026-08-31» vist til læreren. Nå «mandag 31.
  august», med nøkkelen i et data-attributt for testene.
- **C8** `aria-label` på agenda-radene skjulte selve aktivitetsteksten for
  skjermlesere (WCAG 2.5.3).
- **C10/F16** Tastaturbruk holdt ikke verktøylinja våken (den gled ut
  under en som tabbet), og hover-avslørte kontroller hadde ingen
  tastatursti. Nå `chromeActivity()` på tastetrykk + `:focus-within`.
- **C17** Escape på en avkrysningsboks ble spist av tekstfelt-grenen.
- **F21** Ukeplan-fragmentene manglet nøkkel.
- **Nytt under granskingen:** banner-knappen og skjermvelgeren het begge
  «Bytt skjerm». Banneret heter nå «Bytt til timen».

## Vurdert, ikke fikset

Med begrunnelse — dette er ikke en restanseliste, men bevisste valg.

| Funn                                                                                 | Vurdering                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B11 Ubegrenset vekst i `agenda_item`/`day_note`/`date_override`                      | ~5 timer/dag gir megabytes over år. Ikke et problem i praksis; en oppryddingsregel er en eiersak (hva skal slettes, og når?), ikke en stille avgjørelse.                                         |
| B12 `planner_slot_set` godtar en annen klasses standardskjerm                        | Uoppnåelig fra UI-et (velgeren lister kun globale skjermer). Notert som API-herding.                                                                                                             |
| F5/F6 Helobjekt-`saveSettings` kan skrive gamle pekere                               | Backend serialiserer under lås; vinduet er millisekunder og krever samtidig auto-bytte. Riktig fiks er å fjerne pekerfeltene fra frontend-skrivinger — et bredere grep som fortjener egen runde. |
| F8 `deleteClass` av siste klasse: kort vindu der gamle widgets kan lagres i ny scene | Krever en asynkron widget-fullføring i akkurat det vinduet. Notert.                                                                                                                              |
| F15 Dobbeltklikk på slett-ikonet treffer bekreftelsen                                | Reell, men krever bevisst dobbeltklikk på et lite ikon; en klikk-sperre er kosmetikk vi kan ta senere.                                                                                           |
| F18 `selectDate` mangler sekvensvakt                                                 | Krever raskere klikking enn IPC-en svarer, og verste utfall er en dags forsinket visning.                                                                                                        |
| F20 Feilet auto-bytte prøver ikke på nytt                                            | Bevisst: alternativet er en 30-sekunders retry-hammer mot en feilende backend. Nå dokumentert.                                                                                                   |
| F22 Tastetrykk under et timebytte kan gå tapt                                        | Millisekundvindu; alternativet (blokkere inndata under bytte) er verre.                                                                                                                          |
| C7/C9 `role="menu"` uten piltast-navigasjon; ujevn `aria-pressed`                    | Ærlig alvorlighet for en pekerstyrt projektorapp: lav. Fortjener en samlet a11y-runde, ikke halve grep nå.                                                                                       |
| C12 Tre like kalenderikoner                                                          | Reell forvekslingsfare ved 20 px. Ikonjustering er designarbeid — tas med eier.                                                                                                                  |
| C13/C14 «rotate»-pilhode og hånd-glyfen                                              | Koordinatmistanker fra en granskere uten skjerm. Jeg har sett begge i nettleseren: de leser riktig.                                                                                              |
| C15/C16 Testhull (koordinatsimulator, svakere assertions enn titlene)                | Notert; de nye funn-testene dekker det som faktisk gikk galt.                                                                                                                                    |
| C19/C20 36px uten token, cqmin-gulv ved minstestørrelser                             | Hygiene. Verdt en opprydding, ikke en beta-blokker.                                                                                                                                              |

## Riggtest-punkter (👤 eier)

Nye siden v0.1 — ting bare en ekte skoledag avslører:

1. **Åpne planleggeren på en lørdag eller søndag.** (Regresjonsvakten for
   det verste funnet; e2e dekker det nå, men bekreft mot ekte database.)
2. Legg inn skolens ekte timeoppsett og en full uke; sjekk at
   klokkeslettene stemmer med skoleklokka.
3. Planlegg en dag i forkant, og gjennomfør den dagen etterpå: banner ved
   timestart → ett klikk → riktig klasse og skjerm.
4. Slå på auto-bytte en hel dag. Bytt bevisst skjerm midt i en time og se
   at automatikken lar deg være.
5. Lag en skjerm i én klasse, bruk den i en annen; kontroller at
   navnetrekkeren følger den aktive klassen.
6. «Dagens time» gjennom en hel time: følger nå-markøren, og virker
   pinning når timen skifter tempo?
