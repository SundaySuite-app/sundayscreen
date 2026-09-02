//! The screen's BACKDROP THEME — a named vocabulary, never a colour picker.
//!
//! A theme colours the board BEHIND the widgets and nothing else. Every card
//! keeps `--surface`, so every in-card contrast guarantee the palette already
//! proves (`app/styles/tokens.test.ts`) stays true without a single new
//! exception. The pairs themselves — a backdrop and the one ink allowed
//! directly on it — live in `app/styles/tokens.css`, and their floors are
//! tested there.
//!
//! Five names and no more. The point is that a teacher can tell her Norwegian
//! screen from her maths screen at a glance from the back of the room, not
//! that she can mix a colour.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The backdrop a scene is drawn on.
///
/// Serialised lowercase, and the spellings are PERSISTED VOCABULARY: they sit
/// in the `scene.theme` column and in a transfer file, so renaming a variant
/// is a broken database exactly like renaming a widget `kind` — the same rule
/// `layout::DieColor` carries.
///
/// ⚠️ `Kjolig` has no `ø`. The stored word is ASCII on purpose — the DISPLAY
/// name «Kjølig» lives in the i18n catalogue (`theme.name.kjolig`), and the
/// two must never be confused for one another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "SceneTheme.ts")]
#[serde(rename_all = "lowercase")]
pub enum SceneTheme {
    /// Today's board, unchanged — `--scene-standard-bg` is pinned identical
    /// to `--bg`, so a teacher who never opens the picker sees no difference.
    #[default]
    Standard,
    /// Neutral, a shade lighter than standard — plain paper.
    Papir,
    /// Warm apricot-tinted light.
    Varm,
    /// Cool blue-grey light.
    Kjolig,
    /// The one dark backdrop: a near-black green «chalkboard», with pale ink.
    Tavle,
}

impl SceneTheme {
    /// Read a stored spelling. LENIENT by design: an unknown word — a NEWER
    /// build's theme, a hand-edited row, a typo in a transfer file — degrades
    /// to [`SceneTheme::Standard`] rather than costing the teacher the scene.
    ///
    /// That is the right call precisely because a theme is COSMETIC: the
    /// fallback shows the board she has always had. It is the opposite call
    /// from `schedule::PeriodKind`, where the fallback would invent a lesson
    /// the app then acts on.
    pub fn parse(raw: &str) -> SceneTheme {
        match raw {
            "papir" => SceneTheme::Papir,
            "varm" => SceneTheme::Varm,
            "kjolig" => SceneTheme::Kjolig,
            "tavle" => SceneTheme::Tavle,
            _ => SceneTheme::Standard,
        }
    }

    /// The stored spelling. Must agree with the serde rename above — pinned
    /// in the tests below, because these are two independent spellings of one
    /// vocabulary and nothing else would notice them drifting apart.
    pub fn as_str(&self) -> &'static str {
        match self {
            SceneTheme::Standard => "standard",
            SceneTheme::Papir => "papir",
            SceneTheme::Varm => "varm",
            SceneTheme::Kjolig => "kjolig",
            SceneTheme::Tavle => "tavle",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every variant, so a new one added without a spelling fails here rather
    /// than on a projector.
    const ALL: [SceneTheme; 5] = [
        SceneTheme::Standard,
        SceneTheme::Papir,
        SceneTheme::Varm,
        SceneTheme::Kjolig,
        SceneTheme::Tavle,
    ];

    #[test]
    fn every_variant_round_trips_through_its_stored_spelling() {
        for theme in ALL {
            assert_eq!(SceneTheme::parse(theme.as_str()), theme);
        }
    }

    #[test]
    fn the_stored_spelling_is_the_serde_spelling() {
        // Two pins, one vocabulary: `as_str` writes the column and serde
        // writes the transfer file. A rename that touched only one of them
        // would produce a file this build cannot read back.
        for theme in ALL {
            let json = serde_json::to_string(&theme).expect("serialise");
            assert_eq!(json, format!("\"{}\"", theme.as_str()));
            let back: SceneTheme = serde_json::from_str(&json).expect("deserialise");
            assert_eq!(back, theme);
        }
    }

    #[test]
    fn an_unknown_spelling_degrades_to_standard() {
        // A NEWER build's theme, read by this one. The scene keeps every
        // widget; only the colour falls back.
        assert_eq!(SceneTheme::parse("solnedgang"), SceneTheme::Standard);
        assert_eq!(SceneTheme::parse(""), SceneTheme::Standard);
        assert_eq!(SceneTheme::parse("Tavle"), SceneTheme::Standard);
    }

    #[test]
    fn the_default_is_todays_board() {
        assert_eq!(SceneTheme::default(), SceneTheme::Standard);
        assert_eq!(SceneTheme::default().as_str(), "standard");
    }

    #[test]
    fn the_persisted_vocabulary_is_ascii() {
        // «Kjølig» is a DISPLAY name and lives in the i18n catalogue. A stored
        // word with an ø travels through file systems, SQL dumps and JSON
        // encoders that have all been observed to disagree about it.
        for theme in ALL {
            assert!(
                theme.as_str().is_ascii(),
                "{} is stored vocabulary — keep it ASCII",
                theme.as_str()
            );
        }
    }
}
