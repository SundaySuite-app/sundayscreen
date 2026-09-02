//! The setup transfer file — «flytt oppsettet til en annen maskin».
//!
//! One JSON document that carries a teacher's CLASSES (with their name
//! lists), her SCREENS (the class defaults and the shared library, widgets
//! and all) and her SCHOOL DAY (the period template and the weekly
//! timetable). Nothing else: this module is the shape, the port rules and
//! the size limits — the reading and writing of rows lives in `src-tauri`
//! (`db/import.rs`, `commands/transfer.rs`), and the file dialog lives in
//! Rust alone.
//!
//! ## What is deliberately NOT in it
//!
//! - `absent_on` — today's absence marks. ADR-010 and PRIVACY.md both
//!   promise that no attendance HISTORY exists anywhere; a file carrying
//!   absence marks would be exactly that, on a memory stick. The payload has
//!   no field for it: a member is a NAME (`Vec<String>`), so the promise is
//!   kept by the type, not by remembering to filter.
//! - `draw_state` — who has been drawn in today's round. A round belongs to
//!   a lesson, not to a setup.
//! - `date_override` / `agenda_item` / `day_note` — all keyed by DATE. Last
//!   year's file would import agendas onto dates that have passed, and the
//!   latter two have no UNIQUE key, so a second import would duplicate them
//!   in silence.
//! - `app_setting` — the settings blob, including which class and screen are
//!   on the board right now. An import must never move the board.
//!
//! ## The port rules, in order
//!
//! 1. `kind` FIRST. A file that is not ours gets "this is not a SundayScreen
//!    file", never a parse error about a field nobody has heard of.
//! 2. `schemaVersion > SCHEMA_VERSION` → refuse the WHOLE file, naming the
//!    `appVersion` that wrote it. Never a half import: a newer file's shape
//!    is unknown, and adopting the half we recognise would quietly drop the
//!    rest.
//! 3. Same or older → `#[serde(default)]` everywhere and unknown keys
//!    ignored. That is ADR-007's tolerance applied to a file instead of a
//!    widget config.
//!
//! `SCHEMA_VERSION` moves only for a BREAKING change; additive fields never
//! move it (the suite precedent is SundaySync's `SCHEMA_VERSION: u32 = 1`).
//! `appVersion` is diagnostics only — it is written into the file and shown
//! in one refusal sentence, and no decision is ever taken on it.

use serde::{Deserialize, Serialize};

use crate::members::{CLASS_NAME_MAX_CHARS, MEMBERS_MAX, NAME_MAX_CHARS};
use crate::schedule::{PeriodKind, LABEL_MAX_CHARS};

/// The `kind` marker every SundayScreen setup file carries. Checked BEFORE
/// anything else is read.
pub const KIND: &str = "sundayscreen-setup";

/// The file format's version. Additive fields do NOT move this number —
/// only a change an older build could misread.
pub const SCHEMA_VERSION: u32 = 1;

// ── Size limits ─────────────────────────────────────────────────────────────
//
// Checked BEFORE a single row is written, and a breach REFUSES the import.
// Truncating instead would be the quiet kind of wrong this house keeps
// finding: `members::reconcile` caps a pasted list with `take(MEMBERS_MAX)`,
// which is right for a textarea (the teacher can see what she pasted) and
// wrong for a file (she cannot). Promise 4 — a write that cannot be done in
// full REJECTS.
//
// The numbers are generous on purpose: they are here to stop a wrong or
// hostile file from becoming a database, not to tell a teacher how to teach.

/// Most classes one file may carry — a whole school's worth of groups.
pub const CLASSES_MAX: usize = 200;
/// Most LIBRARY screens one file may carry (class defaults ride along with
/// their class and are counted per class instead).
pub const SCENES_MAX: usize = 500;
/// Most widgets one screen may carry. The board holds a handful; this is the
/// bound on a file, not on a design.
pub const WIDGETS_MAX_PER_SCENE: usize = 200;
/// Longest stored widget config, in characters. `TEXT_CONTENT_MAX_CHARS` is
/// 10 000 on its own, so this leaves room for a long text card plus fields.
pub const WIDGET_CONFIG_MAX_CHARS: usize = 64_000;
/// Most periods in a school day's template.
pub const PERIODS_MAX: usize = 40;
/// Most cells in the weekly timetable — Monday–Friday × every period.
pub const WEEK_SLOTS_MAX: usize = PERIODS_MAX * 5;

// The longest class or screen name is `members::CLASS_NAME_MAX_CHARS`,
// imported above. It was declared HERE too until R4 — one of four copies of
// the literal `80` that nothing kept in step. It has to be the same number as
// `class_create`/`scene_create` accept, or the export can write a file the
// import refuses; being the same DECLARATION is what makes that true rather
// than currently-true.

// ── The payload ─────────────────────────────────────────────────────────────

/// One transferred widget, stored the way the DATABASE stores it: `kind` and
/// `config` as two RAW strings.
///
/// Never a typed `WidgetConfig`. The tolerance for a kind this build does not
/// know lives in `commands/layout.rs`, not in the store — so a file written
/// by a NEWER SundayScreen carries its unknown widgets through an import
/// untouched, exactly as a downgrade carries them through a save (promise 3).
/// The two fields stay SEPARATE for the same reason the column does: merged
/// into one blob, "unknown kind" and "corrupt config" become the same thing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferWidget {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub config: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    #[serde(default)]
    pub z: i64,
}

/// One transferred screen. `id` is the ORIGINAL id — kept only so the weekly
/// timetable's `sceneId` can be remapped; the imported row always gets a
/// fresh one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferScene {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// The screen's backdrop, as the STORED WORD rather than as
    /// [`crate::theme::SceneTheme`].
    ///
    /// A `String` on purpose, and it is this file's tolerance rule rather
    /// than laziness: a spelling this build does not know must not fail the
    /// parse of the whole file. The import runs it through
    /// `SceneTheme::parse`, so an unknown word lands on `standard`.
    ///
    /// This is deliberately NOT the treatment [`PeriodKind`] gets. There, a
    /// fallback would put a made-up LESSON on a projector — something the app
    /// acts on. Here the fallback is the board the teacher already had: a
    /// theme is cosmetic, and losing the colour is the cheapest possible way
    /// for a file from the future to be wrong.
    ///
    /// ADDITIVE: an older file simply has no key, `#[serde(default)]` gives
    /// the empty string, and that parses to `standard`. `SCHEMA_VERSION`
    /// therefore stays at 1.
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub widgets: Vec<TransferWidget>,
}

/// One transferred class: its name, its name LIST, and its own default
/// screen.
///
/// `members` is a list of NAMES. Not rows: a member row also carries
/// `absent_on`, and this type is where that must be impossible rather than
/// merely omitted (see the module header).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferClass {
    /// The ORIGINAL class id — kept only so the weekly timetable's `classId`
    /// can be remapped. The imported row always gets a fresh one.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub members: Vec<String>,
    /// The class's own default screen. `None` only for a file written by
    /// something that had none — the import mints one regardless, because a
    /// class without a default screen is an unrepresentable state.
    #[serde(default)]
    pub default_scene: Option<TransferScene>,
}

/// One slot in the school day's template.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPeriod {
    /// The ORIGINAL period id — kept only for the weekly timetable's remap.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub start_min: u32,
    #[serde(default)]
    pub end_min: u32,
    /// Deliberately NOT `lenient`, and the only enum field in the crate that
    /// is not.
    ///
    /// `lenient` is right where the fallback is HARMLESS — an unreadable
    /// widget alignment draws centred and nothing else changes. Here the
    /// fallback is [`PeriodKind::Lesson`], and a lesson is a thing the app
    /// ACTS on: it gets a banner, a suggestion to switch class and screen, an
    /// auto-switch when the teacher has turned that on, and a pill on the
    /// board. A future `"assembly"` or `"studytime"` silently becoming a
    /// lesson would put a made-up lesson on a projector in front of a class.
    ///
    /// An ABSENT key still defaults (`#[serde(default)]`), which is the
    /// tolerant road for an OLDER file that never had the field. A PRESENT
    /// spelling this build cannot read fails the parse, and the port answers
    /// `Unreadable` — «the file could not be read. Nothing was changed.» That
    /// is the honest sentence: we were handed a school day with a period type
    /// in it, and we do not know what it is.
    #[serde(default)]
    pub kind: PeriodKind,
}

/// One cell of the recurring weekly timetable. The row's own id is not
/// carried: `(weekday, periodId)` is the natural key, and the imported row
/// gets a fresh id anyway.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSlot {
    #[serde(default)]
    pub weekday: u8,
    #[serde(default)]
    pub period_id: String,
    #[serde(default)]
    pub class_id: Option<String>,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub scene_id: Option<String>,
    /// «Dobbelttime»: does this cell run on into the next lesson period?
    ///
    /// ADDITIVE, so `SCHEMA_VERSION` stays at 1: an older file has no key,
    /// `#[serde(default)]` reads it as `false`, and the setup arrives as
    /// ordinary single lessons — a degradation, not a loss. Carrying it at
    /// all is the point: without this field a teacher who moves her setup to
    /// a new machine would find every double lesson quietly split in two,
    /// with nothing in the receipt to say so.
    ///
    /// Per-DATE merges (the resolver's flag carriers) do NOT travel — they
    /// live on `date_override`, which the file deliberately has no field for
    /// at all (see the module header).
    #[serde(default)]
    pub merged_with_next: bool,
}

/// The school day half of the file. All-or-nothing on import: the period
/// table is a GLOBAL singleton, so it is adopted only into an empty one.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPlanner {
    #[serde(default)]
    pub periods: Vec<TransferPeriod>,
    #[serde(default)]
    pub week: Vec<TransferSlot>,
}

/// The whole file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFile {
    /// Always [`KIND`] on write; checked FIRST on read (by [`parse`], before
    /// this struct is built at all — hence the `default`: by the time serde
    /// sees the document the marker has already been verified).
    #[serde(default)]
    pub kind: String,
    /// Absent means "older than us" — the tolerant road, not a failure.
    #[serde(default)]
    pub schema_version: u32,
    /// Which SundayScreen wrote it. DIAGNOSTIC ONLY — never a decision axis.
    #[serde(default)]
    pub app_version: String,
    /// Epoch milliseconds, for the same reason: so a human can tell two files
    /// apart. Nothing reads it.
    #[serde(default)]
    pub exported_at: f64,
    #[serde(default)]
    pub classes: Vec<TransferClass>,
    /// The GLOBAL screen library. Class defaults travel inside their class.
    #[serde(default)]
    pub scenes: Vec<TransferScene>,
    #[serde(default)]
    pub planner: TransferPlanner,
}

impl TransferFile {
    /// A fresh, empty file stamped with this build's identity.
    pub fn new(app_version: impl Into<String>, exported_at: f64) -> Self {
        TransferFile {
            kind: KIND.to_string(),
            schema_version: SCHEMA_VERSION,
            app_version: app_version.into(),
            exported_at,
            classes: Vec::new(),
            scenes: Vec::new(),
            planner: TransferPlanner::default(),
        }
    }
}

// ── The gate ────────────────────────────────────────────────────────────────

/// Why a file was refused. Each variant is a DIFFERENT sentence to a teacher,
/// which is the whole reason they are not one error string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportRefusal {
    /// Not a SundayScreen setup file: the `kind` marker is missing or wrong,
    /// or the bytes are not JSON at all.
    NotOurFile,
    /// Written by a NEWER SundayScreen than this one. Refused WHOLE.
    TooNew {
        schema_version: u32,
        /// The `appVersion` the file names — the one thing the sentence
        /// «Fila er laget med SundayScreen X» needs. May be empty.
        app_version: String,
    },
    /// It IS ours, and not newer, and the content still could not be read.
    Unreadable(String),
}

/// Read a setup file, applying the three port rules in order (see the module
/// header). The returned value has passed the version gate but NOT
/// [`check_limits`] — that is a separate question with a separate answer.
pub fn parse(raw: &str) -> Result<TransferFile, ImportRefusal> {
    // Parsed to a `Value` first, on purpose: the `kind` check has to happen
    // before any typed field can fail, or a foreign JSON file would be
    // reported as a broken SundayScreen file instead of "not ours".
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| ImportRefusal::NotOurFile)?;

    if value.get("kind").and_then(|v| v.as_str()) != Some(KIND) {
        return Err(ImportRefusal::NotOurFile);
    }

    let app_version = value
        .get("appVersion")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    // Absent → 0, i.e. "older than us", which lands on the tolerant road. A
    // PRESENT but non-numeric value is a different thing entirely: the file
    // claims to be ours and its version field is nonsense, so we say so
    // rather than guessing it is old.
    let schema_version = match value.get("schemaVersion") {
        None => 0,
        Some(v) => match v.as_u64() {
            Some(n) => n,
            None => {
                return Err(ImportRefusal::Unreadable(
                    "schemaVersion is not a number".to_string(),
                ))
            }
        },
    };
    if schema_version > u64::from(SCHEMA_VERSION) {
        return Err(ImportRefusal::TooNew {
            schema_version: u32::try_from(schema_version).unwrap_or(u32::MAX),
            app_version,
        });
    }

    serde_json::from_value(value).map_err(|e| ImportRefusal::Unreadable(e.to_string()))
}

/// One broken size limit, named so the refusal can be specific.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LimitBreach {
    /// What was too big — a stable English identifier for the log.
    pub what: &'static str,
    pub found: usize,
    pub max: usize,
}

impl std::fmt::Display for LimitBreach {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}: {} exceeds the limit of {}",
            self.what, self.found, self.max
        )
    }
}

fn cap(what: &'static str, found: usize, max: usize) -> Result<(), LimitBreach> {
    if found > max {
        return Err(LimitBreach { what, found, max });
    }
    Ok(())
}

/// Character count, matching Rust's `.chars().take(n)` truncation everywhere
/// else in the app (and the e2e harness's `[...s].slice(0, n)`).
fn chars(s: &str) -> usize {
    s.chars().count()
}

fn check_scene(scene: &TransferScene) -> Result<(), LimitBreach> {
    cap("sceneName", chars(&scene.name), CLASS_NAME_MAX_CHARS)?;
    cap("sceneWidgets", scene.widgets.len(), WIDGETS_MAX_PER_SCENE)?;
    for widget in &scene.widgets {
        cap("widgetKind", chars(&widget.kind), CLASS_NAME_MAX_CHARS)?;
        cap(
            "widgetConfig",
            chars(&widget.config),
            WIDGET_CONFIG_MAX_CHARS,
        )?;
    }
    Ok(())
}

/// Does this file fit inside what the store accepts, WITHOUT truncating
/// anything? Answered before the first INSERT, so a refusal costs nothing.
///
/// The alternative — write what fits and drop the rest — is the failure mode
/// this whole check exists to avoid: a teacher who imports a class of 40 and
/// gets 30 has no way to know, and the file she trusted is now the only place
/// the other ten exist.
pub fn check_limits(file: &TransferFile) -> Result<(), LimitBreach> {
    cap("classes", file.classes.len(), CLASSES_MAX)?;
    cap("scenes", file.scenes.len(), SCENES_MAX)?;

    for class in &file.classes {
        cap("className", chars(&class.name), CLASS_NAME_MAX_CHARS)?;
        cap("members", class.members.len(), MEMBERS_MAX)?;
        for name in &class.members {
            cap("memberName", chars(name), NAME_MAX_CHARS)?;
        }
        if let Some(scene) = &class.default_scene {
            check_scene(scene)?;
        }
    }
    for scene in &file.scenes {
        check_scene(scene)?;
    }

    cap("periods", file.planner.periods.len(), PERIODS_MAX)?;
    for period in &file.planner.periods {
        cap("periodLabel", chars(&period.label), LABEL_MAX_CHARS)?;
    }
    cap("weekSlots", file.planner.week.len(), WEEK_SLOTS_MAX)?;
    for slot in &file.planner.week {
        cap("slotSubject", chars(&slot.subject), LABEL_MAX_CHARS)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> TransferFile {
        let mut file = TransferFile::new("0.4.0-beta.1", 1_700_000_000_000.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "7B".into(),
            members: vec!["Kari".into(), "Ola".into()],
            default_scene: Some(TransferScene {
                id: "default-c1".into(),
                name: "7B".into(),
                theme: "tavle".into(),
                widgets: vec![TransferWidget {
                    kind: "text".into(),
                    config: r#"{"kind":"text","content":"hei"}"#.into(),
                    x: 0.1,
                    y: 0.1,
                    w: 0.3,
                    h: 0.2,
                    z: 0,
                }],
            }),
        });
        file
    }

    #[test]
    fn a_written_file_reads_back_identically() {
        let file = sample();
        let json = serde_json::to_string(&file).unwrap();
        assert_eq!(parse(&json).unwrap(), file);
    }

    #[test]
    fn a_member_is_a_name_and_carries_no_absence() {
        // The type-level half of the ADR-010 promise: there is no field an
        // absence mark could travel in. (The store-level half — that the
        // EXPORT never puts one here — is proven in `commands/transfer.rs`.)
        let json = serde_json::to_string(&sample()).unwrap();
        assert!(!json.contains("absent"), "no absence anything: {json}");
        assert!(json.contains(r#"["Kari","Ola"]"#), "members are names");
    }

    // ── Port rule 1: `kind` first ───────────────────────────────────────────

    #[test]
    fn a_foreign_json_file_is_not_ours() {
        assert_eq!(
            parse(r#"{"kind":"some-other-app","schemaVersion":1}"#),
            Err(ImportRefusal::NotOurFile)
        );
        assert_eq!(
            parse(r#"{"schemaVersion":1,"classes":[]}"#),
            Err(ImportRefusal::NotOurFile),
            "no kind marker at all"
        );
    }

    #[test]
    fn bytes_that_are_not_json_are_not_ours_either() {
        // A teacher picks a PDF. She must read "this is not a SundayScreen
        // file", never a parser's complaint about byte 0.
        assert_eq!(parse("%PDF-1.7\n%¥±ë"), Err(ImportRefusal::NotOurFile));
        assert_eq!(parse(""), Err(ImportRefusal::NotOurFile));
    }

    #[test]
    fn the_kind_check_wins_over_a_broken_body() {
        // Wrong kind AND unreadable classes: the answer is still "not ours",
        // because the body was never the reason.
        assert_eq!(
            parse(r#"{"kind":"nope","schemaVersion":99,"classes":7}"#),
            Err(ImportRefusal::NotOurFile)
        );
    }

    // ── Port rule 2: a newer file is refused WHOLE ──────────────────────────

    #[test]
    fn a_newer_schema_is_refused_whole_and_names_the_app_version() {
        let raw = format!(
            r#"{{"kind":"{KIND}","schemaVersion":{},"appVersion":"9.9.9","classes":[]}}"#,
            SCHEMA_VERSION + 1
        );
        assert_eq!(
            parse(&raw),
            Err(ImportRefusal::TooNew {
                schema_version: SCHEMA_VERSION + 1,
                app_version: "9.9.9".to_string(),
            })
        );
    }

    #[test]
    fn a_newer_file_is_refused_even_when_the_half_we_know_would_parse() {
        // The trap this rule exists for: everything we can see is valid, so
        // a "read what you understand" import would happily adopt it and
        // silently drop whatever the newer format added.
        let raw = format!(
            r#"{{"kind":"{KIND}","schemaVersion":4,"appVersion":"1.2.3",
                 "classes":[{{"id":"c1","name":"7B","members":["Kari"]}}]}}"#
        );
        assert!(matches!(parse(&raw), Err(ImportRefusal::TooNew { .. })));
    }

    #[test]
    fn a_nonsense_version_field_is_unreadable_not_old() {
        assert!(matches!(
            parse(&format!(r#"{{"kind":"{KIND}","schemaVersion":"2"}}"#)),
            Err(ImportRefusal::Unreadable(_))
        ));
    }

    // ── Port rule 3: same or older is tolerated ─────────────────────────────

    #[test]
    fn unknown_keys_are_ignored_and_missing_ones_default() {
        let raw = format!(
            r#"{{"kind":"{KIND}","schemaVersion":1,"somethingNewer":{{"a":1}},
                 "classes":[{{"id":"c1","name":"7B","futureField":true}}]}}"#
        );
        let file = parse(&raw).expect("tolerated");
        assert_eq!(file.classes.len(), 1);
        assert!(file.classes[0].members.is_empty(), "defaulted");
        assert!(file.classes[0].default_scene.is_none());
        assert!(file.scenes.is_empty());
        assert!(file.planner.periods.is_empty());
    }

    #[test]
    fn an_older_file_without_a_version_field_still_reads() {
        let raw = format!(r#"{{"kind":"{KIND}","classes":[]}}"#);
        let file = parse(&raw).expect("an absent version is 'older', not newer");
        assert_eq!(file.schema_version, 0);
    }

    #[test]
    fn an_unknown_period_kind_costs_the_whole_file() {
        // The ONE place tolerance is refused. A future `"assembly"` read as a
        // Lesson gets a banner, a switch suggestion, an auto-switch and a pill
        // — a made-up lesson on the projector. «Could not be read, nothing was
        // changed» is the smaller harm, and it is also true.
        let raw = format!(
            r#"{{"kind":"{KIND}","schemaVersion":1,"planner":{{
                 "periods":[{{"id":"p1","label":"1. time","startMin":480,
                              "endMin":525,"kind":"assembly"}}]}}}}"#
        );
        assert!(matches!(parse(&raw), Err(ImportRefusal::Unreadable(_))));
    }

    #[test]
    fn an_absent_period_kind_is_still_a_lesson() {
        // The other road stays tolerant: a file written before the field
        // existed has nothing to disagree about.
        let raw = format!(
            r#"{{"kind":"{KIND}","schemaVersion":1,"planner":{{
                 "periods":[{{"id":"p1","label":"1. time","startMin":480,
                              "endMin":525}}]}}}}"#
        );
        let file = parse(&raw).expect("an absent field is not an unreadable one");
        assert_eq!(file.planner.periods[0].kind, PeriodKind::Lesson);
        assert_eq!(file.planner.periods[0].label, "1. time");
    }

    #[test]
    fn a_wrongly_typed_collection_is_unreadable() {
        // Tolerance covers unknown keys and unknown VALUES of a known enum.
        // It deliberately does NOT cover "classes is a number": silently
        // reading that as zero classes would be a half import wearing a
        // success receipt.
        assert!(matches!(
            parse(&format!(
                r#"{{"kind":"{KIND}","schemaVersion":1,"classes":7}}"#
            )),
            Err(ImportRefusal::Unreadable(_))
        ));
    }

    // ── The size limits ─────────────────────────────────────────────────────

    #[test]
    fn an_ordinary_file_passes_the_limits() {
        check_limits(&sample()).expect("a normal setup is nowhere near a limit");
    }

    #[test]
    fn too_many_classes_is_refused_by_name() {
        let mut file = TransferFile::new("t", 0.0);
        file.classes = (0..CLASSES_MAX + 1)
            .map(|i| TransferClass {
                id: format!("c{i}"),
                name: format!("K{i}"),
                members: Vec::new(),
                default_scene: None,
            })
            .collect();
        assert_eq!(
            check_limits(&file).unwrap_err(),
            LimitBreach {
                what: "classes",
                found: CLASSES_MAX + 1,
                max: CLASSES_MAX,
            }
        );
    }

    #[test]
    fn an_oversized_class_refuses_rather_than_truncating() {
        // `members::reconcile` would silently `take(MEMBERS_MAX)` here. A
        // file is not a textarea: the teacher cannot see what was dropped.
        let mut file = TransferFile::new("t", 0.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "7B".into(),
            members: (0..MEMBERS_MAX + 1).map(|i| format!("Elev {i}")).collect(),
            default_scene: None,
        });
        assert_eq!(check_limits(&file).unwrap_err().what, "members");

        // …and a single name that is too long counts too.
        let mut file = TransferFile::new("t", 0.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "7B".into(),
            members: vec!["æ".repeat(NAME_MAX_CHARS + 1)],
            default_scene: None,
        });
        let breach = check_limits(&file).unwrap_err();
        assert_eq!(breach.what, "memberName");
        assert_eq!(breach.found, NAME_MAX_CHARS + 1, "characters, not bytes");
    }

    #[test]
    fn the_limits_reach_into_a_class_default_screen_too() {
        // The easy miss: a default screen is not in `file.scenes`, so a check
        // that only walked that list would leave the widest door open.
        let mut file = TransferFile::new("t", 0.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "7B".into(),
            members: Vec::new(),
            default_scene: Some(TransferScene {
                id: "default-c1".into(),
                name: "7B".into(),
                theme: String::new(),
                widgets: (0..WIDGETS_MAX_PER_SCENE + 1)
                    .map(|_| TransferWidget {
                        kind: "text".into(),
                        config: "{}".into(),
                        x: 0.0,
                        y: 0.0,
                        w: 0.1,
                        h: 0.1,
                        z: 0,
                    })
                    .collect(),
            }),
        });
        assert_eq!(check_limits(&file).unwrap_err().what, "sceneWidgets");
    }

    #[test]
    fn an_enormous_widget_config_is_refused() {
        let mut file = TransferFile::new("t", 0.0);
        file.scenes.push(TransferScene {
            id: "s1".into(),
            name: "Prøve".into(),
            theme: String::new(),
            widgets: vec![TransferWidget {
                kind: "text".into(),
                config: "x".repeat(WIDGET_CONFIG_MAX_CHARS + 1),
                x: 0.0,
                y: 0.0,
                w: 0.1,
                h: 0.1,
                z: 0,
            }],
        });
        assert_eq!(check_limits(&file).unwrap_err().what, "widgetConfig");
    }

    #[test]
    fn the_planner_halves_are_bounded_too() {
        let mut file = TransferFile::new("t", 0.0);
        file.planner.periods = (0..PERIODS_MAX + 1)
            .map(|i| TransferPeriod {
                id: format!("p{i}"),
                label: format!("{i}. time"),
                start_min: 0,
                end_min: 1,
                kind: PeriodKind::Lesson,
            })
            .collect();
        assert_eq!(check_limits(&file).unwrap_err().what, "periods");

        let mut file = TransferFile::new("t", 0.0);
        file.planner.week = (0..WEEK_SLOTS_MAX + 1)
            .map(|_| TransferSlot {
                weekday: 1,
                period_id: "p1".into(),
                class_id: None,
                subject: String::new(),
                scene_id: None,
                merged_with_next: false,
            })
            .collect();
        assert_eq!(check_limits(&file).unwrap_err().what, "weekSlots");
    }

    // ── Double lessons in the file ──────────────────────────────────────────

    #[test]
    fn a_double_lesson_survives_a_write_and_read() {
        let mut file = TransferFile::new("0.5.0", 0.0);
        file.planner.week.push(TransferSlot {
            weekday: 2,
            period_id: "p1".into(),
            class_id: Some("c1".into()),
            subject: "Matte".into(),
            scene_id: None,
            merged_with_next: true,
        });
        let json = serde_json::to_string(&file).unwrap();
        assert!(
            json.contains(r#""mergedWithNext":true"#),
            "the flag is written in camelCase: {json}"
        );
        assert_eq!(parse(&json).unwrap(), file);
    }

    #[test]
    fn a_file_written_before_double_lessons_reads_as_single_ones() {
        // The tolerant road, at the field this round added: no key, no
        // failure, no double lesson.
        let raw = format!(
            r#"{{"kind":"{KIND}","schemaVersion":1,"planner":{{
                 "periods":[{{"id":"p1","label":"1. time","startMin":480,"endMin":525}}],
                 "week":[{{"weekday":1,"periodId":"p1","subject":"Norsk"}}]}}}}"#
        );
        let file = parse(&raw).expect("an absent field is not an unreadable one");
        assert!(!file.planner.week[0].merged_with_next);
        assert_eq!(file.planner.week[0].subject, "Norsk");
    }
}
