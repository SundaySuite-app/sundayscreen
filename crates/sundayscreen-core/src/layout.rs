//! The widget-layout model — the TYPE AUTHORITY for what lives on the screen.
//!
//! [`WidgetInstance`] and the per-kind [`WidgetConfig`] enum are the persisted
//! shape; ts-rs exports them so the frontend never hand-maintains widget
//! types. The DB stores `kind` and `config` in SEPARATE columns on purpose —
//! [`row_to_instance`] is the tolerance seam:
//!
//!   - a `config` that fails to parse costs THAT widget its settings (it
//!     falls back to the kind's defaults; the widget survives),
//!   - an unknown `kind` is retained in the database but skipped by the API —
//!     a downgrade never destroys a newer version's widget.
//!
//! Coordinates are normalised 0..1 PER AXIS (x,w against surface width; y,h
//! against height); [`clamp_layout`] guarantees every loaded/saved rect is
//! finite, on-surface and at least [`MIN_NORM_SIZE`]. Pixel-space minimums
//! per kind are an interaction-time concern (they depend on the live surface
//! size) and deliberately NOT part of the persisted clamp.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Smallest normalised width/height a persisted widget may have.
pub const MIN_NORM_SIZE: f64 = 0.03;

/// Longest text-widget content that will be persisted, in characters.
pub const TEXT_CONTENT_MAX_CHARS: usize = 10_000;

/// A widget's place on the surface, normalised 0..1 per axis.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "NormRect.ts")]
pub struct NormRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Text alignment inside the text widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "TextAlign.ts")]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    Left,
    #[default]
    Center,
    Right,
}

fn default_font_scale() -> f64 {
    1.0
}

/// Per-kind widget configuration. The serde tag IS the `kind` column value —
/// a renamed variant is a broken database.
///
/// Adding a widget kind = one variant here (+ default + clamp arm) + one
/// frontend folder + one registry line. Nothing else.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "WidgetConfig.ts")]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum WidgetConfig {
    Text {
        #[serde(default)]
        content: String,
        #[serde(default = "default_font_scale")]
        font_scale: f64,
        #[serde(default)]
        align: TextAlign,
    },
}

impl WidgetConfig {
    /// The `kind` column value for this config — the serde tag, spelled once.
    pub fn kind(&self) -> &'static str {
        match self {
            WidgetConfig::Text { .. } => "text",
        }
    }

    /// The default config for a kind, or `None` for a kind this build does
    /// not know (a newer version's widget — retained, not rendered).
    pub fn default_for(kind: &str) -> Option<WidgetConfig> {
        match kind {
            "text" => Some(WidgetConfig::Text {
                content: String::new(),
                font_scale: default_font_scale(),
                align: TextAlign::default(),
            }),
            _ => None,
        }
    }

    /// Clamp every field into its legal range, in place. Idempotent.
    pub fn clamp(&mut self) {
        match self {
            WidgetConfig::Text {
                content,
                font_scale,
                ..
            } => {
                if !font_scale.is_finite() {
                    *font_scale = default_font_scale();
                }
                *font_scale = font_scale.clamp(0.25, 6.0);
                if content.chars().count() > TEXT_CONTENT_MAX_CHARS {
                    *content = content.chars().take(TEXT_CONTENT_MAX_CHARS).collect();
                }
            }
        }
    }
}

/// One widget on a class's screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "WidgetInstance.ts")]
#[serde(rename_all = "camelCase")]
pub struct WidgetInstance {
    pub id: String,
    pub rect: NormRect,
    /// Stacking order; re-indexed 0..n by [`clamp_layout`]. i64 would map to
    /// `bigint` in TS; force `number` (z never leaves 0..n).
    #[ts(type = "number")]
    pub z: i64,
    pub config: WidgetConfig,
}

/// The rect a widget falls back to when its stored geometry is not a
/// geometry (non-finite values).
fn fallback_rect() -> NormRect {
    NormRect {
        x: 0.35,
        y: 0.35,
        w: 0.3,
        h: 0.3,
    }
}

/// Clamp one rect: finite, at least [`MIN_NORM_SIZE`], fully on-surface.
pub fn clamp_rect(rect: &mut NormRect) {
    if !(rect.x.is_finite() && rect.y.is_finite() && rect.w.is_finite() && rect.h.is_finite()) {
        *rect = fallback_rect();
        return;
    }
    rect.w = rect.w.clamp(MIN_NORM_SIZE, 1.0);
    rect.h = rect.h.clamp(MIN_NORM_SIZE, 1.0);
    rect.x = rect.x.clamp(0.0, 1.0 - rect.w);
    rect.y = rect.y.clamp(0.0, 1.0 - rect.h);
}

/// Clamp every widget and re-index z to a dense 0..n (stable in current z
/// order, ties by position in the list). Every load and every save runs
/// this, so an out-of-range layout can never be observed nor persisted.
pub fn clamp_layout(widgets: &mut [WidgetInstance]) {
    for w in widgets.iter_mut() {
        clamp_rect(&mut w.rect);
        w.config.clamp();
    }
    let mut order: Vec<usize> = (0..widgets.len()).collect();
    order.sort_by_key(|&i| (widgets[i].z, i));
    for (new_z, &i) in order.iter().enumerate() {
        widgets[i].z = new_z as i64;
    }
}

/// The tolerance seam: one stored row → a renderable instance, or `None` for
/// a kind this build does not know (the row stays in the DB untouched).
#[allow(clippy::too_many_arguments)]
pub fn row_to_instance(
    id: &str,
    kind: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    z: i64,
    config_json: &str,
) -> Option<WidgetInstance> {
    let config = serde_json::from_str::<WidgetConfig>(config_json)
        .ok()
        // A parsed config whose tag disagrees with the kind COLUMN is a
        // corrupt row, not a newer widget — the column is the authority.
        .filter(|c| c.kind() == kind)
        .or_else(|| WidgetConfig::default_for(kind))?;
    let mut inst = WidgetInstance {
        id: id.to_string(),
        rect: NormRect { x, y, w, h },
        z,
        config,
    };
    clamp_rect(&mut inst.rect);
    inst.config.clamp();
    Some(inst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(content: &str) -> WidgetConfig {
        WidgetConfig::Text {
            content: content.to_string(),
            font_scale: 1.0,
            align: TextAlign::Center,
        }
    }

    #[test]
    fn config_serialises_with_the_kind_tag_and_camel_case_fields() {
        let json = serde_json::to_string(&text("hei")).unwrap();
        assert!(json.contains("\"kind\":\"text\""));
        assert!(json.contains("\"fontScale\""));
        assert!(!json.contains("font_scale"));
    }

    #[test]
    fn kind_accessor_matches_the_serde_tag() {
        let json = serde_json::to_string(&text("x")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["kind"], text("x").kind());
    }

    #[test]
    fn row_with_broken_config_survives_with_the_kinds_defaults() {
        let inst = row_to_instance("w1", "text", 0.1, 0.1, 0.3, 0.2, 0, "{ garbage ]]]")
            .expect("widget must survive a broken config");
        assert_eq!(inst.config, WidgetConfig::default_for("text").unwrap());
        assert_eq!(inst.id, "w1");
    }

    #[test]
    fn row_with_mismatched_tag_takes_the_columns_kind() {
        // Config claims some other shape; the kind column says text.
        let inst = row_to_instance(
            "w1",
            "text",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"submarine","depth":3}"#,
        )
        .expect("kind column is the authority");
        assert_eq!(inst.config.kind(), "text");
    }

    #[test]
    fn unknown_kind_is_skipped_not_destroyed() {
        // A newer version's widget: this build renders nothing, deletes
        // nothing — row_to_instance answers None and the caller leaves the
        // row alone.
        assert!(row_to_instance("w9", "dayplan", 0.1, 0.1, 0.3, 0.2, 0, "{}").is_none());
    }

    #[test]
    fn valid_config_round_trips_through_a_row() {
        let json = serde_json::to_string(&text("Husk gymtøy!")).unwrap();
        let inst = row_to_instance("w1", "text", 0.2, 0.3, 0.4, 0.2, 5, &json).unwrap();
        assert_eq!(inst.config, text("Husk gymtøy!"));
        assert_eq!(inst.z, 5);
    }

    #[test]
    fn clamp_rect_pulls_an_offscreen_rect_back_on_surface() {
        let mut r = NormRect {
            x: 0.9,
            y: -0.5,
            w: 0.5,
            h: 0.5,
        };
        clamp_rect(&mut r);
        assert_eq!(r.x, 0.5); // 1 - w
        assert_eq!(r.y, 0.0);
    }

    #[test]
    fn clamp_rect_enforces_the_minimum_size_and_replaces_non_finite() {
        let mut tiny = NormRect {
            x: 0.5,
            y: 0.5,
            w: 0.0001,
            h: 0.0001,
        };
        clamp_rect(&mut tiny);
        assert_eq!(tiny.w, MIN_NORM_SIZE);
        assert_eq!(tiny.h, MIN_NORM_SIZE);

        let mut broken = NormRect {
            x: f64::NAN,
            y: 0.2,
            w: 0.3,
            h: 0.3,
        };
        clamp_rect(&mut broken);
        assert!(broken.x.is_finite() && broken.w > 0.0);
    }

    #[test]
    fn clamp_layout_reindexes_z_densely_and_stably() {
        let mk = |z: i64| WidgetInstance {
            id: format!("w{z}"),
            rect: NormRect {
                x: 0.1,
                y: 0.1,
                w: 0.2,
                h: 0.2,
            },
            z,
            config: text("a"),
        };
        let mut widgets = vec![mk(50), mk(-3), mk(50)];
        clamp_layout(&mut widgets);
        // -3 → 0; the two 50s keep their relative order (stable by index).
        assert_eq!(widgets[0].z, 1);
        assert_eq!(widgets[1].z, 0);
        assert_eq!(widgets[2].z, 2);
    }

    #[test]
    fn config_clamp_caps_font_scale_and_content_length() {
        let mut c = WidgetConfig::Text {
            content: "æ".repeat(TEXT_CONTENT_MAX_CHARS + 100),
            font_scale: f64::INFINITY,
            align: TextAlign::Left,
        };
        c.clamp();
        let WidgetConfig::Text {
            content,
            font_scale,
            ..
        } = c;
        assert_eq!(content.chars().count(), TEXT_CONTENT_MAX_CHARS);
        assert_eq!(font_scale, 1.0);

        let mut big = WidgetConfig::Text {
            content: String::new(),
            font_scale: 99.0,
            align: TextAlign::Left,
        };
        big.clamp();
        let WidgetConfig::Text { font_scale, .. } = big;
        assert_eq!(font_scale, 6.0);
    }

    #[test]
    fn partial_config_json_takes_field_defaults() {
        let inst = row_to_instance("w1", "text", 0.1, 0.1, 0.3, 0.2, 0, r#"{"kind":"text"}"#)
            .expect("partial config is fine");
        let WidgetConfig::Text {
            content,
            font_scale,
            align,
        } = inst.config;
        assert_eq!(content, "");
        assert_eq!(font_scale, 1.0);
        assert_eq!(align, TextAlign::Center);
    }
}
