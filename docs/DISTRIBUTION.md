# Distribusjon

## Kanaler og feed

Updateren poller `https://updates.sundaysuite.app/v1/update/sundayscreen/{stable|beta}`
(suite-Workeren `sunday-telemetry`; registrert der i fase F8, migrasjon 0010).
Kanalen er per maskin (`settings.updateChannel`, byttes i Administrer-panelet);
runtime bygger endepunktet per sjekk, så tauri.conf.json sin statiske URL er
bare default. 204 = ingenting promotert / ring pauset (kill-switch); klienten
er stille. Sjekken ved boot svelger ALLE feil — offline er normaltilstanden.

## Slik slippes en versjon

1. Bump versjon i **tre** filer (version-sync-gaten vokter): `package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Skriv `docs/release-notes/vX.Y.Z[-beta.N].md` — teksten læreren leser når
   appen tilbyr oppdateringen. Den blir `notes` i `latest.json`. CI avviser
   PR-en uten den, og release.yml avviser taggen. Se
   [release-notes/README.md](release-notes/README.md).
3. `git tag vX.Y.Z[-beta.N] && git push --tags` → release.yml bygger signert
   macOS (aarch64 DMG) + Windows (NSIS; stable-tags også MSI) og lager et
   **utkast** til GitHub-release med `latest.json`.
4. Publiser utkastet manuelt på GitHub.
5. **Beta-bygg** (`vX.Y.Z-beta.N`): `node scripts/promote-release.mjs beta v0.9.0-beta.1`.
   **Offisiell utgivelse** (rent `vX.Y.Z`-tagg): promoter til BEGGE ringer —
   `node scripts/promote-release.mjs stable v1.0.0` og deretter
   `node scripts/promote-release.mjs beta v1.0.0`. Hvert kall preflighter
   manifestet (plattformnøkler + versjon) først. `--pause <ring>` er
   kill-switchen; `--status` viser tilstanden — les den tilbake etter en
   offisiell utgivelse og bekreft at BÅDE `stable` og `beta` nå viser det
   nye tagget.
6. **Byte-verifiser feeden** — for en offisiell utgivelse, begge:
   `https://updates.sundaysuite.app/v1/update/sundayscreen/stable` og
   `.../beta` (for et beta-bygg holder det med `/beta`). Sammenlign hver mot
   taggens `latest.json` på GitHub-releasen (versjon, `pub_date`, hver
   plattforms `url` + `signature`). Readback over beviser bare at
   Worker-en har notert riktig TAGG per ring; dette beviser at ringen
   faktisk serverer riktige BYTE — se «Verifisere feeden» under.

Skal en publisert release trekkes helt tilbake (ikke bare pauses)? Det er
ikke dette skriptet — se docs/ROLLBACK.md.

Regler (håndhevet både i skriptet og Worker-side, ASYMMETRISK siden 2026-09
— sunday-telemetry#11): `-beta.N`-tags kun til beta-ringen; rene tags til
stable OG/ELLER beta. En offisiell utgivelse skal nå BEGGE ringer, så ingen
betatester sitter igjen på en eldre build enn resten av flåten — det er
derfor steg 5 over kjører skriptet to ganger. Den andre halvparten av
regelen er uendret: et beta-bygg er utestet per definisjon og kan aldri nå
`stable`. Windows-beta er fortsatt NSIS-only (MSI takler ikke `-beta.N` i
ProductVersion).

## Nøkler og secrets

- **Updater-signering:** nøkkelparet ligger i `~/.tauri/sundayscreen_updater.key`
  (+ `.pub`) på eiers Mac, generert UTEN passordfrase. Pubkey står i
  tauri.conf.json; privatnøkkelen er repo-secret `TAURI_SIGNING_PRIVATE_KEY`
  (satt 08-27). Workflowen setter INGEN `…_PASSWORD`-env — nøkkelen er
  passordløs, og en tom env-variabel er ikke det samme som en fraværende.
- **macOS-kodesignering:** secrets `MAC_CERTS` / `MAC_CERTS_PASSWORD` (samme
  eksport som resten av suiten); `APPLE_SIGNING_IDENTITY` er hardkodet i
  workflowen.
- **Notarisering:** AV inntil Apple-PLA-en er akseptert for team 784GN847G4
  (notary svarer 403 før det). Linjene står klare, utkommentert, i
  release.yml — og husk: `APPLE_ID: ''` slår IKKE av notarisering.
- **Admin-nøkkel** (promote/pause): suitens felles nøkkel i macOS-Keychain
  under tjenesten «SundayRec telemetry admin key» — aldri env, aldri argument.

## Usignert førstegangsåpning (macOS)

Til notariseringen er på plass: «høyreklikk → Åpne»-snarveien er fjernet i
macOS 15 (Sequoia) — den gjør ingenting lenger, uansett hvor mange ganger
man prøver. Riktig rekkefølge, i denne rekkefølgen:

1. Prøv å åpne appen normalt (dobbeltklikk). macOS avviser den.
2. Systeminnstillinger → Personvern og sikkerhet → rull ned til meldingen om
   at appen ble blokkert → «Åpne likevel». Knappen finnes IKKE i
   Systeminnstillinger før steg 1 er forsøkt.
3. Bekreft i dialogen som dukker opp (kan be om passord/Touch ID).

## Verifisere feeden (og en felle)

`latest.json` fra tauri-action peker på `api.github.com/...​/assets/<id>`-URL-er
(manifestet lastes opp mens releasen ennå er utkast). En NAKEN `curl` på en
slik URL gir 200 med JSON-metadata — det ser ut som om updateren ville lastet
ned søppel, men er falsk alarm: tauri-plugin-updater sender
`Accept: application/octet-stream`, som gir selve binæren. Test derfor slik:

    curl -sL -H 'Accept: application/octet-stream' -o /dev/null \
      -w '%{http_code} %{size_download}\n' <url-fra-manifestet>

Størrelsen skal matche release-artefakten byte for byte. Hele suiten (Rec,
Sync) serverer samme URL-form i prod.

## Lærdommer fra første slipp (v0.9.0-beta.1, 08-27)

- Workflowen MÅ ha `permissions: contents: write` — standardtokenet er
  read-only her, og utkast-opprettelsen får ellers 403.
- `secrets`-konteksten er ULOVLIG i steg-`if` («Unrecognized named-value»).
  GitHub forkaster da HELE workflow-fila, og hvert push-event spawner en
  insta-feilet kjøring. Tilstedeværelses-sjekker legges i jobb-`env`.
- En tom `APPLE_CERTIFICATE`-env går likevel inn i keychain-importen og
  feller bygget — signing-env settes derfor via `$GITHUB_ENV` i et
  betinget steg, med ad-hoc `-` som fallback-identitet.
- Entrypoint-vakter i .mjs må sammenligne via `pathToFileURL` — repo-stien
  har mellomrom, og `import.meta.url` prosentkoder dem.
