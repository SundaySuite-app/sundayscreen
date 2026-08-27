import type { Settings } from "../bindings/Settings";

// Typed as the GENERATED binding, so a Rust field change is a TS compile
// error here. Used ONLY as the api-shim's fallback when the backend cannot
// answer (a plain-browser boot, or a genuinely broken store) and as the e2e
// seed base — explicitly not a source of truth. The real defaults live in
// crates/sundayscreen-core/src/settings.rs.
export const SETTINGS_DEFAULTS: Settings = {
  language: "no",
  activeClassId: null,
  snapEnabled: true,
  window: null,
  updateChannel: "stable",
};
