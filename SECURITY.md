# Security Policy

SundayScreen is a Tauri 2 desktop app that shows a classroom projector
screen (clock, timer, name picker, groups, traffic light) — fully offline.
It is a public MIT-licensed repository, and it is the only app in Sunday
Suite whose local database can hold real, named minors: a teacher's pupil
list. This document explains how to report a vulnerability, what's
supported, and the threat model the app's controls are designed against.

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue:

Use this repository's Security tab → "Report a vulnerability" (GitHub
private security advisories:
https://github.com/SundaySuite-app/sundayscreen/security/advisories/new).
That opens a private discussion with the maintainer before anything is
public, and it is the **only** reporting channel — there is no security
mailing address we can verify belongs to us, so please do not use one.
If you cannot use advisories, open a regular issue asking for contact
**without** describing the vulnerability, and the maintainer will follow up
privately.

Please include what you found, the affected version, and reproduction
steps. This is a small, single-maintainer project — expect an initial
response within a few days, not an SLA.

## Supported versions

Only the **latest release on your channel** is supported. There is no LTS
branch and no backporting of fixes to older versions. Please update before
reporting an issue that may already be fixed.

SundayScreen auto-updates from one of two rings — `stable` and `beta` —
chosen per install under **Administrer klasser → Oppdateringskanal**. Every
install is on `stable` unless somebody deliberately moved it. A fix for a
security issue lands on `beta` first and is promoted to `stable` once it
has been through a real classroom somewhere (see `docs/ROLLBACK.md` for how
a bad release is pulled). If you are reporting against a `-beta.N` build,
say so — the two rings can be several commits apart.

## Threat model

SundayScreen runs on a **teacher-operated classroom computer**, typically
left running for a whole school day and connected to a projector. The
operator is not a security professional and the machine is not
IT-managed. Trust boundaries the app has to defend at:

- **The local SQLite database** (`sundayscreen.sqlite` under the OS app-data
  directory) — the single highest-value asset in this repo: real pupils'
  names, and nothing else about them (no photos, no grades, no attendance
  history — see `PRIVACY.md`). It never leaves the machine on its own; the
  app makes no network call that could carry it.
- **The update feed** — a first-party Cloudflare Worker at
  `https://updates.sundaysuite.app/v1/update/sundayscreen/{stable|beta}`,
  the app's **only** network call. It serves manifests for tags an owner
  has explicitly promoted (`scripts/promote-release.mjs`), pointing at
  installer artifacts hosted on GitHub Releases. Tauri's built-in updater
  verifies a **minisign** signature on every downloaded artifact
  (`plugins.updater.pubkey` in `tauri.conf.json`) before installing it — the
  `.sig` file beside each installer is that signature, not a code-signing
  certificate (see `docs/NEEDS-RICHARD.md` on Windows Authenticode).
- **The update Worker's admin API** — the same Worker exposes operator-only
  routes (`/v1/admin/promote`, `/v1/admin/channel`, `/v1/admin/channels`) on
  its second custom domain, `https://telemetry.sundaysuite.app`.
  Authentication is a single shared **admin key** sent as the `x-admin-key`
  header; `scripts/promote-release.mjs` reads it from the owner's macOS
  Keychain (`SundayRec telemetry admin key` — the suite's one shared admin
  key) at run time and never accepts it as an argument, an env var, or a
  literal in the file. Whoever holds that key controls what every install
  is offered next, and can pause a ring (`docs/ROLLBACK.md`).
- **The webview / IPC boundary.** All UI runs in the OS system webview,
  behind a strict CSP —
  `connect-src 'self' ipc: http://ipc.localhost`, no other origin — that is
  byte-identical between `tauri.conf.json` and `app/index.html`, checked by
  `app/security-sync.test.ts`. Nothing the app loads is remote content, so
  there is no page in the webview that an attacker controls and could use
  to reach a Tauri command it should not.
- **The system browser** — an _outbound_ boundary, and the app's only way to
  hand something to another program. The link widget («Lenke») stores a
  teacher-typed address and opens it on click. Three properties bound it:
  it happens **only on a click**, never automatically and never at boot;
  the webview sends a **widget ID**, never a URL, so the address opened is
  the one in the database rather than one the page chose; and only
  `http://` and `https://` addresses exist to open at all, enforced twice
  (`sanitized_url` in `crates/sundayscreen-core/src/layout.rs`, once on
  every load and save, and again in `link_open` immediately before the
  hand-off). The second enforcement is not redundant: «flytt oppsettet»
  imports widget configs as raw JSON, so a hostile setup file can put bytes
  in the database that the clamp has not yet seen. What leaves the machine
  is the URL and whatever the browser then sends — never a pupil name,
  which no widget config carries.

**Non-goals:**

- Defending against a compromised OS or a compromised user account. If the
  machine itself is owned, SundayScreen's own controls are not a second
  line of defense.
- Multi-tenant isolation. This is a single-operator desktop app; there is
  no concept of separating multiple untrusted users on one install.
- Protecting against someone with physical access reading the database
  file directly — it is a plain, unencrypted SQLite file (see "Known gaps"
  below).

## Scope

A vulnerability here is anything that:

- lets a pupil's name (or the class list it belongs to) leave the machine
  without the teacher deliberately exporting it,
- weakens or bypasses the updater's signature verification, so an
  unsigned or tampered build could be installed as if it were genuine, or
- lets content running in the webview reach the Tauri IPC boundary beyond
  what the shipped capability set (`src-tauri/capabilities/default.json`)
  already allows a trusted local page to do.

## Controls that exist

So a future auditor doesn't have to re-derive these from scratch:

- **No telemetry at all, not even opt-in** (ADR-005, `docs/DECISIONS.md`).
  There is no crash reporting, no analytics, and no code path that could
  send one — verified by grep in the F9 audit (`docs/GRANSKING-v1.md`,
  kjennelse 1/3): no `fetch`/`XHR`/`WebSocket`/HTTP client anywhere in
  `app/`, and `src-tauri/` makes no HTTP calls outside the updater plugin.
- **Strict CSP, no remote content, no unsafe-inline scripts.**
  `script-src 'self'` with no `unsafe-inline`/`unsafe-eval`; `style-src`
  allows `unsafe-inline` for CSS only. Duplicated between
  `tauri.conf.json` and `app/index.html`'s meta tag, with a sync test
  (`app/security-sync.test.ts`) so the two cannot silently drift.
- **A minimal capability set, and plugins the webview cannot call.**
  `src-tauri/capabilities/default.json` grants only window-management
  permissions (minimize, maximize, fullscreen, position/size). It has
  never granted anything else, and the file is untouched by every feature
  described below.

  Plugins with real capabilities are nevertheless registered in
  `src-tauri/src/lib.rs`: the updater (under the `updater` feature), the
  native file dialog (for «flytt oppsettet») and the opener (for the link
  widget). No `updater:*`, `dialog:*` or `opener:*` permission appears in
  the capability file, so Tauri's ACL **denies** every one of their own
  IPC commands to the page — `plugin:dialog|open`, `plugin:dialog|save`,
  `plugin:opener|open_url`, `plugin:opener|open_path` and
  `plugin:opener|reveal_item_in_dir` included. The webview reaches their
  functionality only through this app's own typed commands, and those take
  **identifiers, not paths or URLs**: `transfer_export` /
  `transfer_import` open the dialog in Rust and the page never learns the
  chosen path; `link_open` takes a widget ID and reads the address out of
  the database. There is still no general-purpose file, shell or "open
  anything" bridge — and that is now a claim about argument shapes, not
  about which plugins happen to be linked in.

  What a plugin _does_ put in the page is worth naming rather than
  assuming, because one of them surprised us. `tauri_plugin_dialog::init()`
  injects a script that replaces `window.alert` and `window.confirm` with
  IPC calls (the replaced `confirm` returns a Promise, which is always
  truthy — `if (confirm(…))` would take the yes branch); nothing in `app/`
  calls either global. The opener plugin has the same habit: its `init()`
  would inject a global click handler that routes `<a target="_blank">` —
  and any Ctrl- or Shift-clicked anchor — through `plugin:opener|open_url`,
  cancelling the click first and only then hitting the ACL denial, which
  swallows Ctrl-clicks on Windows (where the page is served over
  `http://tauri.localhost`) but not on macOS (`tauri:`). It is registered
  with `Builder::new().open_js_links_on_click(false)` instead, so that
  script is **not** injected at all. The app has no external `<a href>`
  for it to act on either: the link widget's click surface is a `<button>`,
  pinned by `e2e/link.spec.ts`.

- **The one URL rule, spelled once.** `sanitized_url`
  (`crates/sundayscreen-core/src/layout.rs`) accepts `http://` and
  `https://` only, refuses any control character, and **clears** rather
  than truncates a URL over its cap — a shortened URL is a different
  resource wearing the teacher's title. It runs inside `clamp`, which every
  layout load and every layout save calls, and again inside `link_open`
  before the address reaches the operating system. A `javascript:` or
  `file:` URI planted by a hand-edited database or a hostile setup file
  therefore never renders and never opens (`layout.rs` and
  `src-tauri/src/commands/links.rs` both carry the table tests).
- **Updater signature verification.** Tauri's built-in updater verifies a
  minisign signature on every downloaded update before installing it —
  a build without a valid signature for the pinned pubkey is refused, full
  stop.
- **Admin key never touches an argument, env var, or file.**
  `scripts/promote-release.mjs` reads the shared release-admin key from the
  macOS Keychain at call time only.
- **A downgrade or schema mismatch cannot be mistaken for a corrupt
  database.** `should_quarantine` (`src-tauri/src/error.rs`) moves the
  database file aside only on positively proven `SQLITE_CORRUPT` /
  `SQLITE_NOTADB`; every other open failure — including one an attacker
  might try to induce by feeding the app a malformed file — leaves the
  original bytes untouched and surfaces an on-screen explanation instead of
  silently discarding data. What makes a downgrade survivable is that
  untouched FILE — not the backups, which are taken after a successful
  migration and therefore carry the newer schema.
- **A rotating backup that cannot erase itself.**
  `sundayscreen.backup-{1,2,3}.sqlite`, written via `VACUUM INTO` after a
  clean boot, independently of the quarantine decision — with one rule:
  **an empty database is never copied** (`backup_rotating`,
  `src-tauri/src/db/store.rs`). Without it the boot after a quarantine
  rotated the freshly emptied database into `backup-1` and pushed the last
  good copy a slot closer to the bin; three restarts erased all three
  generations, while the on-screen explanation still named `backup-1` to the
  teacher as the file to go and get. The copies now stand until there is
  real data to replace them with.

## Known gaps / accepted risks

- **macOS builds are ad-hoc signed, not notarized.** Apple's notary service
  requires accepting the Program License Agreement for the team account
  first (see `docs/NEEDS-RICHARD.md`); until then, Gatekeeper warns on
  first launch and the "right-click → Open" workaround no longer exists on
  macOS 15 (the correct sequence is documented in
  `docs/DISTRIBUTION.md`).
- **Windows builds have no Authenticode certificate.** The `.sig` file
  beside a Windows installer is the minisign updater signature described
  above, not Authenticode — SmartScreen will show an "unknown publisher"
  warning until a certificate is purchased (`docs/NEEDS-RICHARD.md`).
  Neither gap affects the updater's own signature check, which is
  independent of OS code-signing.
- **The SQLite database is not encrypted at rest.** Anyone with file access
  to the machine (or its backups) can read the pupil names in plain text.
  This follows directly from the local-only, no-account design described in
  `PRIVACY.md` — there is no server-side copy to protect instead, and no
  account to gate access with.
