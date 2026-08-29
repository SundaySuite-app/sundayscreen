# Revisjon R3 — «Bakerste pult» (2026-08-30)

> Kvalitetsrunde på v0.2.0-beta.1, bestilt som: _«gjør ting enda bedre, sjekk
> design, funksjonalitet og generell bruk»._ Ingen ny modell, ingen nye
> tabeller utover én kolonne — dette er runden der appen begynner å holde det
> den allerede lover.

## Hvordan funnene ble til

Seks uavhengige granskere leste hver sin dimensjon (typografi og lesbarhet,
farge og kontrast, widget-ergonomi, første møte, flate og vindu, klasserommets
hverdag). Hvert forslag ble deretter sendt til en egen agent med ett oppdrag:
**motbevis det**. 85 forslag gikk inn, **62 overlevde**, 23 ble forkastet —
flere av dem fordi premisset var feil, ikke fordi funnet var lite.

Verifiseringen var ikke pynt. Den fanget blant annet:

- Et forslag om at terningen «krymper uansett hvor stor boksen er» hadde
  **riktig retning, men feil tall** — terningen tegnet seg 24,5 px, ikke 81,6.
  Funnet ble viktigere, ikke mindre.
- Tre forslag var **allerede gjennomført** kvelden før og ble strøket.
- Et forslag om at «håndtaket er den ene veien tilbake» ble avvist fordi to
  andre veier faktisk finnes i koden.

Syntesen ligger i sesjonsloggen; denne fila er hva som ble bygget.

## Hva som ble gjort

### Spor 1 — det klassen faktisk ser

Diagnosen i én setning: tallene var tunet på en 27-tommer i et mørkt kontor,
og appen er en projektor i et lyst rom lest fra åtte meter.

| Funn                                     | Før       | Etter            |
| ---------------------------------------- | --------- | ---------------- |
| Dempet tekst (`--ink-3`, 38 brukssteder) | 3,21:1    | 4,64:1           |
| Statusfarger `--good` / `--bad`          | 3,4 / 4,3 | 6,1 / 6,1        |
| «Angre» — appens eneste angremulighet    | 1,83:1    | gullpille, 9,0:1 |
| Tekstwidgeten på standardkort            | 19 px     | 47 px            |
| Terningen, én terning                    | 22 px     | 120 px           |
| Trafikklysets SLUKKEDE lampe mot huset   | 10,1:1    | 1,7:1            |
| Trafikklysets TENTE røde lampe           | 3,7:1     | 4,4:1            |

De to siste linjene er det verste enkeltfunnet i sporet: **den slukkede lampen
var husets lyseste flate.** Signalet var invertert — på åtte meters avstand
leste et trafikklys på rødt som et trafikklys der noe annet lyste.

Klokka med sekunder fikk **aldri** plass i noen størrelse (103 % av kortets
kortside) og ble klippet symmetrisk i begge ender. Capen går nå mot bredden,
og brede kort er helt uendret.

Ny vakt: en vitest parser `tokens.css`, regner WCAG-luminans og krever 4,5:1.
Den er mutasjonstestet — settes en gammel farge tilbake, faller den.

### Spor 2 — widgetene får knappene appen allerede lover

`WidgetShell` definerer en avtale: hold musa over en widget, og oppsettet
dukker opp nederst. Tre widgets brøt den, hver på sin måte.

- **Tekstwidgeten** hadde to persisterte felt (`align`, `fontScale`) og fire
  ferdige CSS-regler som ingen knapp noensinne nådde. Nå har den en rad — og
  den virker MENS man skriver, fordi hver knapp avbryter sin egen mousedown og
  lar textarea-en beholde fokus.
- **Tidtakeren:** «dere får 20 minutter» var femten klikk foran en ventende
  klasse. Nå er det ett. «To minutter til» var umulig uten å nullstille
  nedtellingen; nå er det én knapp, og fargen slutter av seg selv å lyve om at
  det haster.
- **Gruppegeneratoren** la fem kontroller PERMANENT på tavla. Elevene så dem
  hele timen. De ligger nå i hover-raden; «Del inn» blir stående.
- **Listene:** slett-knappen brukte `display: none`, så en åtte-punkts
  sjekkliste RYKKET linje for linje når musa passerte den, foran klassen.

### Spor 3 — klassen er dataene

- **8As navn sto på tavla foran 9B.** Bytter man klasse, blir et trukket navn
  og en gruppeinndeling stående til noe overskriver dem. Vakten er
  ikke-destruktiv: bytt tilbake, og gruppene er der igjen.
- **Fravær** (migrasjon 0005, ADR-010). Dagens eneste utvei var å slette
  navnet og lime det inn igjen — som slipper elevens id og nullstiller hennes
  trekkerunde. Nå: ett klikk per elev, trekker og gruppedeler hopper over
  henne, og tavla sier ærlig «24 av 27 til stede» — men bare når noen faktisk
  er markert borte. Null piksler på en vanlig dag.
- **«Legg inn navn i klassen først»** var en blindvei. Nå er den en dør.

### Spor 4 — første kveld med appen

- Etter splash møtte læreren et **tomt, ordløst rektangel**, og fire sekunder
  senere gled den eneste veien videre ut av bildet. Kromet holdes nå åpent så
  lenge tavla er tom — også når siste widget slettes midt i timen.
- **Planleggeren bodde bak et navnløst ikon.** Den har fått navnet sitt på
  verktøylinja. (Det kostet 86 px og brakk faktisk linja til to rader på
  1024×768 — skjerm- og klassenavn kappes nå med ellipse.)
- **Skjermbiblioteket forkastet stille det læreren skrev:** begge
  navnefeltene nullstilte draften ved `onBlur`. Nå er veiene Enter eller hake
  for å lagre, Escape for å avbryte. Samme feil i klasse-omdøpingen er rettet.
- **Slett-bekreftelsen** rendret nøyaktig der blyantknappen sto, så et
  dobbeltklikk på «endre navn» kunne slette hele skjermen. Nå må 400 ms gå.
- **Fokusring:** det fantes ingen `:focus-visible`-regel i hele `app/`.

### Spor 5 — flata og vinduet

- **Skjermkanten vinner nå over minstemålet.** Dette var det eneste funnet i
  hele revisjonen som brøt et produktløfte STILLE: en widget som et
  oppløsningsbytte hadde etterlatt smalere enn sitt minimum, spratt ut over
  kanten ved første piksel av en skalering, ble klippet — og hadde flyttet seg
  ~200 px ved neste oppstart.
- **Vinduet åpner aldri større enn skjermen.** På en 1024×768-rigg stakk ~100
  px under kanten, med verktøylinja og avsløringssonen i det usynlige. Appen
  var ubrukelig uten en eneste synlig vei ut.
- **Fullskjerm-flagget måles.** Sto appen i fullskjerm på projektoren og
  laptopen ble tatt med hjem, hoppet gjenopprettingen over både geometrien og
  fullskjermen — mens frontenden trodde den var i fullskjerm og derfor ikke
  lagret vindusposisjon på hele økten.
- **Dupliser widget**, snapping ved skalering, angre som rekker 15 sekunder og
  svarer på ⌘Z, og standardstørrelser som skalerer med flata (ADR-011).

### Rotårsaker funnet underveis (ikke i den opprinnelige lista)

To feil ble oppdaget av flere agenter uavhengig, begge med samme form:
**en absolutt- eller fast-posisjonert boks som måler mot feil ramme.**

1. **Halvbredde-fella.** `[data-settings-row]` er `left: 50%` uten `right`, så
   den la ut i HALVE kortet uansett hva `max-width` sa. Målt: en rad på 197 px
   i et kort på 394 px. Med fem knapper brøt raden mellom sifrene i
   tidtakeren, og andre linje dekket «Start». Tre agenter lappet hver sin
   widget; fiksen ligger nå i skallet der alle arver den. Samme felle som
   verktøylinja måtte fikse én runde tidligere (`5b06911`).
2. **Transform-fella.** Verktøylinja sentrerte seg med `transform:
translateX(-50%)` — og et element med transform blir containing block for
   alle `position: fixed`-etterkommere. Klassemenyens backdrop var derfor målt
   784×52 px i stedet for hele skjermen: **et klikk utenfor menyen lukket den
   aldri.** Det blokkerte også fraværspanelet fra å bli et ekte modalt panel.

## Bevisst ikke gjort

- **Flertrekk i navnetrekkeren.** Reell, men konkurrerer med fravær om nøyaktig
  samme budsjett (migrasjon, kommando, bindings, config-toleranse), og «klikk
  to ganger» virker i mellomtiden.
- **«Vis stort» / fokusmodus.** Sterkeste kandidat til neste runde. Krever et
  nytt innerste Escape-lag og en vakt mot at fokus peker på en widget som ble
  auto-byttet vekk ved timestart.
- **Planlegger-ergonomi** (celle-utklippstavle, «kopier fra forrige gang»,
  hele dagen fri). Sparer minutter én til to ganger i året. «Hele dagen fri»
  er dessuten dyrere enn den ser ut: en avlyst økt er i dag visuelt identisk
  med en tom celle, så den trenger et eget felt for å ikke lyve på tavla.
- **Gull-grammatikk** («fylt gull = handling, tonet gull = tilstand»). Reell
  tvetydighet, men den kolliderer med at «Legg til»-menyen ALLEREDE bruker
  fylt gull som «menyen er åpen». Det er en visuell grammatikk-endring på 17
  kontroller — egen runde, med eier.
- **Fysiske vinduskoordinater.** Se eierspørsmål under.
- **Mørkere `--bg`** for tydeligere kortkontrast. Ett tegn å endre, men den
  drar `--ink-3` under gulvet i planleggerpanelet og krever at panelet flyttes
  til `--surface` i samme grep. Eiervalg.

## 👤 Eierspørsmål (smak, ikke teknikk)

1. **Projektor-typografien.** Standardkortene vokser: agenda 460×520, frist
   420×300, dagen i dag 520×420. På en 1024×768-projektor blir agendakortet
   45 % × 68 % av flata. Riktig for «hva skjer nå» — men se det på rigg.
   **Målt bivirkning:** på 1280×800 finner allerede det TREDJE kortet (tekst +
   navnetrekker + sjekkliste) ingen ledig plass og legger seg oppå det forrige.
   Det er ærlig oppførsel — men det er raskere fullt enn før.
2. **`--bg` fra `#f6f3ec` til `#eae5d8`?** Widgetkortene skiller seg i dag fra
   tavla nesten utelukkende med en 10 %-skygge, og en projektor i et lyst rom
   gjengir den ikke.
3. **Standardstørrelser som skalerer (ADR-011).** På 1080p blir kortene 1,35×
   større, og ~4–5 får plass før kaskaden i stedet for ~6–7. Har du
   rutinemessig seks widgets oppe samtidig, er grepet feil for deg.
4. **Tidtakeren mistet en evne:** ± flyttet fra den permanente kontrollraden
   til hover-raden, så en idle nedtelling settes nå fra fem faste valg
   (1 · 5 · 10 · 15 · 20). Sju minutter betyr start-så-juster. Bevisst — den
   permanente raden står foran klassen — men det er et tap.
5. **Vil du ha gull-grammatikk-runden som eget arbeid senere?**
6. **Kjører du noen gang Windows-rigg med 150 % laptop og 100 % projektor?**
   Hvis nei, faller fysiske vinduskoordinater ut permanent.

## 👤 Riggtest-punkter for denne runden

1. **Trafikklyset, åtte meter, mys.** Rødt skal være det lyseste i huset.
   Dette er rundens største visuelle omveltning og det eneste som ikke lar seg
   verifisere fra en stol.
2. **Åpne appen på en 1024×768-projektor.** Hele vinduet skal være innenfor
   skjermen, med verktøylinja synlig.
3. **Fravær en ekte morgen:** marker de som er borte, trekk navn hele timen,
   sjekk at tellelinja stemmer og at ingen fraværende dukker opp.
4. **Fullskjerm på projektor → ta laptopen hjem → åpne appen.** Den skal
   fortsatt være i fullskjerm, og vindusposisjon skal lagres når du går ut.
5. **Tekstwidgeten på projektor:** er 47 px riktig fra bakerste pult, eller
   skal standarden opp igjen?
6. **Klasse- og skjermnavn:** de kappes nå med ellipse på verktøylinja. Er
   18 tegn nok til å skille dine klasser fra hverandre?
