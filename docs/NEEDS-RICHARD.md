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

- [ ] **Riggtest Runde 3 (nyest):** seks punkter i docs/REVISJON-R3.md
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
