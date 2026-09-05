# Trenger Richard (eierhandlinger)

> Ting bare eieren kan gjøre. Oppdateres per fase.

## Signering (når som helst — neste tag plukker det opp)

- [x] `TAURI_SIGNING_PRIVATE_KEY` — satt som repo-secret 08-27 (innholdet av
      `~/.tauri/sundayscreen_updater.key`; nøkkelen er passordløs, og
      workflowen setter BEVISST ingen `…_PASSWORD`-env — tom ≠ fraværende).
- [ ] `MAC_CERTS` + `MAC_CERTS_PASSWORD` (samme eksport som de andre appene).
      Til de finnes er macOS-bygget ad-hoc-signert — «høyreklikk → Åpne»
      virker IKKE lenger på macOS 15; riktig rekkefølge (prøv å åpne først,
      så Systeminnstillinger → Personvern og sikkerhet → «Åpne likevel») står
      i docs/DISTRIBUTION.md.
- [ ] Apple-avtalen (PLA) er fortsatt ikke akseptert for team 784GN847G4 →
      notarisering forblir av til den er det (samme som Rec/Stage/Edit);
      linjene står klare i release.yml.
- [ ] Windows Authenticode-sertifikat (~200–400 USD/år — eierbeslutning,
      ingen tidsfrist). `.exe.sig` som ligger ved hver utgivelse er
      updater-signaturen (minisign, verifisert av appen selv før install) —
      IKKE Authenticode. De to er uavhengige: uten et ekte
      Authenticode-sertifikat viser Windows SmartScreen «Ukjent utgiver»
      permanent, uansett hvor mange ganger appen installeres.

## Før v1.0 (F10)

**v0.1.0-beta.1 er ute (08-27):** publisert på GitHub og promotert til
beta-ringen (renummerert fra v0.9.0-beta.1 — ADR-008). Nedlasting:
<https://github.com/SundaySuite-app/sundayscreen/releases/tag/v0.1.0-beta.1>

⚠️ Installerte du 0.9.0-beta.1 i mellomtiden: avinstallér og installér
0.1.0-beta.1 manuelt — updateren tilbyr aldri et lavere versjonsnummer (det
gjelder enhver nedgradering, ikke bare denne). Siden R4 er den manuelle
reinstallasjonen TRYGG: en versjonskonflikt rører aldri databasen lenger,
appen forklarer seg selv på skjermen i stedet for å boote tomt, og en
sikkerhetskopi finnes uansett — se docs/ROLLBACK.md.

- [ ] **Riggtest Runde 6 «Skjermen er planen» (nyest):** fem punkter. De
      fire første er ting ingen test kan se etter — de handler om et rom, en
      telefonavstand og et ekte friminutt.

  1. **Design en skjerm i planleggeren PÅ PROJEKTORMASKINEN, midt i en
     time.** Åpne planleggeren, klikk «Design skjermen» på en time, legg til
     et par verktøy og trykk «Ferdig». Det du skal se etter er hva klassen
     ser: **blinker tavla bak?** Den skal ikke det — skjermen du designer
     står inne i panelet, og tavla bak er urørt hele veien, også når du
     lukker panelet. Ser du så mye som ett glimt av den nye skjermen på
     veggen, si fra: det er rundens viktigste løfte.
  2. **Skann QR-koden fra bakerste pult.** Legg til en lenke-widget med en
     ekte adresse, la QR-koden stå på, og be en elev bakerst prøve å skanne
     den med telefonen — også litt på skrå. Geometrien er bevist (koden er
     lest tilbake av en uavhengig dekoder), men om den er STOR nok på DIN
     projektor fra DIN bakerste pult er et øye-spørsmål. Blir det for smått,
     kan kortet gjøres større eller adressen kortes ned.
  3. **Kjør en ekte dobbelttime, gjennom friminuttet.** Kryss av «Slå sammen
     med neste time» på en ekte dobbelttime i ukeplanen. Sjekk så to ting
     NÅR friminuttet er over: sier «Dagens time» fortsatt riktig fag med
     hele blokka som klokkeslett, og står tidtakerens «resten av
     timen»-pille der og peker på slutten av ANDRE halvdel? Begge skal
     holde tvers gjennom pausen.
  4. **Legg inn et ekte klassebilde, og flytt oppsettet.** Bruk et vanlig
     bilde fra telefonen eller kameraet (ikke et lite testbilde) i en
     bilde-widget, og kjør deretter «Flytt oppsettet» → «Eksporter oppsett
     …» til en annen maskin. **Fila inneholder nå bildene** — kjenn på hvor
     stor den blir, og på om det føles greit å sende den. Dette var ditt
     valg mot rådet mitt (ADR-018), så inntrykket ditt her er det som
     avgjør om det står.
  5. **Se skjermfargene på projektoren.** Bytt bakgrunn i «Bytt skjerm» →
     «Skjermfarge» og se særlig på **Tavle** (mørk bakgrunn med hvite
     kort): er kortene lesbare fra bakerst, eller blir kontrasten for hard i
     et lyst klasserom? De fire andre (Standard, Papir, Varm, Kjølig) er
     lyse og mindre risikable.

- [ ] **Riggtest Runde 5 «Terningen i rommet»:** fire punkter, alle
      på ekte projektor. Terningen er nå en ekte 3D-modell — og det er
      nøyaktig det ingen test kan se etter.

  1. **Snurr en D20 foran klassen.** Dra på terningen med musa eller
     styreflaten og la elevene lese fjesene rundt: går det an å SE hele
     tallrommet 1–20, eller blir tallene for skrå til å leses før de
     forsvinner rundt kanten? Terningen blir stående der du slapp den — det
     er med vilje. Veien tilbake til svaret er å kaste på nytt.
  2. **Tell prikkene på en D6 fra tre meter,** i alle fem materialene
     (elfenben, kasino, tre, metall, glass — bytt i «Utseende»-panelet, som
     åpnes med knappen som viser «D6»). Prøv gjerne to–tre av de seks
     fargene også. Er det ett materiale der prikkene forsvinner, er det
     materialet som er feil, ikke øynene dine.
  3. **«Vis stort» + snurr på en 1024×768-projektor.** Forstørr
     terningkortet og snurr. Føles det jevnt (60 bilder i sekundet), eller
     hakker det? Den gamle maskinen er den som teller her, ikke Mac-en.
  4. **4-4-4-spørsmålet.** Legg til tre terninger og kast til de lander likt.
     De blir da PIKSELIDENTISKE — samme tall, samme vinkel, samme skygge.
     Det er bevisst (samme svar skal se likt ut), men det ser unektelig litt
     fabrikkert ut. **Skurrer det, si fra:** en liten tilfeldig vipp per
     terning er en linje kode, men den koster lesbarheten litt, så valget er
     ditt.
  5. **Spøkelsestallene på kanten (granskingens L4).** På en D20 kan svake,
     halvgjennomsiktige sifre skimtes på fjesene som er i ferd med å rulle
     rundt kanten — det er innfadingen som gjør at tall ikke POPPER inn under
     snurring. Geometrien er bevist i orden (tallene forlater aldri sitt
     fjes); spørsmålet er bare om det LESES som en flekk fra bakerste pult.
     Skurrer det, kan fade-båndet strammes.

- [ ] **Riggtest automatisk oppdatering (ADR-014):** med en oppdatering
      klar — lukk appen, både med krysset og med Cmd+Q (macOS), og se at NESTE
      oppstart er den nye versjonen. Panelet skal si «v… installeres når du
      lukker appen» så snart nedlastingen er ferdig; sier det fortsatt «v…
      klar», er den ikke lastet ned ennå, og da er det den manuelle knappen
      som gjelder. **På Windows starter appen seg selv opp igjen én gang etter
      installasjonen — det er forventet** (NSIS-installeren kjører med `/R`;
      eneste alternativ er full installer-GUI med klikk, se ADR-014). Prøv
      også å skru avkryssingen «Installer oppdateringer automatisk» av og på:
      av skal oppføre seg nøyaktig som før. ⚠️ **Maskiner som fikk
      v0.9.0-beta.1 ser aldri en 0.4 fra updateren** — den tilbyr aldri et
      lavere versjonsnummer, og det endrer seg ikke av at oppdateringen nå er
      automatisk. Installer 0.4 manuelt ÉN gang; deretter holder maskinen seg
      selv oppdatert.

- [ ] **Riggtest Runde 4:** fire punkter, ingen forutsetter en
      spesiell dag. Eksportér oppsettet fra én maskin («Klasser og navn» →
      «Eksporter oppsett …») og importér fila på en ANNEN maskin — se at
      klassene, skjermene og navnene faktisk kommer over, og at ukeplanen
      bare blir med når den andre maskinen ikke hadde en fra før. Bruk «Vis
      stort» på en widget mens en ekte prøve pågår. Trekk flere navn i ett
      trekk på en ekte klasseliste, ikke bare én og én. Og — nytt siden R4 —
      nedgraderingstesten (v0.4 → v0.3) er nå TRYGG å kjøre: se
      docs/ROLLBACK.md §4 — en versjonskonflikt rører aldri databasen, og
      appen forklarer seg selv på skjermen i stedet for å boote tomt.
- [ ] **Riggtest Runde 3:** seks punkter i docs/REVISJON-R3.md
      §Riggtest-punkter. Viktigst: **se trafikklyset fra åtte meter og mys** —
      slukkede lamper er nå mørke og rødt er det som lyser, motsatt av før.
      Deretter: åpne appen på en 1024×768-projektor (hele vinduet skal være
      innenfor skjermen), og bruk fravær en ekte morgen.
- [ ] **Seks smaksvalg venter på deg** — docs/REVISJON-R3.md §Eierspørsmål.
      Kortversjonen: er projektor-typografien for stor, skal tavlas
      bakgrunn bli mørkere, og er det greit at tidtakeren nå settes fra fem
      faste lengder i stedet for ±-knapper?
- [ ] **Riggtest Runde 2:** planleggerflyten en ekte skoledag — seks punkter
      i docs/GRANSKING-R2.md §Riggtest-punkter (start med å åpne
      planleggeren på en LØRDAG; det var rundens verste funn).
- [ ] **Riggtest i klasserom:** installer beta på klasseroms-maskinen, koble
      projektor (helst også en 4:3), bruk appen én hel undervisningstime
      (timer + navnetrekker + trafikklys). Noter alt som skurrer.
      Punktliste i docs/GRANSKING-v1.md §Riggtest.

## Valgfritt

- [ ] Mening om ikonet (F0-utkastet er et førsteutkast).
