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
2. `git tag vX.Y.Z[-beta.N] && git push --tags` → release.yml bygger signert
   macOS (aarch64 DMG) + Windows (NSIS; stable-tags også MSI) og lager et
   **utkast** til GitHub-release med `latest.json`.
3. Publiser utkastet manuelt på GitHub.
4. `node scripts/promote-release.mjs beta v0.9.0-beta.1` (eller `stable v1.0.0`)
   — preflighter manifestet (plattformnøkler + versjon) og promoterer ringen.
   `--pause <ring>` er kill-switchen; `--status` viser tilstanden.

Regler (håndhevet både i skriptet og Worker-side): `-beta.N`-tags kun til
beta-ringen, rene tags kun til stable. Windows-beta er NSIS-only (MSI takler
ikke `-beta.N` i ProductVersion).

## Nøkler og secrets

- **Updater-signering:** nøkkelparet ligger i `~/.tauri/sundayscreen_updater.key`
  (+ `.pub`) på eiers Mac, generert UTEN passordfrase. Pubkey står i
  tauri.conf.json. 👤 Legg privatnøkkelens INNHOLD som repo-secret
  `TAURI_SIGNING_PRIVATE_KEY` og sett `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  til tom streng.
- **macOS-kodesignering:** secrets `MAC_CERTS` / `MAC_CERTS_PASSWORD` (samme
  eksport som resten av suiten); `APPLE_SIGNING_IDENTITY` er hardkodet i
  workflowen.
- **Notarisering:** AV inntil Apple-PLA-en er akseptert for team 784GN847G4
  (notary svarer 403 før det). Linjene står klare, utkommentert, i
  release.yml — og husk: `APPLE_ID: ''` slår IKKE av notarisering.
- **Admin-nøkkel** (promote/pause): suitens felles nøkkel i macOS-Keychain
  under tjenesten «SundayRec telemetry admin key» — aldri env, aldri argument.

## Usignert førstegangsåpning (macOS)

Til notariseringen er på plass: høyreklikk appen → Åpne → Åpne.
