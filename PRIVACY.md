# Personvern i SundayScreen

Kort versjon: **alt bor på din maskin.**

- Klasselister (elevnavn), skjermoppsett og innstillinger lagres KUN lokalt,
  i en SQLite-fil under appens datamappe på maskinen. Appen flytter dem aldri
  selv; det eneste unntaket er «Flytt oppsettet», som DU starter — se
  punktet om eksport under.
- Samme datamappe inneholder også automatiske sikkerhetskopier
  (`sundayscreen.backup-1.sqlite`, `-2`, `-3` — de tre siste vellykkede
  oppstartene) og, om en database noensinne har blitt funnet ødelagt og
  gjenskapt, de gamle filene under et `.corrupt-<tidsstempel>`-navn. Dette
  er fortsatt bare filer på DIN maskin — ingen av dem sendes noe sted. Vær
  klar over én ting: en sikkerhetskopi er et fullstendig øyeblikksbilde av
  databasen slik den så ut da appen startet, og den inneholder derfor også
  fraværsmarkeringene som sto den dagen. Løftet under om at det aldri bygges
  opp fraværshistorikk gjelder databasen appen leser og skriver; kopiene er
  øyeblikksbilder med kort levetid — tre generasjoner, så er den eldste
  borte.
- **Bilder du legger på en skjerm er persondata, og de er den tyngste sorten
  appen håndterer.** Et klassebilde er ansikter av mindreårige — kvalitativt
  noe annet enn en navneliste. Slik behandles de:
  - Bildet kopieres til appens egen datamappe (`images/` ved siden av
    databasen) når du velger det. Originalen din røres ikke, og appen leser
    aldri noe annet sted på maskinen.
  - Skjermoppsettet lagrer bare et tilfeldig id-nummer, aldri selve bildet og
    aldri filstien din. Id-en sier ingenting om hvem eller hva bildet viser.
  - **Bildene ligger I eksportfila.** «Flytt oppsettet» tar dem med, slik at
    skjermene dine kommer hele over på den andre maskinen. Det betyr at fila
    er tyngre enn en navneliste: den inneholder både elevnavn i klartekst OG
    bilder. Behandle den deretter — samme sted som klasselistene dine, ikke
    løsere. Kvitteringen etter eksport sier hvor mange bilder som ble med.
  - Fila har et tak (32 bilder, ca. 20 MB til sammen). Har tavla flere,
    skrives fila likevel, og kvitteringen sier hvor mange som ikke fikk plass
    — de må legges inn på nytt på den andre maskinen.
  - **Fjerner du et bilde fra en skjerm, ligger fila på disken til neste gang
    appen startes.** Da rydder appen bort bildefiler ingen skjerm peker på.
    Dette er en ærlig kostnad ved måten opprydningen er bygd: den kjører ett
    sted, ved oppstart, der den kan bevise at ingen bruker fila — i stedet
    for å slette midt i en time og ta et bilde en annen skjerm fortsatt
    bruker. Haster det, kan du slette fila selv fra `images/`-mappa.
- Merker du en elev som borte, husker appen kun DAGENS dato på den eleven, og
  overskriver den neste gang. Det bygges aldri opp en fraværshistorikk — appen
  vet hvem som er her akkurat i dag, og ingenting om i går. Fraværsføring hører
  hjemme i skolens eget system.
- **Eksport skjer bare når du selv ber om det.** Under «Klasser og navn» kan
  du lagre hele oppsettet ditt til én fil for å flytte det til en annen
  maskin. Fila lages først når du har trykket på knappen OG valgt hvor den
  skal ligge — appen sender den ingen steder, og det finnes ingen automatisk
  eller planlagt eksport. Fila inneholder **elevnavnene i klartekst** og
  **bildene du har lagt på skjermene** (se punktet over), så den hører hjemme
  samme sted som resten av klasselistene dine. Den inneholder
  ALDRI fraværsmarkeringer (se punktet over), og heller ikke dagens
  trekningsrunde, dagens gruppedeling, agendaer eller dagsnotater —
  navnetrekkerens og gruppegeneratorens siste resultat fjernes fra fila når
  den skrives. Gruppedelingen er nevnt for seg fordi den er den mest
  følsomme av dem: den deles alltid ut fra de som er TIL STEDE, så en lagret
  gruppeliste er i praksis en oppteling av hvem som var i rommet den dagen.
- Appen sender ingen telemetri, ingen analyser, ingen krasjrapporter.
- Det eneste nettkallet appen noensinne gjør, er å spørre
  `updates.sundaysuite.app` om det finnes en ny versjon. Kallet inneholder
  ingen persondata, og uten nett feiler det stille — appen fungerer helt
  likt.
- Ingen konto, ingen innlogging, ingen sky.

Sletter du appens datamappe, er alt borte — bortsett fra eksportfiler du selv
har lagret et annet sted. Det finnes ingen kopi hos oss.
