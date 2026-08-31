# Å trekke en utgivelse tilbake

> Runbook: en publisert og promotert beta viser seg ha en alvorlig feil. Fire
> ting å vite, i den rekkefølgen de faktisk virker.

## 1. Ekte tilbaketrekking = avpublisér GitHub-releasen

Dette er DEN ene bryteren, fordi alle tre nedlastingsveiene til slutt peker på
samme sted: updater-manifestet (`latest.json`) sine plattform-URL-er,
nettsidas nedlastingsknapp og en direktelenke en lærer har liggende er alle
`github.com/SundaySuite-app/sundayscreen/releases/download/<tag>/...`-lenker.
Avpubliser releasen (Rediger utgivelse på GitHub → «Save as draft», eller
`gh release edit <tag> --draft`) og alle tre gir 404 i samme sekund — ingen
av dem har en selvstendig kopi å falle tilbake på.

Ikke reversibelt for maskiner som ALT har lastet ned filen (den ligger på
disken deres), men det stopper enhver NY nedlasting umiddelbart.

## 2. Kill-switch/pause på updates-Workeren

`node scripts/promote-release.mjs --pause beta` (eller `--pause stable`)
setter ringen i pause hos suitens update-Worker. Gjenåpne med
`--resume beta`/`--resume stable`; se tilstanden for begge ringer med
`--status`. Alle tre kaller admin-API-et på `telemetry.sundaysuite.app` med
suitens delte admin-nøkkel fra macOS-Keychain (aldri argument, aldri env —
se docs/DISTRIBUTION.md).

Pause er IKKE avpublisering: den stopper KUN updater-SVARET (Workeren
svarer 204 — «ingenting promotert»). GitHub-releasen består urørt, så en
lærer med en direktelenke eller nettsidas nedlastingsknapp kan fortsatt
laste ned den pausede versjonen. Bruk pause for å stanse spredning via
auto-oppdatering mens du vurderer om releasen skal avpubliseres helt.

## 3. Hva en kjørende maskin opplever

Boot-sjekken (`spawn_boot_check`) er appens ENESTE nettkall, og den kjører
ÉN gang ved oppstart — ikke løpende i bakgrunnen. En pause eller
avpublisering merkes derfor tidligst ved NESTE oppstart av appen, aldri før.
Det finnes ingen fjernstyring av en kjørende maskin, og det er bevisst:
produktløfte 1 er null nettavhengighet i drift, og en fjernstyringskanal
ville vært nøyaktig det appen lover å ikke ha.

## 4. Nedgradering av en maskin som alt har installert en dårlig beta

Manuell installasjon av forrige versjon (last ned fra GitHub Releases, kjør
installeren over den kjørende appen) er, siden R4, TRYGT: en
versjonskonflikt rører aldri databasen (`should_quarantine`,
src-tauri/src/error.rs — kvarantene skjer KUN ved bevist SQLITE_CORRUPT/
SQLITE_NOTADB), og appen forklarer seg selv på skjermen i stedet for å boote
tomt uten et ord. Det som redder nedgraderingen er at FILA er urørt — ikke
sikkerhetskopiene: de er tatt etter en vellykket migrering og bærer derfor
den NYERE skjemaversjonen, så en eldre build kan ikke lese dem heller. Se
docs/DISTRIBUTION.md for last-ned-lenker og usignert-førstegangsåpning på
macOS.

Sikkerhetskopiene er der for et annet uhell (en ødelagt fil), og de følger
én regel som er verdt å kjenne: **en TOM database kopieres aldri**
(`backup_rotating`). Etter en kvarantene starter appen på en tom base, og
uten regelen ville neste oppstart vakuumert tomheten inn i `backup-1` og
dyttet den siste gode kopien et hakk nedover — tre omstarter, tre tomme
generasjoner, mens skjermmeldingen fortsatt peker læreren på
`sundayscreen.backup-1.sqlite` ved navn. Kopiene står nå til det finnes
ekte data igjen.

Updateren selv tilbyr ALDRI en lavere versjon (semver-sammenligning) —
nedgradering er alltid en manuell handling utført av den som sitter ved
maskinen, aldri noe appen gjør av seg selv.
