#!/usr/bin/env bash
# Run the exact gate CI runs (.github/workflows/ci.yml) locally on this Mac, so
# you can verify a branch BEFORE pushing.
#
# Benign differences from CI (everything else is identical):
#   - runs on your arch (aarch64-apple-darwin), not the ubuntu x86 runner
#   - skips `npm ci` — uses your existing node_modules
#   - skips the apt system deps (webkit/gtk) — already present on macOS
#   - does NOT mirror CI's separate `audit` job or the `windows-check` job
#
# Each step below is the same command CI runs, in the same order. Reuses the
# package.json scripts so this mirror can't silently drift from them.
set -euo pipefail
cd "$(dirname "$0")/.."

CURRENT="startup"
trap 'printf "\n\033[1;31m✗ CI FAILED at: %s\033[0m\n" "$CURRENT" >&2' ERR
step() { CURRENT="$1"; printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

step "frontend — eslint";               npm run lint
step "frontend — prettier --check";     npm run format:check
step "frontend — tsc --noEmit";         npm run typecheck
step "frontend — vitest";               npm run test

step "app version in sync";             npm run version-sync
step "i18n nøkler finnes (app/)";       npm run i18n-keys
step "i18n ingen døde nøkler";          npm run i18n-keys:unused
step "i18n hardkoding 0 (app/)";        npm run i18n-hardcoded-tsx
step "i18n flertallsgrupper";           npm run i18n-plurals
step "farger kun via tokens (app/)";    npm run css-tokens

step "rust — cargo fmt --check";        npm run fmt:rust:check
step "rust — cargo clippy -D warnings"; npm run lint:rust
step "rust — cargo test --workspace";   npm run test:rust

# status --porcelain (not diff): also catches brand-new binding files, which
# are untracked and invisible to `git diff`.
step "ts-rs bindings up to date";       npm run bindings
if [ -n "$(git status --porcelain -- app/bindings)" ]; then
  printf "\033[1;31m✗ ts-rs bindings are stale — regenerate and commit:\033[0m\n"
  git status --porcelain -- app/bindings
  exit 1
fi

step "tauri build (no bundle)";         npm run tauri build -- --no-bundle

CURRENT="done"
printf "\n\033[1;32m✓ all CI checks passed locally — safe to push\033[0m\n"
