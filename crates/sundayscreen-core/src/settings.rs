//! The typed, validated SundayScreen settings model.
//!
//! This module is pure: the [`Settings`] struct, its [`Default`] impl, the
//! [`Settings::validate`] clamping pass and [`Settings::from_json_merged`]
//! (partial-JSON-over-defaults parsing) are all deterministic and unit-tested
//! here. The `src-tauri` `settings` layer is the thin persistence/command
//! shell that serialises this to/from the SQLite `app_setting` bag.
//!
//! Layout, class lists and the name-picker pool are NOT settings — they have
//! their own tables. This bag holds only what is global to the app.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The saved main-window geometry, restored on boot. `None` in
/// [`Settings::window`] means "never saved — use the tauri.conf.json default".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "WindowState.ts")]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    /// Outer position, logical pixels. May be negative on multi-monitor rigs.
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Outer size, logical pixels. Clamped by [`Settings::validate`].
    #[serde(default = "default_window_w")]
    pub w: f64,
    #[serde(default = "default_window_h")]
    pub h: f64,
    /// Was the app in fullscreen when it closed?
    #[serde(default)]
    pub fullscreen: bool,
}

fn default_window_w() -> f64 {
    1280.0
}
fn default_window_h() -> f64 {
    800.0
}

/// The smallest window `validate` lets a saved state restore to — matches the
/// minimum tauri.conf.json enforces, so a hand-edited blob cannot restore an
/// unusable sliver.
pub const MIN_WINDOW_W: f64 = 960.0;
pub const MIN_WINDOW_H: f64 = 600.0;

/// Upper bounds on a restorable geometry (F9-funn B#8): finite-but-absurd
/// hand-edited values (`w: 1e12`) passed the old clamp. Generous — an 8K
/// video wall fits — but bounded.
pub const MAX_WINDOW_DIM: f64 = 20_000.0;
pub const MAX_WINDOW_POS: f64 = 100_000.0;

/// Which release feed this install follows. The lowercase tag IS the feed's
/// path segment (`/v1/update/sundayscreen/{stable|beta}`) — a renamed
/// variant is a renamed live URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "UpdateChannel.ts")]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    /// Where every install stays unless someone deliberately moves it.
    #[default]
    Stable,
    /// Promoted-but-unverified builds, for machines whose owner accepted
    /// that job.
    Beta,
}

impl UpdateChannel {
    /// The stored tag / feed path segment.
    pub fn as_tag(self) -> &'static str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
        }
    }

    /// Parse a stored tag; anything unrecognised is [`UpdateChannel::Stable`]
    /// — a value we cannot read cannot mean "this owner asked for unverified
    /// builds".
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "beta" => UpdateChannel::Beta,
            _ => UpdateChannel::Stable,
        }
    }
}

/// Lenient deserializer for [`Settings::update_channel`]: an unreadable
/// value costs the channel (→ Stable) and nothing else.
fn lenient_channel<'de, D>(de: D) -> Result<UpdateChannel, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(de)?;
    Ok(raw.as_str().map(UpdateChannel::parse).unwrap_or_default())
}

/// Lenient per-field deserializer: tolerate a malformed VALUE by taking the
/// field's `Default` instead of failing the whole blob. Without this,
/// [`Settings::from_json_merged`] falls back to the FULL defaults the moment
/// ANY field rejects its value — a hand-edited language string would reset the
/// active class along with it. Here a bad value costs that one field.
fn lenient<'de, D, T>(de: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let raw = serde_json::Value::deserialize(de)?;
    Ok(serde_json::from_value(raw).unwrap_or_default())
}

/// [`lenient`] for a field whose default is `true`: the generic version falls
/// back to `T::default()`, and `bool::default()` is `false` — which would turn
/// "this value was garbage" into "the user turned it off".
fn lenient_true<'de, D>(de: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(de)?;
    Ok(serde_json::from_value(raw).unwrap_or(true))
}

/// [`lenient`] for the language: the documented default is `Some("no")`, but
/// the generic fallback is `Option::default()` = `None` ("follow the OS") —
/// a different outcome for garbage than for an absent field (F9-funn B#7).
fn lenient_language<'de, D>(de: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(de)?;
    Ok(serde_json::from_value(raw).unwrap_or_else(|_| default_language()))
}

/// The complete settings model.
///
/// Every field carries `#[serde(default)]` so a partial or older JSON blob
/// deserialises by filling in the per-field default. Numeric ranges are
/// enforced separately by [`Settings::validate`], which every load/save runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "Settings.ts")]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// UI language code (e.g. `"no"`). `None` means "follow the OS" — the
    /// frontend resolves that to an active locale.
    #[serde(default = "default_language", deserialize_with = "lenient_language")]
    pub language: Option<String>,
    /// The class whose name list + layout is on screen. `None` until the first
    /// class exists; the frontend then opens the manage panel.
    #[serde(default, deserialize_with = "lenient")]
    pub active_class_id: Option<String>,
    /// The scene on screen: a global library scene, or the active class's
    /// default. `None`/invalid heals to the class default (Runde 2).
    #[serde(default, deserialize_with = "lenient")]
    pub active_scene_id: Option<String>,
    /// Snap widget edges to the surface and to siblings while dragging.
    #[serde(default = "default_true", deserialize_with = "lenient_true")]
    pub snap_enabled: bool,
    /// Saved window geometry, or `None` for the config default.
    #[serde(default, deserialize_with = "lenient")]
    pub window: Option<WindowState>,
    /// Which release feed this install follows.
    #[serde(default, deserialize_with = "lenient_channel")]
    pub update_channel: UpdateChannel,
    /// Opt-in: switch class+scene automatically when a planned lesson
    /// starts. Off by default — the banner suggests, the teacher decides.
    #[serde(default, deserialize_with = "lenient")]
    pub auto_switch_scenes: bool,
    /// ADR-007: settings keys a NEWER version wrote survive this build's
    /// load→save cycle instead of being dropped by the whole-blob write.
    /// `#[ts(skip)]` — the webview receives the keys inline and its
    /// whole-object spreads carry them back untouched.
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_language() -> Option<String> {
    Some("no".to_string())
}
fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: default_language(),
            active_class_id: None,
            active_scene_id: None,
            snap_enabled: true,
            window: None,
            update_channel: UpdateChannel::Stable,
            auto_switch_scenes: false,
            extra: Default::default(),
        }
    }
}

impl Settings {
    /// Parse a (possibly partial, possibly older) JSON blob by merging it over
    /// the defaults. Invalid JSON — or a JSON non-object — yields the plain
    /// defaults rather than an error: a corrupt store must never fail boot.
    ///
    /// The explicit object check is load-bearing: serde derives also accept a
    /// SEQUENCE for a struct (fields by position), so without it `[1,2,3]`
    /// would "successfully" parse into a Settings full of lenient-fallback
    /// values instead of taking the defaults.
    pub fn from_json_merged(json: &str) -> Settings {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
            return Settings::default();
        };
        if !value.is_object() {
            return Settings::default();
        }
        serde_json::from_value(value).unwrap_or_default()
    }

    /// Clamp every numeric field into its legal range, in place. Idempotent;
    /// every load and every save runs it, so an out-of-range value can never
    /// be observed by a caller nor persisted.
    pub fn validate(&mut self) {
        if let Some(w) = &mut self.window {
            // A non-finite or absurd geometry is not a geometry — drop the
            // whole state and let the config default win.
            let sane = w.x.is_finite()
                && w.y.is_finite()
                && w.w.is_finite()
                && w.h.is_finite()
                && w.x.abs() <= MAX_WINDOW_POS
                && w.y.abs() <= MAX_WINDOW_POS
                && w.w <= MAX_WINDOW_DIM
                && w.h <= MAX_WINDOW_DIM;
            if !sane {
                self.window = None;
            } else {
                w.w = w.w.max(MIN_WINDOW_W);
                w.h = w.h.max(MIN_WINDOW_H);
            }
        }
        // An empty-string language means nothing was chosen.
        if let Some(lang) = &self.language {
            if lang.trim().is_empty() {
                self.language = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_norwegian_with_snap_on_and_no_window() {
        let s = Settings::default();
        assert_eq!(s.language.as_deref(), Some("no"));
        assert_eq!(s.active_class_id, None);
        assert!(s.snap_enabled);
        assert_eq!(s.window, None);
    }

    #[test]
    fn partial_json_merges_over_defaults() {
        let s = Settings::from_json_merged(r#"{ "activeClassId": "abc" }"#);
        assert_eq!(s.active_class_id.as_deref(), Some("abc"));
        // Everything else defaulted.
        assert_eq!(s.language.as_deref(), Some("no"));
        assert!(s.snap_enabled);
    }

    #[test]
    fn corrupt_json_yields_defaults() {
        assert_eq!(
            Settings::from_json_merged("{ not json ]]] \0"),
            Settings::default()
        );
        assert_eq!(Settings::from_json_merged(""), Settings::default());
        assert_eq!(Settings::from_json_merged("[1,2,3]"), Settings::default());
        assert_eq!(Settings::from_json_merged("42"), Settings::default());
    }

    #[test]
    fn one_bad_field_costs_that_field_and_nothing_else() {
        // `snapEnabled` is garbage; `activeClassId` must survive.
        let s = Settings::from_json_merged(r#"{ "snapEnabled": "banana", "activeClassId": "k" }"#);
        assert!(s.snap_enabled, "bad value takes the field default");
        assert_eq!(s.active_class_id.as_deref(), Some("k"));
    }

    #[test]
    fn validate_clamps_a_tiny_window_to_the_minimum() {
        let mut s = Settings {
            window: Some(WindowState {
                x: 10.0,
                y: 10.0,
                w: 100.0,
                h: 50.0,
                fullscreen: false,
            }),
            ..Default::default()
        };
        s.validate();
        let w = s.window.unwrap();
        assert_eq!(w.w, MIN_WINDOW_W);
        assert_eq!(w.h, MIN_WINDOW_H);
    }

    #[test]
    fn a_garbage_language_takes_the_documented_default_not_follow_os() {
        // F9-funn B#7: garbage must land on Some("no"), same as absent.
        let s = Settings::from_json_merged(r#"{ "language": 42 }"#);
        assert_eq!(s.language.as_deref(), Some("no"));
        // An explicit null still means "follow the OS".
        let s = Settings::from_json_merged(r#"{ "language": null }"#);
        assert_eq!(s.language, None);
    }

    #[test]
    fn validate_drops_an_absurd_but_finite_geometry() {
        // F9-funn B#8: finite nonsense must not survive the clamp.
        let mut s = Settings {
            window: Some(WindowState {
                x: 50_000_000.0,
                y: 0.0,
                w: 1e12,
                h: 800.0,
                fullscreen: false,
            }),
            ..Default::default()
        };
        s.validate();
        assert_eq!(s.window, None);
    }

    #[test]
    fn validate_drops_a_non_finite_window_state() {
        let mut s = Settings {
            window: Some(WindowState {
                x: f64::NAN,
                y: 0.0,
                w: 1280.0,
                h: 800.0,
                fullscreen: false,
            }),
            ..Default::default()
        };
        s.validate();
        assert_eq!(s.window, None);
    }

    #[test]
    fn validate_blanks_an_empty_language() {
        let mut s = Settings {
            language: Some("   ".to_string()),
            ..Default::default()
        };
        s.validate();
        assert_eq!(s.language, None);
    }

    #[test]
    fn validate_is_idempotent() {
        let mut s = Settings::from_json_merged(r#"{ "window": { "w": 1, "h": 1 } }"#);
        s.validate();
        let once = s.clone();
        s.validate();
        assert_eq!(s, once);
    }

    #[test]
    fn update_channel_parses_leniently_and_defaults_to_stable() {
        assert_eq!(UpdateChannel::parse(" BETA "), UpdateChannel::Beta);
        assert_eq!(UpdateChannel::parse("canary"), UpdateChannel::Stable);
        // A garbage channel costs the channel, never the rest of the blob.
        let s = Settings::from_json_merged(r#"{ "updateChannel": 42, "activeClassId": "keep" }"#);
        assert_eq!(s.update_channel, UpdateChannel::Stable);
        assert_eq!(s.active_class_id.as_deref(), Some("keep"));
        // The real value round-trips.
        let beta = Settings {
            update_channel: UpdateChannel::Beta,
            ..Default::default()
        };
        let json = serde_json::to_string(&beta).unwrap();
        assert!(json.contains("\"updateChannel\":\"beta\""));
        assert_eq!(Settings::from_json_merged(&json), beta);
    }

    #[test]
    fn serialises_camel_case() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        assert!(json.contains("\"activeClassId\""));
        assert!(json.contains("\"snapEnabled\""));
        assert!(!json.contains("active_class_id"));
    }

    #[test]
    fn round_trips_through_json() {
        let s = Settings {
            language: Some("en".into()),
            active_class_id: Some("7b".into()),
            active_scene_id: Some("scene-1".into()),
            snap_enabled: false,
            window: Some(WindowState {
                x: -100.0,
                y: 40.0,
                w: 1920.0,
                h: 1080.0,
                fullscreen: true,
            }),
            update_channel: UpdateChannel::Beta,
            auto_switch_scenes: true,
            extra: Default::default(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(Settings::from_json_merged(&json), s);
    }

    /// ADR-007: settings keys a NEWER version wrote must survive this
    /// build's load→save cycle (the write is whole-blob).
    #[test]
    fn unknown_settings_keys_survive_a_round_trip() {
        let s =
            Settings::from_json_merged(r#"{"language":"no","futureFlag":true,"nested":{"a":1}}"#);
        assert_eq!(s.language.as_deref(), Some("no"));
        let out = serde_json::to_value(&s).unwrap();
        assert_eq!(out["futureFlag"], serde_json::json!(true));
        assert_eq!(out["nested"], serde_json::json!({ "a": 1 }));
    }
}
