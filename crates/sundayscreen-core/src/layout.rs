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

use crate::serde_util::lenient;

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

/// How far the text widget's own size knob may travel. Mirrored by hand in
/// `app/widgets/text/text-core.ts` — this is the authority.
pub const FONT_SCALE_MIN: f64 = 0.25;
pub const FONT_SCALE_MAX: f64 = 6.0;

/// Which way the timer counts. Serialised lowercase — part of the persisted
/// config vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "TimerMode.ts")]
#[serde(rename_all = "lowercase")]
pub enum TimerMode {
    #[default]
    Countdown,
    Stopwatch,
}

/// The clock widget's face.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ClockFace.ts")]
#[serde(rename_all = "lowercase")]
pub enum ClockFace {
    #[default]
    Digital,
    Analog,
}

/// The traffic light's lamps. Serialised lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "TrafficColor.ts")]
#[serde(rename_all = "lowercase")]
pub enum TrafficColor {
    /// The classroom's starting stance: silence.
    #[default]
    Red,
    Yellow,
    Green,
}

/// The work-mode symbols. Serialised lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "WorkMode.ts")]
#[serde(rename_all = "lowercase")]
pub enum WorkMode {
    #[default]
    Silent,
    Whisper,
    Collaborate,
    RaiseHand,
}

/// How the group generator counts. Serialised lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "GroupMode.ts")]
#[serde(rename_all = "lowercase")]
pub enum GroupMode {
    /// Split into N groups.
    #[default]
    Count,
    /// Split into groups of N.
    Size,
}

fn default_no_repeat() -> bool {
    true
}
fn default_draw_count() -> u32 {
    1
}
fn default_group_n() -> u32 {
    2
}
fn default_dice_count() -> u32 {
    1
}
fn default_dice_faces() -> u8 {
    6
}

/// Bounds for the group knob and the dice.
pub const GROUP_N_MIN: u32 = 2;
pub const GROUP_N_MAX: u32 = 30;
pub const DICE_MIN: u32 = 1;
pub const DICE_MAX: u32 = 3;

/// Every die type the widget offers, ASCENDING.
///
/// Deliberately NOT `pub`: `scripts/gen-limits.mjs` harvests `pub const`
/// SCALARS into `app/lib/limits.generated.ts` and has no notion of an array,
/// so a public one here would either be skipped in silence or make the parser
/// throw. The TypeScript side therefore mirrors this list BY HAND in
/// `app/widgets/dice/dice-core.ts` (`FACE_OPTIONS`), and both sides pin the
/// literal set in a test — [`dice_face_options_are_pinned`] here,
/// «FACE_OPTIONS speiler Rust-lista» there. Two pins, one set: the drift guard
/// the generator cannot give us.
const DICE_FACE_OPTIONS: [u8; 6] = [4, 6, 8, 10, 12, 20];

/// The nearest offered die type to `faces`; ties go to the LOWER one.
///
/// Snapping rather than rejecting is what keeps a config from a future version
/// (a d100, say) renderable at all: it degrades to the closest thing this
/// build can actually draw instead of costing the widget its settings.
fn snap_dice_faces(faces: u8) -> u8 {
    let mut best = DICE_FACE_OPTIONS[0];
    // Strict `<` over an ASCENDING list is what makes a tie resolve LOW:
    // 5 → 4, 7 → 6, 16 → 12. Pinned in `snapping_a_die_type_picks_the_nearest`.
    for &option in &DICE_FACE_OPTIONS[1..] {
        if faces.abs_diff(option) < faces.abs_diff(best) {
            best = option;
        }
    }
    best
}

/// The die's COLOUR FAMILY — the body tone a die is cut from. Serialised
/// lowercase; the spelling is persisted config vocabulary, so renaming a
/// variant is a broken database exactly like renaming a `kind`.
///
/// Six families and no more, because the point is telling three dice apart
/// on a projector at eight metres, not offering a colour picker. The names
/// are the FAMILY, never a token: `--die-red` and its ink live in
/// `app/styles/tokens.css`, and the material ramp mixes from there.
///
/// ⚠️ `Classic` is not «white». It is the warm off-white of a school die,
/// and it is the default because a teacher who never opens the appearance
/// panel must still get the die the widget has always drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "DieColor.ts")]
#[serde(rename_all = "lowercase")]
pub enum DieColor {
    #[default]
    Classic,
    Red,
    Blue,
    Green,
    Gold,
    Slate,
}

/// The die's FINISH — how the same family is shaded, edged and lettered.
/// Serialised lowercase, same persisted-vocabulary rule as [`DieColor`].
///
/// Colour and material are two axes ON PURPOSE (6 × 5, not 30 flat names):
/// «a red casino die» is how a teacher describes what she wants, and a flat
/// list would have made the panel a wall of thirty tiles nobody scans.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "DieMaterial.ts")]
#[serde(rename_all = "lowercase")]
pub enum DieMaterial {
    /// The ordinary school die: narrow tone ramp, soft edges, dark pips.
    #[default]
    Ivory,
    Casino,
    Wood,
    Metal,
    Glass,
}

/// How many names ONE draw may put on the board. The ceiling is a
/// READABILITY bound, not a technical one: the picker's minimum card is
/// 260×190 px, and six names stacked in it are smaller than the back row can
/// read — the whole point of drawing a name onto a projector.
pub const PICK_N_MIN: u32 = 1;
pub const PICK_N_MAX: u32 = 5;

fn default_timer_duration_ms() -> f64 {
    300_000.0 // 5 minutes
}
fn default_warn_at_ms() -> f64 {
    60_000.0
}
fn default_sound_on() -> bool {
    true
}

/// Shortest and longest countdown the config will persist.
pub const TIMER_MIN_MS: f64 = 5_000.0;
pub const TIMER_MAX_MS: f64 = 86_400_000.0; // 24 h

/// Where «Dagens time» gets its content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "AgendaSource.ts")]
#[serde(rename_all = "lowercase")]
pub enum AgendaSource {
    /// Bound to the planner: the widget shows today's current lesson.
    #[default]
    Planner,
    /// Free-standing items stored in the config.
    Manual,
}

/// One line of a manual agenda (planner-free mode).
///
/// ADR-007 applies one level DOWN as well: keys a NEWER version wrote on an
/// individual LINE survive this build's load→save cycle. Keep the whole item
/// when you edit one (`{ ...item, done: true }`), never rebuild it field by
/// field — a rebuilt line drops what this build cannot see.
// ⚠️ Rust-side consequence, deliberately not in the exported TSDoc: `extra`
// is part of the derived `PartialEq`, so two items differing only in a newer
// version's field are NOT equal. That is the point — "equal" would license
// overwriting a field this build cannot see. And unlike `WidgetConfig`, a
// list element is not internally tagged, so `extra` never receives a "kind"
// key and `clamp` has no tag to scrub down here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ManualAgendaItem.ts")]
#[serde(rename_all = "camelCase")]
pub struct ManualAgendaItem {
    pub id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub duration_min: Option<u32>,
    #[serde(default)]
    pub done: bool,
    /// Keys a NEWER version wrote on this item. `#[ts(skip)]` — the webview
    /// receives them inline and its `{ ...item }` spreads carry them back.
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Caps for the manual agenda (the planner-backed one is capped backend-side).
pub const MANUAL_AGENDA_MAX_ITEMS: usize = 30;
pub const MANUAL_AGENDA_TEXT_MAX_CHARS: usize = 500;

/// One line of the checklist widget. Like [`ManualAgendaItem`], a line keeps
/// the keys a NEWER version wrote on it — edit with `{ ...item, done }`,
/// never by rebuilding the object.
// Same Rust-side `PartialEq` consequence as `ManualAgendaItem`; see there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ChecklistItem.ts")]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub done: bool,
    /// Keys a NEWER version wrote on this item. `#[ts(skip)]` — the webview
    /// receives them inline and its `{ ...item }` spreads carry them back.
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Caps for the deadline and checklist widgets.
pub const DEADLINE_TITLE_MAX_CHARS: usize = 120;
pub const CHECKLIST_MAX_ITEMS: usize = 30;
pub const CHECKLIST_TEXT_MAX_CHARS: usize = 200;

/// Caps for the link widget. The title mirrors the deadline's cap — it is
/// TEXT, and text that outgrows its box is cut to fit.
pub const LINK_TITLE_MAX_CHARS: usize = 120;
/// The URL's ceiling, and it is a very different kind of ceiling: a URL is a
/// VALUE, not text. Over the cap it is CLEARED, never truncated — see
/// [`sanitized_url`].
pub const LINK_URL_MAX_CHARS: usize = 2000;

/// Per-kind widget configuration. The serde tag IS the `kind` column value —
/// a renamed variant is a broken database.
///
/// Adding a widget kind = one variant here (+ default + clamp arm) + one
/// frontend folder + one registry line. Nothing else.
///
/// Every variant carries a flattened `extra` map (ADR-007): fields a NEWER
/// version wrote into a KNOWN kind survive this build's load→save cycle
/// instead of being silently dropped. `#[ts(skip)]` keeps the TS types
/// unchanged — the webview receives the unknown keys inline and its
/// `{ ...cfg }` spreads carry them back untouched.
///
/// ADR-007 covered unknown FIELDS; unknown VALUES fell straight through it.
/// An enum-valued field this build cannot spell now costs THAT FIELD ONLY —
/// it reads as the field's default, and everything beside it survives.
// The mechanism, and its honest limit. Every enum-typed field carries
// `#[serde(default, deserialize_with = "lenient")]`. Be clear about what that
// buys: it does NOT preserve the value. A `"mode":"focus"` written by some
// later version deserialises to this build's default, and a later save writes
// the DEFAULT back — the spelling is gone either way. What it saves is
// everything AROUND it. Without the guard, one unreadable enum spelling fails
// the whole `WidgetConfig`, `row_to_instance`'s `from_str(..).ok()` answers
// with `default_for(kind)`, and `content` / `last_drawn` / `last_result` /
// `items` / the `extra` buffer are all reset on screen — then written to disk
// by the first edit the teacher makes. Damage control, not preservation.
//
// The two attributes cover different roads and BOTH are load-bearing:
// `default` answers an absent key (serde never calls `lenient` then),
// `lenient` answers a present-but-unreadable one. Both end at the field's
// default, which is the invariant the tests pin.
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
        #[serde(default, deserialize_with = "lenient")]
        align: TextAlign,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    Clock {
        #[serde(default, deserialize_with = "lenient")]
        face: ClockFace,
        #[serde(default)]
        show_seconds: bool,
        #[serde(default)]
        show_date: bool,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    Timer {
        #[serde(default = "default_timer_duration_ms")]
        duration_ms: f64,
        #[serde(default = "default_warn_at_ms")]
        warn_at_ms: f64,
        #[serde(default = "default_sound_on")]
        sound_on: bool,
        #[serde(default, deserialize_with = "lenient")]
        mode: TimerMode,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// The picker persists the last drawn NAMES (display strings, not member
    /// ids — the pupil may be edited away later, the screen memory stays
    /// honest).
    ///
    /// `last_drawn` and `last_drawn_many` are BOTH written, and the
    /// duplication is the point. Widening `last_drawn` from
    /// `Option<String>` to a list would have cost an older build the WHOLE
    /// config: a type error fails the entire `WidgetConfig` parse,
    /// `row_to_instance`'s `from_str(..).ok()` answers with
    /// `default_for(kind)`, so `no_repeat` flips back to true, the ADR-007
    /// `extra` buffer empties — and the first edit the teacher makes writes
    /// that loss to disk. Added ALONGSIDE, the two new keys are ordinary
    /// unknown FIELDS to an older build: they land in `extra` and come back
    /// out of its load→save untouched. `last_drawn` carries the FIRST name
    /// of the draw, so an older build still shows something true.
    NamePicker {
        #[serde(default = "default_no_repeat")]
        no_repeat: bool,
        #[serde(default)]
        last_drawn: Option<String>,
        /// The whole draw, in draw order. Empty in a config written before
        /// multi-draw existed — the widget falls back to `last_drawn` there,
        /// which is what keeps promise 2 across the upgrade.
        #[serde(default)]
        last_drawn_many: Vec<String>,
        /// How many names the next draw asks for, 1..=[`PICK_N_MAX`].
        #[serde(default = "default_draw_count")]
        draw_count: u32,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    Groups {
        #[serde(default, deserialize_with = "lenient")]
        mode: GroupMode,
        #[serde(default = "default_group_n")]
        n: u32,
        /// The last split, as NAMES — restored on boot so the class walks in
        /// to the same groups the projector showed yesterday.
        #[serde(default)]
        last_result: Vec<Vec<String>>,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// The dice. `faces` is the die TYPE — one of 4, 6, 8, 10, 12, 20.
    ///
    /// ⚠️ The honest ADR-003 accounting for this field: a v0.3 client (which
    /// has no `faces`) reading a d20 config keeps the number — it lands in
    /// `extra` and is written back untouched, so the die type SURVIVES the
    /// downgrade. What does not survive is a ROLL: that build's clamp pins
    /// every `last_roll` entry to 1..=6, so a persisted 17 is rewritten as a
    /// 6 and the newer build reads back a lie. Value DISTORTION, not data
    /// loss — worth naming, because «the extra map protects everything» is
    /// the easy assumption and it is not true of a field an older clamp
    /// already has an opinion about.
    Dice {
        #[serde(default = "default_dice_count")]
        count: u32,
        #[serde(default = "default_dice_faces")]
        faces: u8,
        /// The REAL ten-sided classroom die reads 0–9, not 1–10 (opposite
        /// faces sum to 9): same body, the «10» face printed as a «0». Only
        /// the d10 carries this flag — `normalize` clears it on every other
        /// type, so the pair (faces, zero_based) IS the die type and there is
        /// no such thing as a zero-based d6 in a stored layout.
        ///
        /// Downgrade accounting, same family as the `faces` note above: on a
        /// pre-0.5.1 build the flag itself survives in `extra`, but that
        /// build's roll clamp pins values to 1..=faces, so a persisted 0 is
        /// rewritten as a 1 — value distortion, not data loss.
        #[serde(default)]
        zero_based: bool,
        #[serde(default)]
        last_roll: Vec<u8>,
        /// The colour family and the finish — APPEARANCE, not protocol. A
        /// roll stays true across a re-colour, which is why neither field
        /// clears `last_roll` the way `faces` does.
        #[serde(default, deserialize_with = "lenient")]
        color: DieColor,
        #[serde(default, deserialize_with = "lenient")]
        material: DieMaterial,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    TrafficLight {
        #[serde(default, deserialize_with = "lenient")]
        active: TrafficColor,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    WorkSymbol {
        #[serde(default, deserialize_with = "lenient")]
        mode: WorkMode,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// «Dagens time» — the lesson's agenda, planner-bound or manual. The
    /// pin is the teacher's manual override of the clock-driven now-marker;
    /// persisted so a restart mid-lesson restores the exact screen.
    Agenda {
        #[serde(default, deserialize_with = "lenient")]
        source: AgendaSource,
        #[serde(default = "default_true_flag")]
        show_times: bool,
        #[serde(default)]
        manual_items: Vec<ManualAgendaItem>,
        #[serde(default)]
        pinned_item_id: Option<String>,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// «Frist» — a long-horizon countdown in days/hours to a wall date.
    /// `target_epoch_ms = 0.0` is the honest "not set yet" state (clamp is
    /// pure and cannot know `now`, so there is no now-relative default).
    Deadline {
        #[serde(default)]
        title: String,
        #[serde(default)]
        target_epoch_ms: f64,
        #[serde(default = "default_true_flag")]
        show_hours: bool,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// «Sjekkliste» — big check-off rows; checked state is config, so a
    /// restart restores it exactly.
    Checklist {
        #[serde(default)]
        items: Vec<ChecklistItem>,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// «Dagen i dag» — date, today's lessons and messages.
    Today {
        #[serde(default = "default_true_flag")]
        show_lessons: bool,
        #[serde(default = "default_true_flag")]
        show_notes: bool,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// «Lenke» — a titled address the class can reach: the teacher clicks it
    /// open on the board, the pupils scan the QR on their own devices.
    ///
    /// `url = ""` is the honest "not set yet" state (the deadline's
    /// `target_epoch_ms = 0.0` precedent) — and it is also where every URL
    /// this build refuses to vouch for ends up, because [`sanitized_url`]
    /// CLEARS rather than repairs.
    Link {
        #[serde(default)]
        title: String,
        #[serde(default)]
        url: String,
        #[serde(default = "default_true_flag")]
        show_qr: bool,
        #[serde(flatten)]
        #[ts(skip)]
        extra: serde_json::Map<String, serde_json::Value>,
    },
}

fn default_true_flag() -> bool {
    true
}

/// Cap one persisted pupil name at [`crate::members::NAME_MAX_CHARS`],
/// counting CODEPOINTS the way `members::clean_name` does — the picker and
/// the group generator both store names, and they must cut them the same
/// way the name list itself did.
fn cap_name(name: &mut String) {
    if name.chars().count() > crate::members::NAME_MAX_CHARS {
        *name = name.chars().take(crate::members::NAME_MAX_CHARS).collect();
    }
}

/// Does `s` begin with `scheme`, ignoring ASCII case? Byte-wise on purpose:
/// URL schemes are ASCII by definition, `eq_ignore_ascii_case` cannot be
/// fooled by a Unicode case fold (`JaVaScRiPt:` is caught, and a Kelvin sign
/// never becomes a `k`), and slicing a BYTE slice needs no char boundary.
fn starts_with_scheme(s: &str, scheme: &str) -> bool {
    let n = scheme.len();
    s.len() > n && s.as_bytes()[..n].eq_ignore_ascii_case(scheme.as_bytes())
}

/// The ONE rule for a link widget's URL — the whole value is judged, and it
/// either stands byte-for-byte or it is thrown away. `Some` carries the
/// trimmed, accepted address; `None` means "this is not an address this app
/// will vouch for".
///
/// Two call sites, deliberately, and the second is not redundant:
/// - [`WidgetConfig::clamp`], which every load and every save runs, so a
///   hostile transfer file or a hand-edited database can never put a
///   `javascript:` URI on the screen; and
/// - `link_open` in the Tauri shell, the gate that hands a string to the
///   system browser. Transfer import writes widget configs RAW (it never
///   round-trips them through this type), so the open gate cannot assume the
///   clamp has already run on the bytes it is about to read. Defence in
///   depth with a single spelling of the rule.
///
/// The rule, in order:
/// 1. Trim the ends. Whitespace around a pasted address carries no content,
///    and a teacher who pastes ` https://udir.no ` meant the address.
/// 2. Only `http://` and `https://` (ASCII-case-insensitively), and there
///    must be something after the scheme. Everything else — `javascript:`,
///    `data:`, `file:`, `vbscript:`, a relative path, the empty string — is
///    refused. This is the whole security value of the function.
/// 3. NO control character anywhere in the trimmed value. A CR or LF inside
///    a URL is smuggling, never a teacher's link.
/// 4. Over [`LINK_URL_MAX_CHARS`] codepoints the value is REFUSED, not cut.
///    This is the one place the widget's caps stop being "trim to fit", and
///    the reason is worth spelling out: a truncated URL is a DIFFERENT
///    resource wearing the same title. `https://skole.no/oppgaver/kapittel-4`
///    cut mid-path can be a valid page about something else entirely, and the
///    board would present it under the label the teacher wrote. An empty
///    field says "not set", which is true; a shortened URL says something
///    false.
///
/// Note what is NOT done: nothing is stripped OUT of the middle of the
/// value. Removing "illegal" characters and keeping the rest is how a
/// scrubber smuggles content past its own check; the whole value passes or
/// the whole value goes.
pub fn sanitized_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if !(starts_with_scheme(trimmed, "http://") || starts_with_scheme(trimmed, "https://")) {
        return None;
    }
    if trimmed.chars().any(char::is_control) {
        return None;
    }
    if trimmed.chars().count() > LINK_URL_MAX_CHARS {
        return None;
    }
    Some(trimmed.to_string())
}

impl WidgetConfig {
    /// The `kind` column value for this config — the serde tag, spelled once.
    pub fn kind(&self) -> &'static str {
        match self {
            WidgetConfig::Text { .. } => "text",
            WidgetConfig::Clock { .. } => "clock",
            WidgetConfig::Timer { .. } => "timer",
            WidgetConfig::NamePicker { .. } => "namepicker",
            WidgetConfig::Groups { .. } => "groups",
            WidgetConfig::Dice { .. } => "dice",
            WidgetConfig::TrafficLight { .. } => "trafficlight",
            WidgetConfig::WorkSymbol { .. } => "worksymbol",
            WidgetConfig::Agenda { .. } => "agenda",
            WidgetConfig::Deadline { .. } => "deadline",
            WidgetConfig::Checklist { .. } => "checklist",
            WidgetConfig::Today { .. } => "today",
            WidgetConfig::Link { .. } => "link",
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
                extra: Default::default(),
            }),
            "clock" => Some(WidgetConfig::Clock {
                face: ClockFace::default(),
                show_seconds: false,
                show_date: false,
                extra: Default::default(),
            }),
            "timer" => Some(WidgetConfig::Timer {
                duration_ms: default_timer_duration_ms(),
                warn_at_ms: default_warn_at_ms(),
                sound_on: default_sound_on(),
                mode: TimerMode::default(),
                extra: Default::default(),
            }),
            "namepicker" => Some(WidgetConfig::NamePicker {
                no_repeat: default_no_repeat(),
                last_drawn: None,
                last_drawn_many: Vec::new(),
                draw_count: default_draw_count(),
                extra: Default::default(),
            }),
            "groups" => Some(WidgetConfig::Groups {
                mode: GroupMode::default(),
                n: default_group_n(),
                last_result: Vec::new(),
                extra: Default::default(),
            }),
            "dice" => Some(WidgetConfig::Dice {
                count: default_dice_count(),
                faces: default_dice_faces(),
                zero_based: false,
                last_roll: Vec::new(),
                color: DieColor::default(),
                material: DieMaterial::default(),
                extra: Default::default(),
            }),
            "trafficlight" => Some(WidgetConfig::TrafficLight {
                active: TrafficColor::default(),
                extra: Default::default(),
            }),
            "worksymbol" => Some(WidgetConfig::WorkSymbol {
                mode: WorkMode::default(),
                extra: Default::default(),
            }),
            "deadline" => Some(WidgetConfig::Deadline {
                title: String::new(),
                target_epoch_ms: 0.0,
                show_hours: true,
                extra: Default::default(),
            }),
            "checklist" => Some(WidgetConfig::Checklist {
                items: Vec::new(),
                extra: Default::default(),
            }),
            "agenda" => Some(WidgetConfig::Agenda {
                source: AgendaSource::default(),
                show_times: true,
                manual_items: Vec::new(),
                pinned_item_id: None,
                extra: Default::default(),
            }),
            "today" => Some(WidgetConfig::Today {
                show_lessons: true,
                show_notes: true,
                extra: Default::default(),
            }),
            "link" => Some(WidgetConfig::Link {
                title: String::new(),
                url: String::new(),
                show_qr: true,
                extra: Default::default(),
            }),
            _ => None,
        }
    }

    /// The ADR-007 flatten map: fields this build does not know.
    fn extra_mut(&mut self) -> &mut serde_json::Map<String, serde_json::Value> {
        match self {
            WidgetConfig::Text { extra, .. }
            | WidgetConfig::Clock { extra, .. }
            | WidgetConfig::Timer { extra, .. }
            | WidgetConfig::NamePicker { extra, .. }
            | WidgetConfig::Groups { extra, .. }
            | WidgetConfig::Dice { extra, .. }
            | WidgetConfig::TrafficLight { extra, .. }
            | WidgetConfig::WorkSymbol { extra, .. }
            | WidgetConfig::Agenda { extra, .. }
            | WidgetConfig::Deadline { extra, .. }
            | WidgetConfig::Checklist { extra, .. }
            | WidgetConfig::Today { extra, .. }
            | WidgetConfig::Link { extra, .. } => extra,
        }
    }

    /// Clamp every field into its legal range, in place. Idempotent.
    pub fn clamp(&mut self) {
        // The internally-tagged deserializer leaves the tag key itself in the
        // flatten map — scrub it so `extra` holds only truly-unknown fields
        // (and serialisation never emits a duplicate "kind").
        self.extra_mut().remove("kind");
        match self {
            WidgetConfig::Text {
                content,
                font_scale,
                ..
            } => {
                if !font_scale.is_finite() {
                    *font_scale = default_font_scale();
                }
                *font_scale = font_scale.clamp(FONT_SCALE_MIN, FONT_SCALE_MAX);
                if content.chars().count() > TEXT_CONTENT_MAX_CHARS {
                    *content = content.chars().take(TEXT_CONTENT_MAX_CHARS).collect();
                }
            }
            WidgetConfig::Clock { .. } => {}
            WidgetConfig::Timer {
                duration_ms,
                warn_at_ms,
                ..
            } => {
                if !duration_ms.is_finite() {
                    *duration_ms = default_timer_duration_ms();
                }
                *duration_ms = duration_ms.clamp(TIMER_MIN_MS, TIMER_MAX_MS);
                if !warn_at_ms.is_finite() {
                    *warn_at_ms = default_warn_at_ms();
                }
                *warn_at_ms = warn_at_ms.clamp(0.0, *duration_ms);
            }
            WidgetConfig::NamePicker {
                last_drawn,
                last_drawn_many,
                draw_count,
                ..
            } => {
                if let Some(name) = last_drawn {
                    cap_name(name);
                }
                *draw_count = (*draw_count).clamp(PICK_N_MIN, PICK_N_MAX);
                // Groups' precedent for a persisted Vec: cut the list to its
                // ceiling FIRST, then cap every entry. A config that arrived
                // with fifty names in it cannot make the board render fifty.
                last_drawn_many.truncate(PICK_N_MAX as usize);
                for name in last_drawn_many.iter_mut() {
                    cap_name(name);
                }
            }
            WidgetConfig::Groups { n, last_result, .. } => {
                *n = (*n).clamp(GROUP_N_MIN, GROUP_N_MAX);
                last_result.truncate(GROUP_N_MAX as usize);
                for group in last_result.iter_mut() {
                    group.truncate(crate::members::MEMBERS_MAX);
                    for name in group.iter_mut() {
                        cap_name(name);
                    }
                }
            }
            WidgetConfig::Dice {
                count,
                faces,
                zero_based,
                last_roll,
                ..
            } => {
                *count = (*count).clamp(DICE_MIN, DICE_MAX);
                // The die TYPE first — the roll's ceiling is derived from it,
                // so snapping after the roll clamp would validate a 20 against
                // a type that is about to become a 12.
                *faces = snap_dice_faces(*faces);
                // The 0–9 face set exists on the d10 alone; on any other body
                // the flag is a stray a future or foreign writer left behind,
                // and clearing it HERE is what lets every reader treat
                // (faces, zero_based) as the die type without re-checking.
                if *faces != 10 {
                    *zero_based = false;
                }
                last_roll.truncate(DICE_MAX as usize);
                let (lo, hi) = if *zero_based {
                    (0, *faces - 1)
                } else {
                    (1, *faces)
                };
                for v in last_roll.iter_mut() {
                    *v = (*v).clamp(lo, hi);
                }
                // `color` and `material` add NO lines here, and that is the
                // difference between an enum and a number — worth saying out
                // loud, because `faces` sits three lines up and does need
                // one. `faces` is a `u8`: every value in 0..=255 parses, so
                // 100 arrives whole and only `snap_dice_faces` stops the
                // widget being asked to draw a d100. An enum has no
                // out-of-range value to arrive with — a spelling this build
                // cannot read never becomes a `DieColor` at all; `lenient`
                // already turned it into `Classic` at the deserialiser, one
                // layer BELOW the clamp. Adding a defensive arm here would be
                // dead code that reads like a guarantee.
            }
            WidgetConfig::TrafficLight { .. } => {}
            WidgetConfig::WorkSymbol { .. } => {}
            WidgetConfig::Agenda { manual_items, .. } => {
                manual_items.truncate(MANUAL_AGENDA_MAX_ITEMS);
                for item in manual_items.iter_mut() {
                    if item.text.chars().count() > MANUAL_AGENDA_TEXT_MAX_CHARS {
                        item.text = item
                            .text
                            .chars()
                            .take(MANUAL_AGENDA_TEXT_MAX_CHARS)
                            .collect();
                    }
                    item.duration_min = item.duration_min.map(|d| {
                        d.clamp(
                            crate::schedule::AGENDA_DURATION_MIN,
                            crate::schedule::AGENDA_DURATION_MAX,
                        )
                    });
                }
            }
            WidgetConfig::Deadline {
                title,
                target_epoch_ms,
                ..
            } => {
                if title.chars().count() > DEADLINE_TITLE_MAX_CHARS {
                    *title = title.chars().take(DEADLINE_TITLE_MAX_CHARS).collect();
                }
                if !target_epoch_ms.is_finite() || *target_epoch_ms < 0.0 {
                    *target_epoch_ms = 0.0;
                }
            }
            WidgetConfig::Checklist { items, .. } => {
                items.truncate(CHECKLIST_MAX_ITEMS);
                for item in items.iter_mut() {
                    if item.text.chars().count() > CHECKLIST_TEXT_MAX_CHARS {
                        item.text = item.text.chars().take(CHECKLIST_TEXT_MAX_CHARS).collect();
                    }
                }
            }
            WidgetConfig::Today { .. } => {}
            WidgetConfig::Link { title, url, .. } => {
                if title.chars().count() > LINK_TITLE_MAX_CHARS {
                    *title = title.chars().take(LINK_TITLE_MAX_CHARS).collect();
                }
                // Two caps, two different verbs, three lines apart — and that
                // is the point. The title is TEXT and is cut to fit; the URL
                // is a VALUE and is dropped whole. See `sanitized_url`.
                *url = sanitized_url(url).unwrap_or_default();
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
            extra: Default::default(),
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
            extra: Default::default(),
        };
        c.clamp();
        let WidgetConfig::Text {
            content,
            font_scale,
            ..
        } = c
        else {
            panic!("still a text config");
        };
        assert_eq!(content.chars().count(), TEXT_CONTENT_MAX_CHARS);
        assert_eq!(font_scale, 1.0);

        let mut big = WidgetConfig::Text {
            content: String::new(),
            font_scale: 99.0,
            align: TextAlign::Left,
            extra: Default::default(),
        };
        big.clamp();
        let WidgetConfig::Text { font_scale, .. } = big else {
            panic!("still a text config");
        };
        assert_eq!(font_scale, FONT_SCALE_MAX);

        let mut small = WidgetConfig::Text {
            content: String::new(),
            font_scale: 0.01,
            align: TextAlign::Left,
            extra: Default::default(),
        };
        small.clamp();
        let WidgetConfig::Text { font_scale, .. } = small else {
            panic!("still a text config");
        };
        assert_eq!(font_scale, FONT_SCALE_MIN);
    }

    #[test]
    fn timer_clamp_bounds_duration_and_warn() {
        let mut t = WidgetConfig::Timer {
            duration_ms: f64::NAN,
            warn_at_ms: 999_999_999.0,
            sound_on: true,
            mode: TimerMode::Countdown,
            extra: Default::default(),
        };
        t.clamp();
        let WidgetConfig::Timer {
            duration_ms,
            warn_at_ms,
            ..
        } = t
        else {
            panic!("still a timer config");
        };
        assert_eq!(duration_ms, 300_000.0, "NaN takes the default");
        assert!(warn_at_ms <= duration_ms, "warn can never exceed duration");

        let mut tiny = WidgetConfig::Timer {
            duration_ms: 1.0,
            warn_at_ms: 0.0,
            sound_on: false,
            mode: TimerMode::Stopwatch,
            extra: Default::default(),
        };
        tiny.clamp();
        let WidgetConfig::Timer { duration_ms, .. } = tiny else {
            panic!("still a timer config");
        };
        assert_eq!(duration_ms, TIMER_MIN_MS);
    }

    #[test]
    fn clock_and_timer_kinds_round_trip_defaults() {
        for kind in ["clock", "timer", "link"] {
            let cfg = WidgetConfig::default_for(kind).expect(kind);
            assert_eq!(cfg.kind(), kind);
            let json = serde_json::to_string(&cfg).unwrap();
            assert_eq!(
                serde_json::from_str::<WidgetConfig>(&json).unwrap(),
                cfg,
                "{kind} default survives a JSON round-trip"
            );
        }
    }

    #[test]
    fn partial_config_json_takes_field_defaults() {
        let inst = row_to_instance("w1", "text", 0.1, 0.1, 0.3, 0.2, 0, r#"{"kind":"text"}"#)
            .expect("partial config is fine");
        let WidgetConfig::Text {
            content,
            font_scale,
            align,
            ..
        } = inst.config
        else {
            panic!("kind column said text");
        };
        assert_eq!(content, "");
        assert_eq!(font_scale, 1.0);
        assert_eq!(align, TextAlign::Center);
    }

    /// ADR-007: fields a NEWER version added to a KNOWN kind must survive
    /// this build's parse→clamp→serialise cycle — not be silently dropped.
    #[test]
    fn unknown_fields_in_a_known_kind_survive_a_round_trip() {
        let json = r#"{"kind":"text","content":"hei","futureField":{"nested":[1,2]},"otherNew":7}"#;
        let mut cfg: WidgetConfig = serde_json::from_str(json).expect("known kind parses");
        cfg.clamp();
        let out = serde_json::to_value(&cfg).expect("serialises");
        assert_eq!(out["futureField"], serde_json::json!({ "nested": [1, 2] }));
        assert_eq!(out["otherNew"], serde_json::json!(7));
        assert_eq!(out["content"], serde_json::json!("hei"));
        assert_eq!(out["kind"], serde_json::json!("text"));
    }

    // ── The picker's multi-draw fields, and the downgrade they were shaped
    //    around ────────────────────────────────────────────────────────────

    /// This build's own cycle: a config carrying the two new keys AND an
    /// unknown one comes back out of parse→clamp→serialise whole.
    #[test]
    fn a_multi_draw_picker_config_survives_a_round_trip() {
        let json = r#"{"kind":"namepicker","noRepeat":false,"lastDrawn":"Kari",
            "lastDrawnMany":["Kari","Ola","Per"],"drawCount":3,"futureNote":7}"#;
        let mut cfg: WidgetConfig = serde_json::from_str(json).expect("known kind parses");
        cfg.clamp();
        let out = serde_json::to_value(&cfg).expect("serialises");
        assert_eq!(out["lastDrawn"], serde_json::json!("Kari"));
        assert_eq!(
            out["lastDrawnMany"],
            serde_json::json!(["Kari", "Ola", "Per"])
        );
        assert_eq!(out["drawCount"], serde_json::json!(3));
        assert_eq!(out["noRepeat"], serde_json::json!(false));
        assert_eq!(out["futureNote"], serde_json::json!(7), "ADR-007 still");
        assert_eq!(out["kind"], serde_json::json!("namepicker"));
    }

    /// The reason `last_drawn` was KEPT rather than widened (R4 risk #3).
    ///
    /// This is the older build, spelled out as it actually is: a picker that
    /// knows `noRepeat` and `lastDrawn` and buffers everything else in the
    /// ADR-007 flatten map. Handed a config written by THIS build it must
    /// (a) still find a name to show, and (b) hand `lastDrawnMany` /
    /// `drawCount` straight back on its next save. Had the field been
    /// widened to a list instead, the type error would have failed the whole
    /// parse and `row_to_instance` would have answered `default_for` — the
    /// exact loss this shape exists to avoid.
    #[test]
    fn an_older_build_shows_a_name_and_hands_the_new_keys_back() {
        #[derive(Debug, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct OldNamePicker {
            #[serde(default = "default_no_repeat")]
            no_repeat: bool,
            #[serde(default)]
            last_drawn: Option<String>,
            #[serde(flatten)]
            extra: serde_json::Map<String, serde_json::Value>,
        }

        let mut fresh = WidgetConfig::NamePicker {
            no_repeat: false,
            last_drawn: Some("Kari".into()),
            last_drawn_many: vec!["Kari".into(), "Ola".into(), "Per".into()],
            draw_count: 3,
            extra: Default::default(),
        };
        fresh.clamp();
        let written = serde_json::to_string(&fresh).expect("serialises");

        let old: OldNamePicker = serde_json::from_str(&written).expect("the old parse SUCCEEDS");
        assert_eq!(
            old.last_drawn.as_deref(),
            Some("Kari"),
            "the older board still shows the first name of the draw"
        );
        assert!(!old.no_repeat, "and its own settings are untouched");

        let back = serde_json::to_value(&old).expect("the old build saves");
        assert_eq!(
            back["lastDrawnMany"],
            serde_json::json!(["Kari", "Ola", "Per"])
        );
        assert_eq!(back["drawCount"], serde_json::json!(3));

        // …and the round trip is closed: what the older build wrote parses
        // back here with the whole draw intact.
        let mut again: WidgetConfig =
            serde_json::from_str(&back.to_string()).expect("this build re-reads it");
        again.clamp();
        assert_eq!(again, fresh);
    }

    #[test]
    fn the_draw_count_and_the_drawn_list_are_clamped() {
        let long = "æ".repeat(crate::members::NAME_MAX_CHARS + 50);
        let mut cfg = WidgetConfig::NamePicker {
            no_repeat: true,
            last_drawn: Some(long.clone()),
            last_drawn_many: (0..PICK_N_MAX + 4).map(|i| format!("Elev {i}")).collect(),
            draw_count: 99,
            extra: Default::default(),
        };
        cfg.clamp();
        let WidgetConfig::NamePicker {
            last_drawn,
            last_drawn_many,
            draw_count,
            ..
        } = &cfg
        else {
            panic!("still a picker");
        };
        assert_eq!(*draw_count, PICK_N_MAX);
        assert_eq!(last_drawn_many.len(), PICK_N_MAX as usize);
        assert_eq!(
            last_drawn.as_ref().unwrap().chars().count(),
            crate::members::NAME_MAX_CHARS
        );

        // Every entry in the list is capped too, not just the single name.
        let mut cfg = WidgetConfig::NamePicker {
            no_repeat: true,
            last_drawn: None,
            last_drawn_many: vec![long],
            draw_count: 0,
            extra: Default::default(),
        };
        cfg.clamp();
        let WidgetConfig::NamePicker {
            last_drawn_many,
            draw_count,
            ..
        } = &cfg
        else {
            panic!("still a picker");
        };
        assert_eq!(*draw_count, PICK_N_MIN, "zero is not a draw");
        assert_eq!(
            last_drawn_many[0].chars().count(),
            crate::members::NAME_MAX_CHARS
        );
    }

    /// THE DRIFT PIN (Rust half). `DICE_FACE_OPTIONS` is an array, which
    /// `scripts/gen-limits.mjs` cannot harvest — so the set is spelled twice,
    /// here and in `app/widgets/dice/dice-core.ts`. Both spellings are pinned
    /// to the same literal list; changing the offer means changing both, and
    /// forgetting one is a red test rather than a d20 the frontend draws and
    /// the backend snaps back to a d12.
    #[test]
    fn dice_face_options_are_pinned() {
        assert_eq!(
            DICE_FACE_OPTIONS,
            [4, 6, 8, 10, 12, 20],
            "mirrored by hand in app/widgets/dice/dice-core.ts (FACE_OPTIONS)"
        );
        assert!(
            DICE_FACE_OPTIONS.windows(2).all(|w| w[0] < w[1]),
            "snap_dice_faces resolves ties LOW by scanning an ascending list"
        );
        assert!(
            DICE_FACE_OPTIONS.contains(&default_dice_faces()),
            "the default die type has to be an offered one"
        );
    }

    /// Nearest wins; a tie goes to the LOWER type. The tie rule is a CHOICE
    /// (5 is exactly as far from 4 as from 6) and therefore has to be pinned:
    /// without it, a refactor could flip 5 → 6 and quietly change what a
    /// future version's config degrades into.
    #[test]
    fn snapping_a_die_type_picks_the_nearest() {
        let cases = [
            (0u8, 4u8),
            (1, 4),
            (3, 4),
            (4, 4),
            (5, 4), // tie 4/6 → low
            (6, 6), // already offered
            (7, 6), // tie 6/8 → low
            (8, 8),
            (9, 8), // tie 8/10 → low
            (10, 10),
            (11, 10), // tie 10/12 → low
            (12, 12),
            (13, 12),
            (16, 12), // tie 12/20 → low
            (17, 20),
            (20, 20),
            (100, 20),
            (255, 20),
        ];
        for (raw, expected) in cases {
            assert_eq!(snap_dice_faces(raw), expected, "snapping d{raw}");
        }
    }

    /// The die type and the roll are clamped TOGETHER: the roll's ceiling is
    /// whatever `faces` snapped to, not a hardcoded 6.
    #[test]
    fn the_die_type_and_the_roll_are_clamped_together() {
        let clamped = |faces: u8, last_roll: Vec<u8>| {
            let mut cfg = WidgetConfig::Dice {
                count: 99,
                faces,
                zero_based: false,
                last_roll,
                color: DieColor::default(),
                material: DieMaterial::default(),
                extra: Default::default(),
            };
            cfg.clamp();
            let WidgetConfig::Dice {
                count,
                faces,
                last_roll,
                ..
            } = cfg
            else {
                panic!("still dice");
            };
            (count, faces, last_roll)
        };

        // A d20 keeps a 17 that a 1..=6 clamp would have flattened.
        assert_eq!(
            clamped(20, vec![17, 0, 21, 99]),
            (DICE_MAX, 20, vec![17, 1, 20]),
            "count capped, list truncated to DICE_MAX, values bounded by faces"
        );
        // A d4 does not: 6 is off ITS die.
        assert_eq!(clamped(4, vec![6]), (DICE_MAX, 4, vec![4]));
        // And the snap happens FIRST — a d17 becomes a d20, so 17 stands.
        assert_eq!(clamped(17, vec![17]), (DICE_MAX, 20, vec![17]));
        // …while a d16 becomes a d12 and the same roll is cut down.
        assert_eq!(clamped(16, vec![17]), (DICE_MAX, 12, vec![12]));
        // Idempotent, like every other arm.
        let once = clamped(16, vec![17]);
        let mut cfg = WidgetConfig::Dice {
            count: once.0,
            faces: once.1,
            zero_based: false,
            last_roll: once.2.clone(),
            color: DieColor::default(),
            material: DieMaterial::default(),
            extra: Default::default(),
        };
        cfg.clamp();
        assert_eq!(
            serde_json::to_value(&cfg).unwrap()["faces"],
            serde_json::json!(12)
        );
    }

    /// The 0–9 die: the flag lives on the d10 alone, and the roll clamp
    /// follows the face set — a stored 0 is a real answer there, not an
    /// underflow to round up.
    #[test]
    fn the_zero_based_die_keeps_its_zero_and_no_other_type_keeps_the_flag() {
        let clamped = |faces: u8, zero_based: bool, last_roll: Vec<u8>| {
            let mut cfg = WidgetConfig::Dice {
                count: 1,
                faces,
                zero_based,
                last_roll,
                color: DieColor::default(),
                material: DieMaterial::default(),
                extra: Default::default(),
            };
            cfg.clamp();
            let WidgetConfig::Dice {
                faces,
                zero_based,
                last_roll,
                ..
            } = cfg
            else {
                panic!("still dice");
            };
            (faces, zero_based, last_roll)
        };

        // The whole point: 0 survives on the 0–9 die, and 10 is off it.
        assert_eq!(clamped(10, true, vec![0, 9, 10]), (10, true, vec![0, 9, 9]));
        // Without the flag the 1..=10 rule stands, 0 and all.
        assert_eq!(clamped(10, false, vec![0, 10]), (10, false, vec![1, 10]));
        // A stray flag on any other body is cleared, and the roll is clamped
        // by the rule that survives — snap first, flag next, values last.
        assert_eq!(clamped(6, true, vec![0]), (6, false, vec![1]));
        assert_eq!(clamped(16, true, vec![0]), (12, false, vec![1]));
        // THE ORDER PIN. Every case above answers the same whether the flag
        // is judged before or after the snap — a d11 is the one input that
        // tells them apart: snapped first it IS a d10 and the flag stands.
        // The TS read-seam mirrors (`snapFaces(faces) === 10` in DiceWidget
        // and DieLookMenu) lean on exactly this order, so a reorder here
        // would go green through every other case and split the tiers.
        assert_eq!(clamped(11, true, vec![0]), (10, true, vec![0]));

        // Absent in old JSON ⇒ false: yesterday's d10 is still 1–10.
        let cfg: WidgetConfig =
            serde_json::from_str(r#"{"kind":"dice","faces":10,"lastRoll":[10]}"#).unwrap();
        let WidgetConfig::Dice { zero_based, .. } = cfg else {
            panic!("still dice");
        };
        assert!(!zero_based);
    }

    /// A v0.3 config has no `faces` at all. It must read as a d6 — the type
    /// the whole widget was until now — and NOT as a zero that snaps to d4.
    #[test]
    fn a_config_without_a_die_type_reads_as_a_d6() {
        let mut cfg: WidgetConfig =
            serde_json::from_str(r#"{"kind":"dice","count":2,"lastRoll":[3,5]}"#).unwrap();
        cfg.clamp();
        let out = serde_json::to_value(&cfg).unwrap();
        assert_eq!(out["faces"], serde_json::json!(6));
        assert_eq!(out["lastRoll"], serde_json::json!([3, 5]));

        let WidgetConfig::Dice { faces, .. } = WidgetConfig::default_for("dice").unwrap() else {
            panic!("still dice");
        };
        assert_eq!(faces, 6, "and a freshly added die is a d6");
    }

    /// The whole trip a d20 takes through the row seam: parse, clamp,
    /// re-serialise — with a field only a NEWER version knows riding along
    /// untouched (ADR-003/ADR-007 for the widget this round changed).
    #[test]
    fn a_d20_survives_the_row_seam_with_an_unknown_field() {
        let inst = row_to_instance(
            "w1",
            "dice",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"dice","count":3,"faces":20,"lastRoll":[17,4,20],"futureColour":"gold"}"#,
        )
        .expect("known kind parses");
        let mut cfg = inst.config;
        cfg.clamp();
        let out = serde_json::to_value(&cfg).unwrap();
        assert_eq!(out["faces"], serde_json::json!(20));
        assert_eq!(out["lastRoll"], serde_json::json!([17, 4, 20]));
        assert_eq!(out["futureColour"], serde_json::json!("gold"));
    }

    /// A die nobody has re-coloured is a classic ivory one, and it stays
    /// that way through parse → clamp → serialise → parse.
    ///
    /// The round trip is the half that matters. `default_for` alone would
    /// pass even if the serialised spellings and the `rename_all` disagreed
    /// — and a mismatch there is not a wrong colour on screen, it is
    /// `lenient` quietly resetting the teacher's choice on every load.
    #[test]
    fn a_dies_appearance_defaults_to_classic_ivory_and_round_trips() {
        let WidgetConfig::Dice {
            color, material, ..
        } = WidgetConfig::default_for("dice").unwrap()
        else {
            panic!("still dice");
        };
        assert_eq!(color, DieColor::Classic);
        assert_eq!(material, DieMaterial::Ivory);

        let mut chosen = WidgetConfig::Dice {
            count: 2,
            faces: 20,
            zero_based: false,
            last_roll: vec![17, 3],
            color: DieColor::Slate,
            material: DieMaterial::Glass,
            extra: Default::default(),
        };
        chosen.clamp();
        let written = serde_json::to_string(&chosen).expect("serialises");
        assert!(
            written.contains(r#""color":"slate""#) && written.contains(r#""material":"glass""#),
            "the persisted vocabulary is lowercase: {written}"
        );

        let mut back: WidgetConfig = serde_json::from_str(&written).expect("re-reads");
        back.clamp();
        assert_eq!(back, chosen, "appearance survives its own round trip");
    }

    /// Both appearance fields are lenient, and they are lenient TOGETHER.
    ///
    /// One unreadable spelling per config is the easy case; the table above
    /// covers it. This is the config a v0.6 writes and a v0.5 reads — two
    /// unknown enum VALUES at once, and neither may take the roll, the die
    /// type or the ADR-007 buffer down with it. Two independent `lenient`
    /// fields could each pass alone and still fail here if one of them ever
    /// lost its `deserialize_with`.
    #[test]
    fn two_unreadable_appearance_spellings_cost_two_fields_and_nothing_more() {
        let inst = row_to_instance(
            "w1",
            "dice",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"dice","count":2,"faces":12,"lastRoll":[11,4],
               "color":"chartreuse","material":"marzipan","futureFinish":{"gloss":3}}"#,
        )
        .expect("neither spelling may fail the whole config");
        let mut cfg = inst.config;
        cfg.clamp();
        let out = serde_json::to_value(&cfg).unwrap();

        assert_eq!(out["color"], serde_json::json!("classic"));
        assert_eq!(out["material"], serde_json::json!("ivory"));
        assert_eq!(out["faces"], serde_json::json!(12), "the die type stands");
        assert_eq!(
            out["lastRoll"],
            serde_json::json!([11, 4]),
            "and the roll the class watched land is still on the board"
        );
        assert_eq!(out["count"], serde_json::json!(2));
        assert_eq!(
            out["futureFinish"],
            serde_json::json!({ "gloss": 3 }),
            "the ADR-007 buffer survives BOTH bad neighbours"
        );
    }

    /// The clamp has no opinion about appearance — deliberately, and this
    /// pins it. Every other Dice field is bounded (`count` by DICE_MAX,
    /// `faces` by the snap, `last_roll` by both), so «clamp leaves it alone»
    /// is the exception in this arm and reads like an oversight without a
    /// test saying otherwise. An enum has no out-of-range value to clamp:
    /// `lenient` already resolved that one layer down.
    #[test]
    fn clamping_a_die_never_touches_its_appearance() {
        for color in [DieColor::Classic, DieColor::Gold, DieColor::Slate] {
            for material in [DieMaterial::Ivory, DieMaterial::Wood, DieMaterial::Glass] {
                let mut cfg = WidgetConfig::Dice {
                    count: 99,
                    faces: 17,
                    zero_based: false,
                    last_roll: vec![99, 99, 99, 99],
                    color,
                    material,
                    extra: Default::default(),
                };
                cfg.clamp();
                let WidgetConfig::Dice {
                    color: after_color,
                    material: after_material,
                    ..
                } = cfg
                else {
                    panic!("still dice");
                };
                assert_eq!(after_color, color, "a hard clamp left the colour alone");
                assert_eq!(after_material, material);
            }
        }
    }

    /// The internally-tagged deserializer leaves the tag in the flatten map;
    /// clamp scrubs it so `extra` is only truly-unknown fields and the
    /// serialised JSON never carries a duplicate "kind".
    #[test]
    fn clamp_scrubs_the_tag_from_extra() {
        let mut cfg: WidgetConfig =
            serde_json::from_str(r#"{"kind":"trafficlight","active":"red"}"#).unwrap();
        cfg.clamp();
        assert_eq!(
            cfg,
            WidgetConfig::TrafficLight {
                active: TrafficColor::Red,
                extra: Default::default(),
            }
        );
        let text = serde_json::to_string(&cfg).unwrap();
        assert_eq!(text.matches("\"kind\"").count(), 1);
    }

    /// One row per enum-valued field: an unreadable VALUE (a spelling some
    /// later version writes) costs that field and NOTHING else — the content
    /// beside it and the ADR-007 `extra` buffer both come through.
    ///
    /// `("json", "enumKey", "defaultSpelling", &[(contentKey, contentValue)])`
    /// — the two lamp-only kinds have no content beyond `extra`, which the
    /// common `futureNote` assertion covers.
    #[allow(clippy::type_complexity)]
    fn unknown_enum_value_cases() -> Vec<(
        &'static str,
        &'static str,
        &'static str,
        Vec<(&'static str, serde_json::Value)>,
    )> {
        vec![
            (
                r#"{"kind":"text","content":"Husk gymtøy","align":"justified","futureNote":"keep"}"#,
                "align",
                "center",
                vec![("content", serde_json::json!("Husk gymtøy"))],
            ),
            (
                r#"{"kind":"clock","face":"sundial","showSeconds":true,"futureNote":"keep"}"#,
                "face",
                "digital",
                vec![("showSeconds", serde_json::json!(true))],
            ),
            (
                r#"{"kind":"timer","mode":"pomodoro","durationMs":600000,"futureNote":"keep"}"#,
                "mode",
                "countdown",
                vec![("durationMs", serde_json::json!(600000.0))],
            ),
            (
                r#"{"kind":"groups","mode":"balanced","n":5,"futureNote":"keep"}"#,
                "mode",
                "count",
                vec![("n", serde_json::json!(5))],
            ),
            (
                r#"{"kind":"trafficlight","active":"purple","futureNote":"keep"}"#,
                "active",
                "red",
                vec![],
            ),
            (
                // The plan's own example: a v0.5 `WorkMode::Focus`.
                r#"{"kind":"worksymbol","mode":"focus","futureNote":"keep"}"#,
                "mode",
                "silent",
                vec![],
            ),
            (
                // A colour family only a LATER version offers. The roll is
                // what the class watched land — it must not cost anything.
                r#"{"kind":"dice","color":"chartreuse","faces":20,"lastRoll":[17],"futureNote":"keep"}"#,
                "color",
                "classic",
                vec![
                    ("faces", serde_json::json!(20)),
                    ("lastRoll", serde_json::json!([17])),
                ],
            ),
            (
                r#"{"kind":"dice","material":"marzipan","count":3,"futureNote":"keep"}"#,
                "material",
                "ivory",
                vec![("count", serde_json::json!(3))],
            ),
            (
                r#"{"kind":"agenda","source":"ical","manualItems":[{"id":"a1","text":"Les s. 40"}],"futureNote":"keep"}"#,
                "source",
                "planner",
                vec![(
                    "manualItems",
                    serde_json::json!([{"id":"a1","text":"Les s. 40","durationMin":null,"done":false}]),
                )],
            ),
        ]
    }

    #[test]
    fn an_unknown_enum_value_costs_the_field_and_nothing_else() {
        for (json, enum_key, default_spelling, content) in unknown_enum_value_cases() {
            let mut cfg: WidgetConfig = serde_json::from_str(json)
                .unwrap_or_else(|e| panic!("{enum_key} must not fail the whole config: {e}"));
            cfg.clamp();
            let out = serde_json::to_value(&cfg).expect("serialises");
            assert_eq!(
                out[enum_key],
                serde_json::json!(default_spelling),
                "{enum_key}: an unreadable value takes the field default"
            );
            assert_eq!(
                out["futureNote"],
                serde_json::json!("keep"),
                "{enum_key}: the ADR-007 buffer survives the bad neighbour"
            );
            for (key, value) in content {
                assert_eq!(out[key], value, "{enum_key}: {key} survives");
            }
        }
    }

    /// `default` and `deserialize_with` answer DIFFERENT roads — an ABSENT
    /// key never reaches the lenient function at all. Both roads must end at
    /// the same value, or "unknown spelling" and "field not written yet"
    /// would mean different things on the projector.
    #[test]
    fn an_absent_enum_key_lands_where_an_unreadable_one_does() {
        for (json, enum_key, default_spelling, _) in unknown_enum_value_cases() {
            let mut absent: serde_json::Value = serde_json::from_str(json).unwrap();
            absent
                .as_object_mut()
                .expect("case json is an object")
                .remove(enum_key)
                .expect("case json carries the enum key");

            let mut cfg: WidgetConfig =
                serde_json::from_value(absent).expect("an absent key is fine");
            cfg.clamp();
            let out = serde_json::to_value(&cfg).unwrap();
            assert_eq!(
                out[enum_key],
                serde_json::json!(default_spelling),
                "{enum_key}: an absent key takes the same default"
            );
            assert_eq!(
                out["futureNote"],
                serde_json::json!("keep"),
                "{enum_key}: and still keeps the unknown neighbour"
            );
        }
    }

    /// The whole point, end to end through the seam that used to lose it.
    ///
    /// Before the lenient guard this row cost the teacher her text: `align`
    /// failed the WHOLE `WidgetConfig`, `from_str(..).ok()` answered `None`,
    /// and [`row_to_instance`] fell back to `default_for("text")` — empty
    /// content, empty `extra` — which `replace_widgets` then wrote to disk at
    /// the first edit. Now only the alignment is lost.
    #[test]
    fn a_row_with_an_unknown_enum_value_keeps_the_rest_of_its_config() {
        let inst = row_to_instance(
            "w1",
            "text",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"text","content":"Prøve fredag","align":"justified","futureNote":7}"#,
        )
        .expect("the widget survives either way — the question is with WHAT");
        assert_ne!(
            inst.config,
            WidgetConfig::default_for("text").unwrap(),
            "the wholesale default_for fallback must NOT have run"
        );
        let WidgetConfig::Text {
            content,
            align,
            extra,
            ..
        } = &inst.config
        else {
            panic!("kind column said text");
        };
        assert_eq!(content, "Prøve fredag");
        assert_eq!(*align, TextAlign::Center, "only the alignment is lost");
        assert_eq!(extra["futureNote"], serde_json::json!(7));
    }

    /// The same tolerance end-to-end through the row seam: a stored config
    /// with a newer field parses, clamps and re-serialises with the field.
    #[test]
    fn row_with_unknown_field_keeps_it_through_the_instance() {
        let inst = row_to_instance(
            "w1",
            "dice",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"dice","count":2,"futureSides":20}"#,
        )
        .expect("known kind parses");
        let mut cfg = inst.config;
        cfg.clamp();
        let out = serde_json::to_value(&cfg).unwrap();
        assert_eq!(out["futureSides"], serde_json::json!(20));
        assert_eq!(out["count"], serde_json::json!(2));
    }

    /// ADR-007 one level DOWN (1/3): a field a newer version wrote on a
    /// CHECKLIST ROW must survive the row seam, the clamp (which truncates
    /// text in place) and the re-serialise. The variant's own flatten map
    /// only ever caught top-level keys.
    #[test]
    fn unknown_fields_on_a_checklist_item_survive_the_row_seam() {
        let inst = row_to_instance(
            "w1",
            "checklist",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"checklist","items":[
                 {"id":"i1","text":"Matpakke","done":true,"colour":"gold","futureNest":{"a":[1]}},
                 {"id":"i2","text":"Gymtøy","done":false}
               ]}"#,
        )
        .expect("known kind parses");
        let mut cfg = inst.config;
        cfg.clamp();
        let out = serde_json::to_value(&cfg).unwrap();
        assert_eq!(out["items"][0]["colour"], serde_json::json!("gold"));
        assert_eq!(
            out["items"][0]["futureNest"],
            serde_json::json!({ "a": [1] })
        );
        assert_eq!(out["items"][0]["text"], serde_json::json!("Matpakke"));
        assert_eq!(out["items"][0]["done"], serde_json::json!(true));
        assert_eq!(
            out["items"][1],
            serde_json::json!({"id":"i2","text":"Gymtøy","done":false}),
            "an item with nothing unknown gains no keys"
        );
    }

    /// ADR-007 one level DOWN (2/3): the same for a MANUAL AGENDA LINE, whose
    /// clamp also rewrites `duration_min` — the extra must survive that too.
    #[test]
    fn unknown_fields_on_a_manual_agenda_item_survive_the_row_seam() {
        let inst = row_to_instance(
            "w1",
            "agenda",
            0.1,
            0.1,
            0.3,
            0.2,
            0,
            r#"{"kind":"agenda","source":"manual","manualItems":[
                 {"id":"a1","text":"Gjennomgang","durationMin":9999,"owner":"Kari"}
               ]}"#,
        )
        .expect("known kind parses");
        let mut cfg = inst.config;
        cfg.clamp();
        let out = serde_json::to_value(&cfg).unwrap();
        assert_eq!(out["manualItems"][0]["owner"], serde_json::json!("Kari"));
        assert_eq!(
            out["manualItems"][0]["durationMin"],
            serde_json::json!(crate::schedule::AGENDA_DURATION_MAX),
            "the clamp still runs — it just no longer costs the unknown key"
        );
        assert_eq!(
            out["manualItems"][0]["text"],
            serde_json::json!("Gjennomgang")
        );
    }

    /// ADR-007 one level DOWN (3/3): the `PartialEq` consequence, pinned on
    /// purpose. Both item types derive `PartialEq` and `extra` is part of the
    /// value, so two rows that differ ONLY in a newer version's field are NOT
    /// equal — nothing may treat them as interchangeable, because "equal"
    /// here would license overwriting a field this build cannot see.
    ///
    /// And unlike [`WidgetConfig`], a list element carries no serde tag:
    /// `extra` must never acquire a `"kind"` key, which is why `clamp` has no
    /// tag to scrub down here.
    #[test]
    fn nested_items_that_differ_only_in_an_unknown_field_are_not_equal() {
        let parse = |json: &str| -> WidgetConfig {
            let mut c: WidgetConfig = serde_json::from_str(json).expect("parses");
            c.clamp();
            c
        };
        let plain = parse(r#"{"kind":"checklist","items":[{"id":"i1","text":"Matpakke"}]}"#);
        let newer =
            parse(r#"{"kind":"checklist","items":[{"id":"i1","text":"Matpakke","pinned":true}]}"#);
        assert_ne!(
            plain, newer,
            "an item carrying a newer version's field is a different stored row"
        );

        let WidgetConfig::Checklist { items, .. } = &newer else {
            panic!("still a checklist");
        };
        assert_eq!(items[0].extra["pinned"], serde_json::json!(true));
        assert!(
            !items[0].extra.contains_key("kind"),
            "a list element is not internally tagged — no tag can land in extra"
        );
        let WidgetConfig::Checklist { items, .. } = &plain else {
            panic!("still a checklist");
        };
        assert!(items[0].extra.is_empty(), "and a plain row buffers nothing");
    }

    // ── The link widget's URL: the one field that is a security boundary ────

    fn link(url: &str) -> WidgetConfig {
        WidgetConfig::Link {
            title: String::new(),
            url: url.to_string(),
            show_qr: true,
            extra: Default::default(),
        }
    }

    fn clamped_url(url: &str) -> String {
        let mut cfg = link(url);
        cfg.clamp();
        let WidgetConfig::Link { url, .. } = cfg else {
            panic!("still a link");
        };
        url
    }

    /// The table the whole widget rests on. `None` in the second column means
    /// "must end up EMPTY" — the clamp never repairs a URL, it drops it.
    ///
    /// Every row is a shape that can actually reach this function: a hostile
    /// «flytt oppsettet»-file, a hand-edited database, a paste that brought
    /// its whitespace along.
    #[test]
    fn only_an_http_url_survives_the_clamp() {
        let cases: &[(&str, Option<&str>)] = &[
            // The attack the widget exists to refuse. An `<a href>` would
            // have executed this in the webview; the card has none, and the
            // value never even reaches the open gate.
            ("javascript:alert(1)", None),
            ("JaVaScRiPt:alert(1)", None),
            ("  javascript:alert(1)  ", None),
            ("data:text/html;base64,PHNjcmlwdD4=", None),
            ("file:///etc/passwd", None),
            ("vbscript:msgbox(1)", None),
            // Not a scheme at all.
            ("", None),
            ("   ", None),
            ("udir.no", None),
            ("/oppgaver/kapittel-4", None),
            ("//evil.example", None),
            // A scheme and nothing behind it is not an address.
            ("http://", None),
            ("https://", None),
            // Whitespace a paste brought along is trimmed — the teacher meant
            // the address, and the address is what stands.
            (" http://udir.no ", Some("http://udir.no")),
            ("\thttps://udir.no\n", Some("https://udir.no")),
            // …but a control character INSIDE the value is smuggling, and the
            // whole value goes. Note what does NOT happen: the newline is not
            // removed and the rest kept, because that is exactly how a
            // scrubber launders a payload past its own check.
            ("http://udir.no\n.evil.example", None),
            ("http://udir\r\n.no", None),
            ("http://udir\u{0}.no", None),
            // Case belongs to the scheme test, never to the value.
            ("HTTPS://Udir.NO/Oppgaver", Some("HTTPS://Udir.NO/Oppgaver")),
            // The ordinary link a teacher pastes, byte for byte.
            (
                "https://www.udir.no/laring-og-trivsel/?q=lek#start",
                Some("https://www.udir.no/laring-og-trivsel/?q=lek#start"),
            ),
        ];
        for (raw, want) in cases {
            assert_eq!(
                clamped_url(raw),
                want.unwrap_or_default(),
                "clamping {raw:?}"
            );
            assert_eq!(
                sanitized_url(raw).as_deref(),
                *want,
                "…and the shared rule agrees ({raw:?})"
            );
        }
    }

    /// The cap that CLEARS instead of cutting. A URL trimmed to fit is a
    /// different resource wearing the teacher's title, which is worse than an
    /// empty field: the empty field is true.
    #[test]
    fn an_over_long_url_is_cleared_never_shortened() {
        let long = format!("https://skole.no/{}", "a".repeat(LINK_URL_MAX_CHARS));
        assert!(long.chars().count() > LINK_URL_MAX_CHARS);
        assert_eq!(clamped_url(&long), "");

        // …and the row exactly ON the cap still stands, so the boundary is
        // pinned from both sides rather than "somewhere around 2000".
        let head = "https://skole.no/";
        let at_cap = format!(
            "{head}{}",
            "a".repeat(LINK_URL_MAX_CHARS - head.chars().count())
        );
        assert_eq!(at_cap.chars().count(), LINK_URL_MAX_CHARS);
        assert_eq!(clamped_url(&at_cap), at_cap);
    }

    /// Codepoints, not bytes — the same counting rule every other cap in this
    /// file uses. A URL of 2000 non-ASCII characters is 2000 characters.
    #[test]
    fn the_url_cap_counts_codepoints() {
        let head = "https://skole.no/";
        let at_cap = format!(
            "{head}{}",
            "æ".repeat(LINK_URL_MAX_CHARS - head.chars().count())
        );
        assert!(
            at_cap.len() > LINK_URL_MAX_CHARS,
            "…and it is longer in BYTES"
        );
        assert_eq!(clamped_url(&at_cap), at_cap);
    }

    #[test]
    fn the_link_title_is_cut_to_fit_like_every_other_title() {
        let mut cfg = WidgetConfig::Link {
            title: "æ".repeat(LINK_TITLE_MAX_CHARS + 40),
            url: "https://udir.no".to_string(),
            show_qr: false,
            extra: Default::default(),
        };
        cfg.clamp();
        let WidgetConfig::Link {
            title,
            url,
            show_qr,
            ..
        } = cfg
        else {
            panic!("still a link");
        };
        assert_eq!(title.chars().count(), LINK_TITLE_MAX_CHARS);
        assert_eq!(url, "https://udir.no", "a good URL is never touched");
        assert!(!show_qr, "and the flag the teacher set stands");
    }

    /// Clamp runs on every load AND every save, so it runs twice on the same
    /// value all the time. A second pass must change nothing.
    #[test]
    fn clamping_a_link_twice_changes_nothing() {
        for raw in [
            "https://udir.no/side",
            "javascript:alert(1)",
            " http://udir.no ",
            "",
        ] {
            let mut cfg = link(raw);
            cfg.clamp();
            let once = cfg.clone();
            cfg.clamp();
            assert_eq!(cfg, once, "clamping {raw:?} is idempotent");
        }
    }

    /// ADR-007 for the new kind: a field a NEWER version wrote survives the
    /// round trip, and the scrub of the URL beside it does not take it along.
    #[test]
    fn a_links_unknown_fields_survive_the_round_trip() {
        let inst = row_to_instance(
            "w1",
            "link",
            0.2,
            0.2,
            0.4,
            0.3,
            0,
            r#"{"kind":"link","title":"Oppgaver","url":"javascript:alert(1)","showQr":false,"qrLogo":"skole"}"#,
        )
        .expect("a link row renders");

        let json = serde_json::to_string(&inst.config).unwrap();
        let out: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(out["title"], serde_json::json!("Oppgaver"));
        assert_eq!(
            out["url"],
            serde_json::json!(""),
            "the hostile URL was cleared on the way in"
        );
        assert_eq!(out["showQr"], serde_json::json!(false));
        assert_eq!(
            out["qrLogo"],
            serde_json::json!("skole"),
            "and the newer version's field is still on the row"
        );
        assert_eq!(json.matches("\"kind\"").count(), 1);
    }
}
