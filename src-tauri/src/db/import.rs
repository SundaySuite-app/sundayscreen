//! Adopting a setup file — the write half of «flytt oppsettet».
//!
//! ## The semantics, in one sentence
//!
//! An import ALWAYS ADDS. Classes and screens arrive as NEW rows with NEW
//! ids; nothing existing is renamed, merged, replaced or deleted, and the
//! settings blob — which class and which screen are on the board right now —
//! is not touched at all. Importing while a lesson is running changes nothing
//! the pupils can see.
//!
//! That is why this module writes plain `INSERT`s against a `&mut
//! Transaction` instead of reaching for the `replace_*` family in
//! [`super::store`]: those are DELETE-first by design (a replace-all save of
//! a scene, a reconciled member list), which is the exact opposite of what an
//! import may do.
//!
//! ## Re-minting, and the order it has to happen in
//!
//! Every id in the file is a FOREIGN id — it means something on the machine
//! that wrote it and nothing here. Three maps carry old → new, and they are
//! filled in a forced order because each one is needed by the next:
//!
//! 1. **classes** → a fresh UUID each.
//! 2. **class default screens** → id DERIVED from the NEW class id
//!    (`default-<new class id>`, the shape migration 0003 minted and
//!    `store::default_scene_id` still owns) — and then put in the SCENE map.
//!    The derivation is the trap: a weekly slot can point at a class default
//!    screen, and reconstructing that pointer from the CLASS map later would
//!    work right up until someone changed the id shape.
//! 3. **members**, then **library screens**, then **widgets** — widgets need
//!    their scene, both kinds of scene are minted by then.
//! 4. **periods**, then the **weekly timetable**, which remaps all three:
//!    `period_id`, `class_id` AND `scene_id`.
//!
//! ## Why the week plan is all-or-nothing
//!
//! The period template is a GLOBAL singleton — one school day, not one per
//! class. `UNIQUE (weekday, period_id)` looks like it would protect a merge,
//! and it does not: the imported periods have FRESH ids, so every imported
//! cell is unique against every existing one and both land. The board would
//! then show a silently DOUBLED school day (`resolve_day` walks every period
//! row), and the editor's `periods_overlap` gate never sees a direct INSERT.
//!
//! So: the planner half is adopted ONLY into an empty `period` table.
//! Otherwise it is skipped, and the receipt SAYS SO — the one thing a teacher
//! must not have to discover on Monday morning.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use base64::Engine as _;
use serde::Serialize;
use sqlx::SqlitePool;
use sundayscreen_core::layout::sanitized_image_id;
use sundayscreen_core::schedule::{self, Period};
use sundayscreen_core::theme::SceneTheme;
use sundayscreen_core::transfer::{
    self, TransferFile, TransferScene, TransferSlot, TransferWidget,
};
use ts_rs::TS;

use super::images;
use super::planner::period_kind_tag;
use super::store::{default_scene_id, new_id, now_ms};
use crate::error::AppResult;

/// How an import ended. A UNIT enum, like `BootFaultKind` and for the same
/// reason: the panel switches on `receipt.outcome === "tooNew"` rather than
/// digging through a nested tag, and every variant is a DIFFERENT sentence to
/// a teacher.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ImportOutcome.ts")]
#[serde(rename_all = "camelCase")]
pub enum ImportOutcome {
    /// The file dialog was closed without choosing anything. Nothing was
    /// read; nothing was written.
    Cancelled,
    /// Adopted. The counts below say what landed.
    Imported,
    /// Not a SundayScreen setup file.
    NotOurFile,
    /// Written by a NEWER SundayScreen. Refused WHOLE, never half-imported.
    TooNew,
    /// It is ours, and not newer, and still could not be read.
    Unreadable,
    /// Past a size limit. Refused rather than truncated: an import that
    /// quietly kept 30 of 40 pupils is promise 4 broken with a receipt on it.
    TooLarge,
}

/// What to tell the teacher afterwards. Every field is meaningful for
/// `Imported` and zero/false for every refusal — nothing was written in those
/// cases, and the numbers must say so.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "ImportReceipt.ts")]
#[serde(rename_all = "camelCase")]
pub struct ImportReceipt {
    pub outcome: ImportOutcome,
    /// Classes added.
    pub classes: u32,
    /// LIBRARY screens added. Class default screens are not counted here:
    /// they arrive as part of their class, the way they do everywhere else.
    pub scenes: u32,
    /// Pupil names added, across all imported classes.
    pub members: u32,
    /// Did the school day (period template + weekly timetable) come along?
    pub planner_imported: bool,
    /// Did the file HAVE a school day that was skipped because this machine
    /// already had one? Never true at the same time as `planner_imported`.
    pub planner_skipped: bool,
    /// The `appVersion` the file names — diagnostics, and the one thing the
    /// «Fila er laget med SundayScreen X» sentence needs. Empty when the file
    /// was never read that far.
    pub file_app_version: String,
    /// Pictures a screen in this file POINTS AT and this machine did not get:
    /// the file was written by a build that did not carry pictures, or the
    /// picture did not fit under the export's ceiling, or its bytes were not
    /// a picture after all.
    ///
    /// A count rather than a silence, because the alternative is the shape
    /// this house keeps refusing: a receipt saying «Importert» over screens
    /// with holes in them, discovered mid-lesson. The affected cards say
    /// «bildet mangler» on the board, and this number is what tells her
    /// BEFORE she looks.
    ///
    /// `#[serde(default)]` is written for the reader rather than for serde —
    /// this struct is Serialize-only, so nothing deserialises it — and says
    /// the same thing the field's zero does: an older shell reading a newer
    /// receipt is not a case this app has, and the honest value when nobody
    /// counted is none.
    #[serde(default)]
    pub images_skipped: u32,
}

impl ImportReceipt {
    /// A refusal: nothing was written, so every count is zero.
    pub fn refused(outcome: ImportOutcome, file_app_version: impl Into<String>) -> Self {
        ImportReceipt {
            outcome,
            classes: 0,
            scenes: 0,
            members: 0,
            planner_imported: false,
            planner_skipped: false,
            file_app_version: file_app_version.into(),
            images_skipped: 0,
        }
    }
}

/// Every picture id the screens in this file point at — the class defaults as
/// well as the library, because a default screen is not in `file.scenes` and
/// that is the easy half to forget (`check_limits` learned the same lesson).
///
/// Read off the RAW config strings, exactly the way `without_names` operates
/// on the export side: a typed round trip through `WidgetConfig` would drop
/// every kind this build does not know, and with it every picture such a kind
/// points at.
pub fn referenced_image_ids(file: &TransferFile) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut scan = |scene: &TransferScene| {
        for widget in &scene.widgets {
            images::collect_referenced(&widget.config, &mut out);
        }
    };
    for class in &file.classes {
        if let Some(scene) = &class.default_scene {
            scan(scene);
        }
    }
    for scene in &file.scenes {
        scan(scene);
    }
    out
}

/// Write the file's pictures into `dir`, and answer with how many of the
/// REFERENCED ones this machine ends up without.
///
/// The order matters and is the whole reason this runs before the
/// transaction: a config pointing at a picture that is not on disk yet draws
/// «bildet mangler» for as long as that is true, so the bytes go down first
/// and the rows arrive to find them already there.
///
/// Four ways a referenced picture can fail to land, and all four count the
/// same on the receipt because they mean the same thing to a teacher — the
/// picture is not on this machine and she must put it back:
///
/// 1. the file has no `TransferImage` with that id (it was written by a build
///    from before pictures travelled, or the export's ceiling cut it),
/// 2. the id is not one this app will turn into a file name,
/// 3. the base64 does not decode,
/// 4. the decoded bytes are not a PNG, JPEG or WebP — sniffed HERE too,
///    because a file's `mime` field is a claim and the bytes are the evidence.
///
/// A picture the machine ALREADY has under that id is not written again and
/// not counted: ids are UUIDs, so the same id is the same picture, and
/// re-importing a setup onto the machine that made it costs nothing.
///
/// `dir` is `None` only where there is no app-data directory to write into —
/// the storage tests. The COUNT is still exact there, because it is a fact
/// about the file rather than about the disk.
fn write_images(file: &TransferFile, dir: Option<&Path>) -> u32 {
    let referenced = referenced_image_ids(file);
    if referenced.is_empty() {
        return 0;
    }
    let mut landed: HashSet<&str> = HashSet::new();
    for image in &file.images {
        let Some(id) = sanitized_image_id(&image.id) else {
            continue;
        };
        if !referenced.contains(&id) {
            // Bytes nothing points at. Not written: the boot sweep would
            // collect them on the next start anyway, and a store only holds
            // what something is asking for.
            continue;
        }
        let Some(dir) = dir else {
            // No disk to write to, but the file DID carry this picture — so
            // it is not one of the missing ones.
            landed.insert(&image.id);
            continue;
        };
        if images::find_stored(dir, &id).is_some() {
            landed.insert(&image.id);
            continue;
        }
        let bytes = match base64::engine::general_purpose::STANDARD.decode(&image.bytes_base64) {
            Ok(bytes) => bytes,
            Err(e) => {
                tracing::warn!(id = %id, "an imported picture is not valid base64: {e}");
                continue;
            }
        };
        match images::write_stored(dir, &id, &bytes) {
            Ok(Some(_)) => {
                landed.insert(&image.id);
            }
            Ok(None) => tracing::warn!(
                id = %id,
                "an imported picture's bytes are not a PNG, JPEG or WebP — not stored"
            ),
            Err(e) => tracing::warn!(id = %id, "storing an imported picture failed: {e}"),
        }
    }
    // What the machine has, whichever way it got it.
    let missing = referenced
        .iter()
        .filter(|id| {
            if landed.contains(id.as_str()) {
                return false;
            }
            match (dir, sanitized_image_id(id)) {
                (Some(dir), Some(id)) => images::find_stored(dir, &id).is_none(),
                _ => true,
            }
        })
        .count();
    u32::try_from(missing).unwrap_or(u32::MAX)
}

/// Names the store would refuse from the UI, so the import refuses them too
/// (`valid_class_name`/`valid_scene_name` both reject an empty name). Returns
/// the first problem found, as a stable identifier for the log.
fn first_shape_problem(file: &TransferFile) -> Option<String> {
    fn scene_problem(scene: &TransferScene) -> Option<String> {
        scene
            .name
            .trim()
            .is_empty()
            .then(|| format!("screen «{}» has an empty name", scene.id))
    }
    for class in &file.classes {
        if class.name.trim().is_empty() {
            return Some(format!("class «{}» has an empty name", class.id));
        }
        if let Some(scene) = &class.default_scene {
            if let Some(p) = scene_problem(scene) {
                return Some(p);
            }
        }
    }
    for scene in &file.scenes {
        if let Some(p) = scene_problem(scene) {
            return Some(p);
        }
    }
    // The week plan's own integrity, checked BEFORE the first INSERT — the
    // two ways it could be wrong both used to be discovered too late, and
    // both were discovered in silence:
    //
    // - a cell pointing at a period the file does not contain was SKIPPED with
    //   a `continue` in `insert_week`, while the receipt still said
    //   «Importert» with the class count that did land. A Tuesday that
    //   vanished on the way over is not something a teacher should find out
    //   about on Tuesday.
    // - two cells claiming the same (weekday, period) hit `UNIQUE (weekday,
    //   period_id)` mid-transaction, i.e. a generic `Err` out of a command
    //   whose whole vocabulary is receipts.
    //
    // Both are the same fact — the file cannot be read — so both get the same
    // sentence: «Fila kunne ikke leses. Ingenting ble endret.»
    let known_periods: std::collections::HashSet<&str> =
        file.planner.periods.iter().map(|p| p.id.as_str()).collect();
    let mut seen_cells: std::collections::HashSet<(u8, &str)> = std::collections::HashSet::new();
    for slot in &file.planner.week {
        // The weekly grid has Monday–Friday columns and nothing else, so a
        // slot outside that range could never be shown. Refusing beats
        // dropping it in silence.
        if !(1..=5).contains(&slot.weekday) {
            return Some(format!("weekday {} is outside 1..=5", slot.weekday));
        }
        if !known_periods.contains(slot.period_id.as_str()) {
            return Some(format!(
                "week slot (weekday {}) points at period «{}», which is not in the file",
                slot.weekday, slot.period_id
            ));
        }
        if !seen_cells.insert((slot.weekday, slot.period_id.as_str())) {
            return Some(format!(
                "two week slots claim weekday {} period «{}»",
                slot.weekday, slot.period_id
            ));
        }
    }
    None
}

/// The periods this file wants, normalized the way the editor would have
/// normalized them — or `None` when normalizing would have CHANGED the set
/// (a zero-length period dropped, two periods overlapping). A direct INSERT
/// bypasses `planner_periods_set`'s gate, so the gate is applied here instead.
fn normalized_periods(file: &TransferFile) -> Option<Vec<Period>> {
    let wanted: Vec<Period> = file
        .planner
        .periods
        .iter()
        .map(|p| Period {
            id: p.id.clone(),
            label: p.label.clone(),
            start_min: p.start_min,
            end_min: p.end_min,
            kind: p.kind,
            sort_index: 0,
        })
        .collect();
    let n = wanted.len();
    let normalized = schedule::normalize_periods(wanted);
    if normalized.len() != n || schedule::periods_overlap(&normalized) {
        return None;
    }
    Some(normalized)
}

/// The backdrop word to store for an incoming screen — through
/// [`SceneTheme::parse`], so a spelling from a newer build (or a hand-edited
/// file) lands on `standard` instead of travelling into the column raw. A
/// screen the file did not describe at all gets the default too.
///
/// The parse is what keeps the column's vocabulary CLOSED: everything else in
/// an imported widget row is deliberately raw (promise 3), and a theme is the
/// opposite case — nothing renders an unknown one, so storing it would only
/// hide the fallback until the next read.
fn scene_theme(scene: Option<&TransferScene>) -> &'static str {
    SceneTheme::parse(scene.map(|s| s.theme.as_str()).unwrap_or_default()).as_str()
}

/// Write one scene's widgets, with fresh ids, into `scene_id`.
///
/// `kind` and `config` go in as the RAW strings they came out as — never
/// through `WidgetConfig`. A widget kind this build has never heard of
/// survives the trip intact, exactly as it survives a downgraded save
/// (promise 3); interpreting it here would be the one place that quietly
/// dropped it.
async fn insert_widgets(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    scene_id: &str,
    widgets: &[TransferWidget],
    stamp: f64,
) -> AppResult<()> {
    for (z, widget) in widgets.iter().enumerate() {
        sqlx::query(
            "INSERT INTO widget_instance (id, scene_id, kind, x, y, w, h, z, config, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(new_id())
        .bind(scene_id)
        .bind(&widget.kind)
        .bind(widget.x)
        .bind(widget.y)
        .bind(widget.w)
        .bind(widget.h)
        // Re-stacked densely in file order rather than trusting the stored
        // `z`: the incoming numbers are only meaningful relative to each
        // other, and `load_for` re-indexes them anyway.
        .bind(z as i64)
        .bind(&widget.config)
        .bind(stamp)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// The weekly timetable, remapped. A class or screen pointer that cannot be
/// remapped becomes `NULL`, which is a legal, meaningful state — the same one
/// migration 0004's `ON DELETE SET NULL` produces.
///
/// The `continue` on a missing PERIOD is now unreachable and stays as a
/// guard, not as a policy: `first_shape_problem` refuses the whole file for
/// exactly that shape, so nothing may quietly disappear here. It is kept
/// because the alternative on a broken invariant would be an `unwrap`.
async fn insert_week(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    week: &[TransferSlot],
    maps: &Maps,
    stamp: f64,
) -> AppResult<()> {
    for slot in week {
        let Some(period_id) = maps.periods.get(&slot.period_id) else {
            continue;
        };
        let class_id = slot
            .class_id
            .as_ref()
            .and_then(|id| maps.classes.get(id))
            .cloned();
        let scene_id = slot
            .scene_id
            .as_ref()
            .and_then(|id| maps.scenes.get(id))
            .cloned();
        sqlx::query(
            "INSERT INTO week_slot
               (id, weekday, period_id, class_id, subject, scene_id,
                merged_with_next, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(new_id())
        .bind(i64::from(slot.weekday))
        .bind(period_id)
        .bind(class_id)
        .bind(&slot.subject)
        .bind(&scene_id)
        // Carried, not derived: a double lesson that arrived as two singles
        // would be a silent loss the receipt could not mention.
        .bind(slot.merged_with_next as i64)
        .bind(stamp)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// The three old-id → new-id tables, filled in the order the module header
/// spells out.
#[derive(Default)]
struct Maps {
    classes: HashMap<String, String>,
    scenes: HashMap<String, String>,
    periods: HashMap<String, String>,
}

/// Adopt a parsed setup file. ONE transaction for every row: a failure
/// halfway leaves the database exactly as it was.
///
/// Returns a RECEIPT rather than an error for the two ways a file can be
/// refused on its content (too large, malformed) — nothing was written in
/// either case, and the panel has a specific sentence for each. Only a real
/// storage failure travels as `Err`.
///
/// `images_dir` is where the file's pictures are written — BEFORE the
/// transaction opens, so a config never arrives at a picture that is not
/// there yet. `None` means "no disk for pictures" (the storage tests); the
/// receipt's `images_skipped` is exact either way, because it is a fact about
/// the file.
///
/// A picture written for an import that then REFUSES is not cleaned up here,
/// and that is deliberate: it is an orphan, the boot sweep is what collects
/// orphans, and adding a second deletion path — one that runs on the error
/// road, where the least is known — is how a rollback learns to delete a file
/// somebody else's screen was pointing at.
pub async fn import_setup(
    pool: &SqlitePool,
    file: &TransferFile,
    images_dir: Option<&Path>,
) -> AppResult<ImportReceipt> {
    let app_version = file.app_version.clone();

    // Both gates run BEFORE the transaction opens: a refusal must cost
    // nothing, not even a rolled-back write.
    if let Err(breach) = transfer::check_limits(file) {
        tracing::warn!("setup import refused — {breach}");
        return Ok(ImportReceipt::refused(ImportOutcome::TooLarge, app_version));
    }
    if let Some(problem) = first_shape_problem(file) {
        tracing::warn!("setup import refused — {problem}");
        return Ok(ImportReceipt::refused(
            ImportOutcome::Unreadable,
            app_version,
        ));
    }
    let periods = match normalized_periods(file) {
        Some(periods) => periods,
        None => {
            tracing::warn!("setup import refused — the period template is not a valid school day");
            return Ok(ImportReceipt::refused(
                ImportOutcome::Unreadable,
                app_version,
            ));
        }
    };

    // The pictures FIRST — after every gate that can still refuse the file,
    // and before the first row that could point at one.
    let images_skipped = write_images(file, images_dir);

    let stamp = now_ms();
    let mut maps = Maps::default();
    let mut members_added: u32 = 0;
    let mut tx = pool.begin().await?;

    // ── 1–3. Classes, their default screens, their names, their widgets ─────
    let mut class_sort: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(sort_index) + 1, 0) FROM class")
            .fetch_one(&mut *tx)
            .await?;
    for class in &file.classes {
        let class_id = new_id();
        let name = class.name.trim();
        sqlx::query("INSERT INTO class (id, name, sort_index, created_at) VALUES (?1, ?2, ?3, ?4)")
            .bind(&class_id)
            .bind(name)
            .bind(class_sort)
            .bind(stamp)
            .execute(&mut *tx)
            .await?;
        class_sort += 1;
        maps.classes.insert(class.id.clone(), class_id.clone());

        // The default screen is DERIVED from the new class id, and the
        // derivation is what goes into the scene map (see the header).
        let scene_id = default_scene_id(&class_id);
        let scene_name = class
            .default_scene
            .as_ref()
            .map(|s| s.name.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(name);
        sqlx::query(
            "INSERT INTO scene (id, class_id, name, sort_index, created_at, theme)
             VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        )
        .bind(&scene_id)
        .bind(&class_id)
        .bind(scene_name)
        .bind(stamp)
        .bind(scene_theme(class.default_scene.as_ref()))
        .execute(&mut *tx)
        .await?;
        if let Some(source) = &class.default_scene {
            maps.scenes.insert(source.id.clone(), scene_id.clone());
            insert_widgets(&mut tx, &scene_id, &source.widgets, stamp).await?;
        }

        for (i, member) in class.members.iter().enumerate() {
            let member = member.trim();
            if member.is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT INTO class_member (id, class_id, name, sort_index, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(new_id())
            .bind(&class_id)
            .bind(member)
            .bind(i as i64)
            .bind(stamp)
            .execute(&mut *tx)
            .await?;
            members_added += 1;
        }
    }

    // ── 4. The library screens ──────────────────────────────────────────────
    let mut scene_sort: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_index) + 1, 0) FROM scene WHERE class_id IS NULL",
    )
    .fetch_one(&mut *tx)
    .await?;
    for scene in &file.scenes {
        let scene_id = new_id();
        sqlx::query(
            "INSERT INTO scene (id, class_id, name, sort_index, created_at, theme)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5)",
        )
        .bind(&scene_id)
        .bind(scene.name.trim())
        .bind(scene_sort)
        .bind(stamp)
        .bind(scene_theme(Some(scene)))
        .execute(&mut *tx)
        .await?;
        scene_sort += 1;
        maps.scenes.insert(scene.id.clone(), scene_id.clone());
        insert_widgets(&mut tx, &scene_id, &scene.widgets, stamp).await?;
    }

    // ── 5. The school day, only into an empty one ───────────────────────────
    let has_planner = !periods.is_empty();
    let existing_periods: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM period")
        .fetch_one(&mut *tx)
        .await?;
    let planner_imported = has_planner && existing_periods == 0;
    if planner_imported {
        for period in &periods {
            // Minted BEFORE the insert, so the map and the row cannot
            // disagree about which id the week plan should point at.
            let period_id = new_id();
            sqlx::query(
                "INSERT INTO period (id, label, start_min, end_min, kind, sort_index, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .bind(&period_id)
            .bind(&period.label)
            .bind(i64::from(period.start_min))
            .bind(i64::from(period.end_min))
            .bind(period_kind_tag(period.kind))
            .bind(period.sort_index)
            .bind(stamp)
            .execute(&mut *tx)
            .await?;
            maps.periods.insert(period.id.clone(), period_id);
        }
        insert_week(&mut tx, &file.planner.week, &maps, stamp).await?;
    }

    tx.commit().await?;

    Ok(ImportReceipt {
        outcome: ImportOutcome::Imported,
        classes: file.classes.len() as u32,
        scenes: file.scenes.len() as u32,
        members: members_added,
        planner_imported,
        planner_skipped: has_planner && !planner_imported,
        file_app_version: app_version,
        images_skipped,
    })
}

/// Row count for one table — used by the round-trip tests in
/// `commands/transfer.rs`, kept here so the SELECT lives next to the INSERTs
/// it verifies.
#[cfg(test)]
pub(crate) async fn count(pool: &SqlitePool, table: &'static str) -> i64 {
    // AssertSqlSafe: `table` is a literal from the calling test.
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
        .fetch_one(pool)
        .await
        .expect("count")
}
