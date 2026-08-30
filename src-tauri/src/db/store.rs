//! SQLite-backed local store (sqlx).
//!
//! All queries are runtime-checked (`sqlx::query` + `.bind()`), so building
//! needs no `DATABASE_URL` or `.sqlx` cache. Every function takes
//! `&SqlitePool`, so they are unit-tested against a throwaway temp database
//! with no app or device — see the tests at the bottom.
//!
//! One database file for the app (settings + classes + layouts + the
//! name-picker pool). The schema lives in `migrations/` and is applied by
//! [`open_pool`]. Conventions: TEXT UUID v7 ids, REAL epoch-ms timestamps,
//! foreign keys enforced.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Row, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Epoch milliseconds as f64 — matches the REAL columns and the TS `number`.
pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// A fresh time-ordered id (UUID v7).
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

/// The connection options every pool in the app is opened with. Kept as one
/// function so a test that simulates another build's boot (the downgrade test)
/// connects the same way the app does, instead of drifting from it.
fn connect_options(db_path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true)
        // Write-ahead logging: readers no longer block the writer, so a
        // layout save during a name draw waits for nothing. It is a property
        // of the FILE, not the connection — an existing database is converted
        // on the first connect and stays converted.
        //
        // WAL adds `sundayscreen.sqlite-wal` and `-shm` next to the database:
        // `quarantine_database` moves them with the main file, and
        // `backup_rotating` uses `VACUUM INTO`, which reads through the WAL
        // rather than around it. A plain file copy would not.
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        // Wait for a lock instead of failing instantly. This restates sqlx's
        // own default rather than changing it — written down because the
        // value matters to us: five seconds is the ceiling on how long a boot
        // may hang before the user is told something is wrong, and the WAL
        // conversion above is exactly the kind of exclusive-lock moment that
        // needs a bounded wait.
        .busy_timeout(std::time::Duration::from_secs(5))
}

/// Open (creating if needed) the SQLite database at `db_path` and run all
/// pending migrations. Foreign keys are enforced.
pub async fn open_pool(db_path: &Path) -> AppResult<SqlitePool> {
    let pool = SqlitePool::connect_with(connect_options(db_path)).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}

/// The file-name suffixes SQLite keeps alongside the main database file.
/// `-wal`/`-shm` belong to WAL mode; `-journal` is what a rollback-journal
/// database (every install made before WAL was turned on) leaves behind after
/// a crash. Quarantine has to move them TOGETHER: a stale sidecar left next
/// to a freshly created database is read as that database's own log.
const SIDECAR_SUFFIXES: [&str; 4] = ["", "-wal", "-shm", "-journal"];

/// Move a database that is positively corrupt out of the way — with its
/// sidecars — so a fresh one can be created next to it. Returns the paths
/// actually moved.
///
/// The bytes are kept (renamed, never deleted) so a rescue is still possible.
/// The ONLY caller is the boot path, and only when
/// [`crate::error::should_quarantine`] said yes: a migration failure must
/// never reach this function.
pub fn quarantine_database(db_path: &Path, stamp: u64) -> Vec<PathBuf> {
    let mut moved = Vec::new();
    let Some(name) = db_path.file_name().and_then(|n| n.to_str()) else {
        tracing::error!(db = %db_path.display(), "cannot quarantine: unusable file name");
        return moved;
    };
    for suffix in SIDECAR_SUFFIXES {
        let src = db_path.with_file_name(format!("{name}{suffix}"));
        if !src.exists() {
            continue;
        }
        let dst = db_path.with_file_name(format!("{name}{suffix}.corrupt-{stamp}"));
        match std::fs::rename(&src, &dst) {
            Ok(()) => moved.push(dst),
            Err(e) => tracing::error!(file = %src.display(), "quarantine rename failed: {e}"),
        }
    }
    moved
}

// ── Rotating startup backup ──────────────────────────────────────────────────

/// How many generations of startup backup are kept beside the database.
pub const BACKUP_SLOTS: usize = 3;

/// `sundayscreen.sqlite` + `"1"` → `sundayscreen.backup-1.sqlite`.
fn backup_path(db_path: &Path, slot: &str) -> PathBuf {
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sundayscreen");
    db_path.with_file_name(format!("{stem}.backup-{slot}.sqlite"))
}

/// Copy the open database aside and rotate the older copies down: `backup-1`
/// is always the newest, `backup-3` the oldest still kept.
///
/// `VACUUM INTO`, never `fs::copy`. A file copy is journal-unaware — under WAL
/// the committed truth is spread across the `.sqlite` file and its `-wal`, so
/// copying the main file alone can yield a torn or stale database. `VACUUM
/// INTO` asks SQLite itself for a consistent snapshot, inside a read
/// transaction, and writes a defragmented copy.
///
/// Meant to be called AFTER a successful [`open_pool`], so the copy always
/// holds a fully migrated schema — never a half-migrated one.
///
/// The snapshot is written to a temp file first and only rotated in once it
/// exists: a disk that fills up mid-vacuum must not cost us the copies we
/// already had, and `backup-1` must never be a half-written file.
pub async fn backup_rotating(pool: &SqlitePool, db_path: &Path) -> AppResult<PathBuf> {
    let tmp = backup_path(db_path, "tmp");
    let tmp_str = tmp.to_str().ok_or_else(|| {
        AppError::Internal(format!("backup path is not valid UTF-8: {}", tmp.display()))
    })?;
    // VACUUM INTO refuses to write onto an existing file — clear whatever a
    // crashed earlier run left behind.
    if tmp.exists() {
        std::fs::remove_file(&tmp)?;
    }
    sqlx::query("VACUUM INTO ?1")
        .bind(tmp_str)
        .execute(pool)
        .await?;

    let oldest = backup_path(db_path, &BACKUP_SLOTS.to_string());
    if oldest.exists() {
        std::fs::remove_file(&oldest)?;
    }
    for slot in (1..BACKUP_SLOTS).rev() {
        let from = backup_path(db_path, &slot.to_string());
        if from.exists() {
            std::fs::rename(&from, backup_path(db_path, &(slot + 1).to_string()))?;
        }
    }
    let newest = backup_path(db_path, "1");
    std::fs::rename(&tmp, &newest)?;
    Ok(newest)
}

// ── Settings (key/value bag) ─────────────────────────────────────────────────

/// Read a setting's raw (JSON-encoded) value, or `None` if unset.
pub async fn get_setting(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let row = sqlx::query("SELECT value FROM app_setting WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get::<String, _>("value")))
}

/// Insert or update a setting (UPSERT) — there is no separate "save" step.
pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_setting (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Classes ──────────────────────────────────────────────────────────────────

/// One class row. Exported to TS as `Class`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "Class.ts", rename = "Class")]
#[serde(rename_all = "camelCase")]
pub struct ClassRow {
    pub id: String,
    pub name: String,
    // i64 would map to `bigint` in TS; force `number` (display order stays
    // far below 2^53).
    #[ts(type = "number")]
    pub sort_index: i64,
    pub created_at: f64,
}

fn row_to_class(r: sqlx::sqlite::SqliteRow) -> ClassRow {
    ClassRow {
        id: r.get("id"),
        name: r.get("name"),
        sort_index: r.get("sort_index"),
        created_at: r.get("created_at"),
    }
}

/// Look a class up by id.
pub async fn get_class(pool: &SqlitePool, id: &str) -> AppResult<Option<ClassRow>> {
    let row = sqlx::query("SELECT id, name, sort_index, created_at FROM class WHERE id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(row_to_class))
}

/// The first class in display order, if any.
pub async fn first_class(pool: &SqlitePool) -> AppResult<Option<ClassRow>> {
    let row = sqlx::query(
        "SELECT id, name, sort_index, created_at FROM class
         ORDER BY sort_index, created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(row_to_class))
}

/// Create a class at the end of the display order — together with its
/// default scene ('default-' || id, matching the 0003 backfill), in one
/// transaction: a class without a default scene is an unrepresentable state.
pub async fn insert_class(pool: &SqlitePool, name: &str) -> AppResult<ClassRow> {
    let next: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_index) + 1, 0) FROM class")
        .fetch_one(pool)
        .await?;
    let row = ClassRow {
        id: new_id(),
        name: name.to_string(),
        sort_index: next,
        created_at: now_ms(),
    };
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO class (id, name, sort_index, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(&row.id)
        .bind(&row.name)
        .bind(row.sort_index)
        .bind(row.created_at)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO scene (id, class_id, name, sort_index, created_at)
         VALUES (?1, ?2, ?3, 0, ?4)",
    )
    .bind(default_scene_id(&row.id))
    .bind(&row.id)
    .bind(&row.name)
    .bind(row.created_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

/// Every class, in display order.
pub async fn list_classes(pool: &SqlitePool) -> AppResult<Vec<ClassRow>> {
    let rows = sqlx::query(
        "SELECT id, name, sort_index, created_at FROM class
         ORDER BY sort_index, created_at",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_class).collect())
}

/// Rename a class. Returns whether a row was actually touched.
pub async fn rename_class(pool: &SqlitePool, id: &str, name: &str) -> AppResult<bool> {
    let res = sqlx::query("UPDATE class SET name = ?1 WHERE id = ?2")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Delete a class — members, widgets and draw state cascade with it.
/// Returns whether a row was actually deleted.
pub async fn delete_class(pool: &SqlitePool, id: &str) -> AppResult<bool> {
    let res = sqlx::query("DELETE FROM class WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

// ── Members ──────────────────────────────────────────────────────────────────

/// One pupil row. Exported to TS as `Member`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "Member.ts", rename = "Member")]
#[serde(rename_all = "camelCase")]
pub struct MemberRow {
    pub id: String,
    pub name: String,
    // i64 would map to `bigint` in TS; force `number`.
    #[ts(type = "number")]
    pub sort_index: i64,
    /// The local wall date this pupil was marked away, or `None`. "Away
    /// today" is `absent_on == today` — a DATE STAMP, so yesterday's absence
    /// expires by itself, with no reset job to miss a day (migration 0005).
    /// Overwritten, never appended to: there is no attendance history here.
    #[serde(default)]
    pub absent_on: Option<String>,
}

/// The SELECT list every member read shares — one place to change when the
/// row grows a column.
const MEMBER_COLS: &str = "id, name, sort_index, absent_on";

fn row_to_member(r: sqlx::sqlite::SqliteRow) -> MemberRow {
    MemberRow {
        id: r.get("id"),
        name: r.get("name"),
        sort_index: r.get("sort_index"),
        absent_on: r.get("absent_on"),
    }
}

/// A class's members, in display order — EVERYONE, including whoever is
/// marked away today (the manage panel and the attendance panel both need
/// the full list). Generic over the executor so the picker can read them
/// inside its draw transaction (F9-funn #2).
pub async fn list_members<'e, E>(executor: E, class_id: &str) -> AppResult<Vec<MemberRow>>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    // AssertSqlSafe: `MEMBER_COLS` is a const in this file, never input.
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {MEMBER_COLS} FROM class_member
         WHERE class_id = ?1 ORDER BY sort_index, created_at"
    )))
    .bind(class_id)
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(row_to_member).collect())
}

/// A class's members who are HERE today, in display order.
///
/// `today` is the frontend's local wall date (ADR-009). The comparison is
/// `absent_on <> today` rather than "clear it at midnight", which is what
/// makes a machine that stood switched off across the day change correct on
/// its own: an old stamp simply stops matching.
///
/// This is the list the picker and the group split deal from —
/// [`list_members`] stays untouched so the manage panel keeps showing the
/// whole class.
pub async fn list_present_members<'e, E>(
    executor: E,
    class_id: &str,
    today: &str,
) -> AppResult<Vec<MemberRow>>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    // AssertSqlSafe: `MEMBER_COLS` is a const in this file, never input.
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {MEMBER_COLS} FROM class_member
         WHERE class_id = ?1 AND (absent_on IS NULL OR absent_on <> ?2)
         ORDER BY sort_index, created_at"
    )))
    .bind(class_id)
    .bind(today)
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(row_to_member).collect())
}

/// Mark one pupil away today (`absent = true` stamps `today`) or back
/// (`false` clears the stamp). Returns whether a row was actually touched —
/// the `class_id` predicate is the same discipline as `replace_members`
/// (F9-funn #1): a member id from another class must MISS, never write.
pub async fn set_member_absent(
    pool: &SqlitePool,
    class_id: &str,
    member_id: &str,
    absent: bool,
    today: &str,
) -> AppResult<bool> {
    let stamp = absent.then(|| today.to_string());
    let res = sqlx::query("UPDATE class_member SET absent_on = ?1 WHERE id = ?2 AND class_id = ?3")
        .bind(stamp)
        .bind(member_id)
        .bind(class_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Replace a class's member list from reconciled specs, in one transaction.
/// A spec WITH an id keeps that row (its draw state survives); rows whose id
/// is not in the specs are deleted (their draw state cascades away); a spec
/// without an id gets a fresh row. `sort_index` becomes the spec order.
pub async fn replace_members(
    pool: &SqlitePool,
    class_id: &str,
    specs: &[sundayscreen_core::members::MemberSpec],
) -> AppResult<Vec<MemberRow>> {
    let mut tx = pool.begin().await?;

    let kept: Vec<&str> = specs.iter().filter_map(|s| s.id.as_deref()).collect();
    // Delete rows that are NOT kept. (No sqlx array-bind for sqlite — the
    // list is small, so delete-all-then-skip-kept is done per row instead.)
    let existing_ids: Vec<String> = sqlx::query("SELECT id FROM class_member WHERE class_id = ?1")
        .bind(class_id)
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|r| r.get::<String, _>("id"))
        .collect();
    for id in &existing_ids {
        if !kept.contains(&id.as_str()) {
            sqlx::query("DELETE FROM class_member WHERE id = ?1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }

    let stamp = now_ms();
    for (i, spec) in specs.iter().enumerate() {
        let sort_index = i as i64;
        match &spec.id {
            Some(id) => {
                // The class_id predicate + rows_affected check are the F9
                // finding-#1 fix: a kept id whose row vanished (a racing
                // save, or a spec pointing into another class) must FAIL the
                // whole transaction — never answer a fabricated "saved".
                let res = sqlx::query(
                    "UPDATE class_member SET name = ?1, sort_index = ?2
                     WHERE id = ?3 AND class_id = ?4",
                )
                .bind(&spec.name)
                .bind(sort_index)
                .bind(id)
                .bind(class_id)
                .execute(&mut *tx)
                .await?;
                if res.rows_affected() == 0 {
                    return Err(crate::error::AppError::Internal(format!(
                        "member row {id} vanished mid-save — retry the save"
                    )));
                }
            }
            None => {
                sqlx::query(
                    "INSERT INTO class_member (id, class_id, name, sort_index, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(new_id())
                .bind(class_id)
                .bind(&spec.name)
                .bind(sort_index)
                .bind(stamp)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    // Read the rows BACK instead of assembling them from the specs: the
    // UPDATE deliberately leaves `absent_on` alone (editing the name list
    // must not un-mark today's absences), and a hand-built row would have to
    // guess that column — the first quiet way for the returned list and the
    // database to disagree.
    let out = list_members(&mut *tx, class_id).await?;
    tx.commit().await?;
    Ok(out)
}

// ── The picker's draw state ──────────────────────────────────────────────────

/// Member ids drawn in the current round, for a class.
pub async fn drawn_member_ids<'e, E>(executor: E, class_id: &str) -> AppResult<Vec<String>>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let rows = sqlx::query("SELECT member_id FROM draw_state WHERE class_id = ?1")
        .bind(class_id)
        .fetch_all(executor)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| r.get::<String, _>("member_id"))
        .collect())
}

/// Remember that a member has been drawn this round. Idempotent.
pub async fn insert_drawn<'e, E>(executor: E, class_id: &str, member_id: &str) -> AppResult<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query(
        "INSERT INTO draw_state (class_id, member_id, drawn_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(class_id, member_id) DO NOTHING",
    )
    .bind(class_id)
    .bind(member_id)
    .bind(now_ms())
    .execute(executor)
    .await?;
    Ok(())
}

/// Start a fresh round.
pub async fn clear_drawn<'e, E>(executor: E, class_id: &str) -> AppResult<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query("DELETE FROM draw_state WHERE class_id = ?1")
        .bind(class_id)
        .execute(executor)
        .await?;
    Ok(())
}

// ── Scenes ───────────────────────────────────────────────────────────────────

/// One scene row. `class_id = None` is a GLOBAL library scene; `Some` is a
/// class's default screen. Exported to TS as `Scene`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "Scene.ts", rename = "Scene")]
#[serde(rename_all = "camelCase")]
pub struct SceneRow {
    pub id: String,
    pub class_id: Option<String>,
    pub name: String,
    #[ts(type = "number")]
    pub sort_index: i64,
    pub created_at: f64,
}

/// The deterministic id of a class's default scene — the same shape the
/// 0003 backfill minted, so healing paths and tests can rely on it.
pub fn default_scene_id(class_id: &str) -> String {
    format!("default-{class_id}")
}

fn row_to_scene(r: sqlx::sqlite::SqliteRow) -> SceneRow {
    SceneRow {
        id: r.get("id"),
        class_id: r.get("class_id"),
        name: r.get("name"),
        sort_index: r.get("sort_index"),
        created_at: r.get("created_at"),
    }
}

/// Look a scene up by id.
pub async fn get_scene(pool: &SqlitePool, id: &str) -> AppResult<Option<SceneRow>> {
    let row =
        sqlx::query("SELECT id, class_id, name, sort_index, created_at FROM scene WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(row_to_scene))
}

/// Every GLOBAL library scene, in display order.
pub async fn list_global_scenes(pool: &SqlitePool) -> AppResult<Vec<SceneRow>> {
    let rows = sqlx::query(
        "SELECT id, class_id, name, sort_index, created_at FROM scene
         WHERE class_id IS NULL ORDER BY sort_index, created_at",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_scene).collect())
}

/// Create a GLOBAL scene at the end of the library order.
pub async fn insert_global_scene(pool: &SqlitePool, name: &str) -> AppResult<SceneRow> {
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_index) + 1, 0) FROM scene WHERE class_id IS NULL",
    )
    .fetch_one(pool)
    .await?;
    let row = SceneRow {
        id: new_id(),
        class_id: None,
        name: name.to_string(),
        sort_index: next,
        created_at: now_ms(),
    };
    sqlx::query(
        "INSERT INTO scene (id, class_id, name, sort_index, created_at)
         VALUES (?1, NULL, ?2, ?3, ?4)",
    )
    .bind(&row.id)
    .bind(&row.name)
    .bind(row.sort_index)
    .bind(row.created_at)
    .execute(pool)
    .await?;
    Ok(row)
}

/// Rename a scene. Returns false when the id is unknown.
pub async fn rename_scene(pool: &SqlitePool, id: &str, name: &str) -> AppResult<bool> {
    let res = sqlx::query("UPDATE scene SET name = ?2 WHERE id = ?1")
        .bind(id)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Delete a scene (its widgets cascade). Returns false when unknown.
pub async fn delete_scene(pool: &SqlitePool, id: &str) -> AppResult<bool> {
    let res = sqlx::query("DELETE FROM scene WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// A class's default scene — heals a pre-0003 edge by minting it if the row
/// is somehow missing (the invariant says it never should be).
pub async fn ensure_default_scene(pool: &SqlitePool, class: &ClassRow) -> AppResult<SceneRow> {
    let id = default_scene_id(&class.id);
    if let Some(scene) = get_scene(pool, &id).await? {
        return Ok(scene);
    }
    let row = SceneRow {
        id: id.clone(),
        class_id: Some(class.id.clone()),
        name: class.name.clone(),
        sort_index: 0,
        created_at: now_ms(),
    };
    sqlx::query(
        "INSERT INTO scene (id, class_id, name, sort_index, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&row.id)
    .bind(&row.class_id)
    .bind(&row.name)
    .bind(row.sort_index)
    .bind(row.created_at)
    .execute(pool)
    .await?;
    Ok(row)
}

// ── Widgets ──────────────────────────────────────────────────────────────────

/// A raw widget row as stored. The tolerance seam
/// (`sundayscreen_core::layout::row_to_instance`) decides what renders —
/// this layer never interprets `kind`/`config`, which is exactly what lets an
/// unknown kind survive a downgrade.
#[derive(Debug, Clone, PartialEq)]
pub struct WidgetRow {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: i64,
    pub config: String,
}

/// Every widget row for a scene, in z order.
pub async fn load_widget_rows(pool: &SqlitePool, scene_id: &str) -> AppResult<Vec<WidgetRow>> {
    let rows = sqlx::query(
        "SELECT id, kind, x, y, w, h, z, config FROM widget_instance
         WHERE scene_id = ?1 ORDER BY z, id",
    )
    .bind(scene_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| WidgetRow {
            id: r.get("id"),
            kind: r.get("kind"),
            x: r.get("x"),
            y: r.get("y"),
            w: r.get("w"),
            h: r.get("h"),
            z: r.get("z"),
            config: r.get("config"),
        })
        .collect())
}

/// Replace a SCENE's entire layout in one transaction — idempotent and
/// atomic: a failed insert rolls the delete back, so a crash mid-save can
/// never leave a mixed layout. Scene-scoped on purpose: saving scene A must
/// never touch scene B's rows.
pub async fn replace_widgets(
    pool: &SqlitePool,
    scene_id: &str,
    rows: &[WidgetRow],
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM widget_instance WHERE scene_id = ?1")
        .bind(scene_id)
        .execute(&mut *tx)
        .await?;
    let stamp = now_ms();
    for row in rows {
        sqlx::query(
            "INSERT INTO widget_instance (id, scene_id, kind, x, y, w, h, z, config, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&row.id)
        .bind(scene_id)
        .bind(&row.kind)
        .bind(row.x)
        .bind(row.y)
        .bind(row.w)
        .bind(row.h)
        .bind(row.z)
        .bind(&row.config)
        .bind(stamp)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{should_quarantine, AppError};

    /// A pool over a temp-dir database file, fully migrated.
    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    /// The 0003 rebuild against a REAL pre-0003 database: run only the first
    /// two migrations, populate the old schema, then let `open_pool` apply
    /// the rest — every class must get its deterministic default scene and
    /// every widget row must be adopted into it.
    #[tokio::test]
    async fn migration_0003_adopts_existing_layouts_into_default_scenes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("pre0003.sqlite");

        {
            let opts = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true);
            let pool = SqlitePool::connect_with(opts).await.expect("raw pool");

            let full = sqlx::migrate!();
            let pre = sqlx::migrate::Migrator {
                migrations: full
                    .migrations
                    .iter()
                    .filter(|m| m.version <= 2)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into(),
                ..full
            };
            pre.run(&pool).await.expect("pre-0003 migrations");

            sqlx::query(
                "INSERT INTO class (id, name, sort_index, created_at) VALUES ('c1','7B',0,1.0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO widget_instance
                   (id, class_id, kind, x, y, w, h, z, config, created_at)
                 VALUES ('w1','c1','text',0.1,0.1,0.3,0.2,0,'{\"kind\":\"text\"}',1.0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            pool.close().await;
        }

        // The normal boot path applies 0003+.
        let pool = open_pool(&path).await.expect("migrated pool");
        let scene = get_scene(&pool, "default-c1")
            .await
            .unwrap()
            .expect("backfilled default scene");
        assert_eq!(scene.class_id.as_deref(), Some("c1"));
        assert_eq!(scene.name, "7B");

        let rows = load_widget_rows(&pool, "default-c1").await.unwrap();
        assert_eq!(rows.len(), 1, "the old layout was adopted");
        assert_eq!(rows[0].id, "w1");
    }

    #[tokio::test]
    async fn migrations_create_every_table() {
        let (pool, _d) = temp_pool().await;
        // Every migrated table must be SELECTable on a fresh database.
        for table in [
            "app_setting",
            "class",
            "class_member",
            "scene",
            "widget_instance",
            "draw_state",
            "period",
            "week_slot",
            "date_override",
            "agenda_item",
            "day_note",
        ] {
            // AssertSqlSafe: sqlx 0.9 requires dynamic SQL to be explicitly
            // vouched for — `table` comes from the hardcoded list above.
            let q = sqlx::AssertSqlSafe(format!("SELECT COUNT(*) AS n FROM {table}"));
            let row = sqlx::query(q).fetch_one(&pool).await.expect(table);
            assert_eq!(row.get::<i64, _>("n"), 0, "{table} should start empty");
        }
    }

    #[tokio::test]
    async fn setting_upsert_get_round_trips() {
        let (pool, _d) = temp_pool().await;
        assert_eq!(get_setting(&pool, "settings").await.unwrap(), None);

        set_setting(&pool, "settings", "{\"a\":1}").await.unwrap();
        assert_eq!(
            get_setting(&pool, "settings").await.unwrap().as_deref(),
            Some("{\"a\":1}")
        );

        // UPSERT overwrites rather than erroring on the existing key.
        set_setting(&pool, "settings", "{\"a\":2}").await.unwrap();
        assert_eq!(
            get_setting(&pool, "settings").await.unwrap().as_deref(),
            Some("{\"a\":2}")
        );
    }

    #[tokio::test]
    async fn foreign_keys_are_enforced() {
        let (pool, _d) = temp_pool().await;
        // A member pointing at a class that does not exist must be refused —
        // this is the proof `foreign_keys(true)` actually reached the pool.
        let res = sqlx::query(
            "INSERT INTO class_member (id, class_id, name, sort_index, created_at)
             VALUES ('m1', 'no-such-class', 'Kari', 0, 1.0)",
        )
        .execute(&pool)
        .await;
        assert!(res.is_err(), "orphan member insert must fail");
    }

    #[tokio::test]
    async fn deleting_a_class_cascades_to_members_widgets_and_draw_state() {
        let (pool, _d) = temp_pool().await;
        sqlx::query(
            "INSERT INTO class (id, name, sort_index, created_at) VALUES ('c1','7B',0,1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO class_member (id, class_id, name, sort_index, created_at)
             VALUES ('m1','c1','Kari',0,1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO scene (id, class_id, name, sort_index, created_at)
             VALUES ('default-c1','c1','7B',0,1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO widget_instance (id, scene_id, kind, x, y, w, h, z, config, created_at)
             VALUES ('w1','default-c1','text',0.1,0.1,0.3,0.2,0,'{}',1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO draw_state (class_id, member_id, drawn_at) VALUES ('c1','m1',2.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("DELETE FROM class WHERE id = 'c1'")
            .execute(&pool)
            .await
            .unwrap();

        for table in ["class_member", "scene", "widget_instance", "draw_state"] {
            let q = sqlx::AssertSqlSafe(format!("SELECT COUNT(*) AS n FROM {table}"));
            let row = sqlx::query(q).fetch_one(&pool).await.unwrap();
            assert_eq!(row.get::<i64, _>("n"), 0, "{table} should cascade-empty");
        }
    }

    #[tokio::test]
    async fn class_insert_get_and_first_in_display_order() {
        let (pool, _d) = temp_pool().await;
        assert_eq!(first_class(&pool).await.unwrap(), None);

        let a = insert_class(&pool, "7B").await.unwrap();
        let b = insert_class(&pool, "8A").await.unwrap();
        assert!(a.sort_index < b.sort_index, "later class sorts after");

        assert_eq!(get_class(&pool, &a.id).await.unwrap().as_ref(), Some(&a));
        assert_eq!(get_class(&pool, "nope").await.unwrap(), None);
        assert_eq!(first_class(&pool).await.unwrap().as_ref(), Some(&a));
    }

    #[tokio::test]
    async fn replace_members_keeps_ids_and_their_draw_state() {
        use sundayscreen_core::members::{reconcile, MemberSpec};
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();

        let first = replace_members(
            &pool,
            &class.id,
            &[
                MemberSpec {
                    id: None,
                    name: "Kari".into(),
                },
                MemberSpec {
                    id: None,
                    name: "Ola".into(),
                },
            ],
        )
        .await
        .unwrap();
        let kari = first[0].clone();

        // Kari has been drawn this round.
        sqlx::query("INSERT INTO draw_state (class_id, member_id, drawn_at) VALUES (?1, ?2, 1.0)")
            .bind(&class.id)
            .bind(&kari.id)
            .execute(&pool)
            .await
            .unwrap();

        // The teacher re-saves the list with Ola swapped for Nils. Kari's id
        // — and therefore her drawn-state — must survive the round-trip.
        let existing: Vec<(String, String)> = first
            .iter()
            .map(|m| (m.id.clone(), m.name.clone()))
            .collect();
        let specs = reconcile(&existing, &["Kari".into(), "Nils".into()]);
        let second = replace_members(&pool, &class.id, &specs).await.unwrap();

        assert_eq!(second[0].id, kari.id, "Kari keeps her id");
        assert_eq!(second[1].name, "Nils");
        let drawn: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM draw_state WHERE class_id = ?1")
            .bind(&class.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(drawn, 1, "Kari's draw state survived; Ola's row cascaded");

        let listed = list_members(&pool, &class.id).await.unwrap();
        assert_eq!(listed, second, "list agrees with the returned rows");
    }

    #[tokio::test]
    async fn absence_is_a_date_stamp_so_yesterday_expires_by_itself() {
        use sundayscreen_core::members::MemberSpec;
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();
        let members = replace_members(
            &pool,
            &class.id,
            &["Kari", "Ola", "Nils"]
                .iter()
                .map(|n| MemberSpec {
                    id: None,
                    name: (*n).into(),
                })
                .collect::<Vec<_>>(),
        )
        .await
        .unwrap();
        assert!(members.iter().all(|m| m.absent_on.is_none()));

        assert!(
            set_member_absent(&pool, &class.id, &members[1].id, true, "2026-08-31")
                .await
                .unwrap()
        );

        let present = list_present_members(&pool, &class.id, "2026-08-31")
            .await
            .unwrap();
        assert_eq!(
            present.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(),
            vec!["Kari", "Nils"]
        );
        // The manage panel still sees everyone, absence and all.
        let all = list_members(&pool, &class.id).await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[1].absent_on.as_deref(), Some("2026-08-31"));

        // THE POINT of a date stamp: the next day needs no reset job. A
        // machine that stood switched off across midnight is correct anyway.
        let tomorrow = list_present_members(&pool, &class.id, "2026-09-01")
            .await
            .unwrap();
        assert_eq!(tomorrow.len(), 3, "yesterday's absence expired on its own");

        // Marking present again clears the stamp.
        assert!(
            set_member_absent(&pool, &class.id, &members[1].id, false, "2026-08-31")
                .await
                .unwrap()
        );
        assert_eq!(
            list_present_members(&pool, &class.id, "2026-08-31")
                .await
                .unwrap()
                .len(),
            3
        );
    }

    #[tokio::test]
    async fn an_absence_write_for_another_class_misses() {
        use sundayscreen_core::members::MemberSpec;
        let (pool, _d) = temp_pool().await;
        let a = insert_class(&pool, "7B").await.unwrap();
        let b = insert_class(&pool, "8A").await.unwrap();
        let members = replace_members(
            &pool,
            &a.id,
            &[MemberSpec {
                id: None,
                name: "Kari".into(),
            }],
        )
        .await
        .unwrap();

        assert!(
            !set_member_absent(&pool, &b.id, &members[0].id, true, "2026-08-31")
                .await
                .unwrap(),
            "a member id from another class must MISS, never write"
        );
        assert!(
            !set_member_absent(&pool, &a.id, "ghost", true, "2026-08-31")
                .await
                .unwrap()
        );
        assert_eq!(
            list_present_members(&pool, &a.id, "2026-08-31")
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn editing_the_name_list_does_not_un_mark_todays_absences() {
        use sundayscreen_core::members::{reconcile, MemberSpec};
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();
        let first = replace_members(
            &pool,
            &class.id,
            &[
                MemberSpec {
                    id: None,
                    name: "Kari".into(),
                },
                MemberSpec {
                    id: None,
                    name: "Ola".into(),
                },
            ],
        )
        .await
        .unwrap();
        set_member_absent(&pool, &class.id, &first[0].id, true, "2026-08-31")
            .await
            .unwrap();

        // The teacher adds a pupil mid-lesson; Kari is still away.
        let existing: Vec<(String, String)> = first
            .iter()
            .map(|m| (m.id.clone(), m.name.clone()))
            .collect();
        let specs = reconcile(&existing, &["Kari".into(), "Ola".into(), "Nils".into()]);
        let after = replace_members(&pool, &class.id, &specs).await.unwrap();
        assert_eq!(
            after[0].absent_on.as_deref(),
            Some("2026-08-31"),
            "the returned list must report the absence it kept"
        );
        assert_eq!(after[2].absent_on, None, "a fresh row starts present");
        assert_eq!(
            list_present_members(&pool, &class.id, "2026-08-31")
                .await
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn class_rename_and_delete_report_whether_a_row_was_hit() {
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();
        assert!(rename_class(&pool, &class.id, "8B").await.unwrap());
        assert_eq!(
            get_class(&pool, &class.id).await.unwrap().unwrap().name,
            "8B"
        );
        assert!(!rename_class(&pool, "ghost", "X").await.unwrap());
        assert!(delete_class(&pool, &class.id).await.unwrap());
        assert!(!delete_class(&pool, &class.id).await.unwrap());
    }

    fn widget_row(id: &str, z: i64) -> WidgetRow {
        WidgetRow {
            id: id.to_string(),
            kind: "text".to_string(),
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.2,
            z,
            config: r#"{"kind":"text","content":"hei"}"#.to_string(),
        }
    }

    #[tokio::test]
    async fn replace_widgets_round_trips_and_replaces_everything() {
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();
        let scene = default_scene_id(&class.id);

        replace_widgets(&pool, &scene, &[widget_row("w1", 0), widget_row("w2", 1)])
            .await
            .unwrap();
        let loaded = load_widget_rows(&pool, &scene).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "w1");
        assert_eq!(loaded[0].config, r#"{"kind":"text","content":"hei"}"#);

        // A second save REPLACES — w1/w2 are gone, only w3 remains.
        replace_widgets(&pool, &scene, &[widget_row("w3", 0)])
            .await
            .unwrap();
        let after = load_widget_rows(&pool, &scene).await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, "w3");
    }

    #[tokio::test]
    async fn replace_widgets_only_touches_the_named_scene() {
        let (pool, _d) = temp_pool().await;
        let a = insert_class(&pool, "7B").await.unwrap();
        let b = insert_class(&pool, "8A").await.unwrap();
        let (sa, sb) = (default_scene_id(&a.id), default_scene_id(&b.id));
        replace_widgets(&pool, &sa, &[widget_row("wa", 0)])
            .await
            .unwrap();
        replace_widgets(&pool, &sb, &[widget_row("wb", 0)])
            .await
            .unwrap();

        replace_widgets(&pool, &sa, &[]).await.unwrap();
        assert!(load_widget_rows(&pool, &sa).await.unwrap().is_empty());
        assert_eq!(load_widget_rows(&pool, &sb).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn replace_widgets_for_a_missing_scene_fails_and_rolls_back() {
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();
        let scene = default_scene_id(&class.id);
        replace_widgets(&pool, &scene, &[widget_row("keep", 0)])
            .await
            .unwrap();

        // FK failure on insert must not have deleted anything anywhere.
        let res = replace_widgets(&pool, "no-such-scene", &[widget_row("wx", 0)]).await;
        assert!(res.is_err(), "saving to a missing scene must fail");
        assert_eq!(load_widget_rows(&pool, &scene).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn new_id_is_unique_and_time_ordered() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b, "ids must be unique");
        assert!(a < b, "v7 ids sort by mint time: {a} !< {b}");
    }

    #[tokio::test]
    async fn now_ms_is_a_recent_positive_epoch() {
        let t = now_ms();
        assert!(t > 1_577_836_800_000.0, "now_ms looks like real epoch ms");
        assert!(t.is_finite());
    }

    #[tokio::test]
    async fn data_survives_reopening_the_same_database_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("persist.sqlite");

        {
            let pool = open_pool(&path).await.unwrap();
            set_setting(&pool, "settings", "{\"keep\":true}")
                .await
                .unwrap();
            pool.close().await;
        }

        let reopened = open_pool(&path).await.unwrap();
        assert_eq!(
            get_setting(&reopened, "settings").await.unwrap().as_deref(),
            Some("{\"keep\":true}")
        );
    }

    // ── The rotating startup backup (R4 spor 1.3) ────────────────────────────

    /// The class names a backup file holds, read back through a real pool —
    /// proof the copy is a working database, not just bytes on disk.
    async fn classes_in(path: &Path) -> Vec<String> {
        let pool = open_pool(path)
            .await
            .expect("the backup opens as a database");
        let names = list_classes(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        pool.close().await;
        names
    }

    #[tokio::test]
    async fn the_startup_backup_rotates_and_stays_readable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sundayscreen.sqlite");
        let pool = open_pool(&path).await.unwrap();

        insert_class(&pool, "7B").await.unwrap();
        let newest = backup_rotating(&pool, &path).await.unwrap();
        assert_eq!(newest, dir.path().join("sundayscreen.backup-1.sqlite"));
        assert_eq!(classes_in(&newest).await, vec!["7B".to_string()]);

        insert_class(&pool, "8A").await.unwrap();
        backup_rotating(&pool, &path).await.unwrap();
        // Newest first, and the previous generation slid down one slot.
        assert_eq!(
            classes_in(&backup_path(&path, "1")).await,
            vec!["7B".to_string(), "8A".to_string()]
        );
        assert_eq!(
            classes_in(&backup_path(&path, "2")).await,
            vec!["7B".to_string()],
            "yesterday's copy is what a rescue actually needs"
        );

        // Four boots, three kept generations — and no temp file left behind.
        insert_class(&pool, "9C").await.unwrap();
        backup_rotating(&pool, &path).await.unwrap();
        backup_rotating(&pool, &path).await.unwrap();
        assert!(backup_path(&path, "3").exists());
        assert!(!backup_path(&path, "4").exists(), "we keep exactly 3");
        assert!(!backup_path(&path, "tmp").exists(), "temp file cleaned up");
    }

    #[tokio::test]
    async fn a_backup_taken_under_wal_sees_uncheckpointed_writes() {
        // The `fs::copy` trap in one test: under WAL a just-committed row may
        // still live only in the `-wal` file. VACUUM INTO must see it.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sundayscreen.sqlite");
        let pool = open_pool(&path).await.unwrap();
        insert_class(&pool, "written just now").await.unwrap();

        let newest = backup_rotating(&pool, &path).await.unwrap();
        assert_eq!(
            classes_in(&newest).await,
            vec!["written just now".to_string()]
        );
    }

    /// WAL is a property of the file, and it brings sidecars — the two facts
    /// `quarantine_database` and `backup_rotating` are built around (R4 1.6).
    #[tokio::test]
    async fn the_database_runs_in_wal_mode_with_its_sidecars() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sundayscreen.sqlite");
        let pool = open_pool(&path).await.unwrap();
        insert_class(&pool, "7B").await.unwrap();

        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(mode, "wal");
        assert!(
            path.with_file_name("sundayscreen.sqlite-wal").exists(),
            "the -wal sidecar quarantine has to move with the file"
        );

        // And a second open of the same file finds it already in WAL.
        pool.close().await;
        let reopened = open_pool(&path).await.unwrap();
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&reopened)
            .await
            .unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(list_classes(&reopened).await.unwrap().len(), 1);
    }

    // ── The downgrade, as a permanent test (R4 spor 1.4) ─────────────────────

    /// Every `.corrupt-*` file next to `db_path`, whatever the suffix.
    fn quarantined_files(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .expect("read_dir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".corrupt-"))
            .collect()
    }

    /// THE regression this round exists for. An older build resolves only
    /// migrations 0001..0004; the file on disk already recorded 0005. sqlx
    /// answers `VersionMissing(5)` — and until R4 the boot path read that as
    /// "corrupt file", renamed the whole database and booted empty.
    ///
    /// The file must come through untouched, and the data with it.
    #[tokio::test]
    async fn a_downgrade_over_0005_must_not_touch_the_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("downgrade.sqlite");

        // A fully migrated database with a teacher's work in it.
        let class_id = {
            let pool = open_pool(&path).await.expect("current build opens it");
            let class = insert_class(&pool, "7B").await.unwrap();
            replace_widgets(&pool, &default_scene_id(&class.id), &[widget_row("w1", 0)])
                .await
                .unwrap();
            pool.close().await;
            class.id
        };

        // Now the older build: same connection options, a migrator that only
        // knows 0001..0004 (the house technique, see the 0003 test above).
        let err: AppError = {
            let pool = SqlitePool::connect_with(connect_options(&path))
                .await
                .expect("the file still opens — it is a healthy database");
            let full = sqlx::migrate!();
            let older = sqlx::migrate::Migrator {
                migrations: full
                    .migrations
                    .iter()
                    .filter(|m| m.version <= 4)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into(),
                ..full
            };
            let err = older
                .run(&pool)
                .await
                .expect_err("an older build cannot resolve migration 0005");
            pool.close().await;
            err.into()
        };

        assert!(
            matches!(
                err,
                AppError::Migration(sqlx::migrate::MigrateError::VersionMissing(5))
            ),
            "a downgrade reports the missing migration, not corruption: {err}"
        );
        assert!(
            !should_quarantine(&err),
            "a downgrade must NEVER be treated as a corrupt file"
        );
        assert!(
            quarantined_files(dir.path()).is_empty(),
            "nothing may have been renamed aside: {:?}",
            quarantined_files(dir.path())
        );

        // And the proof that matters to the teacher: reinstall the newer
        // build and the class and its screen are still there.
        let pool = open_pool(&path)
            .await
            .expect("the newer build opens it again");
        assert_eq!(list_classes(&pool).await.unwrap().len(), 1);
        let rows = load_widget_rows(&pool, &default_scene_id(&class_id))
            .await
            .unwrap();
        assert_eq!(rows.len(), 1, "the layout survived the downgrade attempt");
        assert_eq!(rows[0].id, "w1");
    }

    /// The other half of the decision, with a REAL sqlite error rather than a
    /// synthesised one: a file that is not a database at all must still be
    /// quarantined, or a genuinely broken install can never boot again.
    #[tokio::test]
    async fn a_file_that_is_not_a_database_is_quarantined() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("garbage.sqlite");
        std::fs::write(&path, b"this is not an SQLite database, not even close").unwrap();

        let err = open_pool(&path)
            .await
            .expect_err("garbage bytes cannot be opened");
        assert!(
            should_quarantine(&err),
            "SQLITE_NOTADB is the one case that earns a quarantine: {err}"
        );
    }

    /// WAL leaves `-wal`/`-shm` next to the database. If quarantine moved only
    /// the main file, the freshly created database would inherit the old log.
    #[test]
    fn quarantine_moves_the_sidecar_files_too() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sundayscreen.sqlite");
        for suffix in ["", "-wal", "-shm"] {
            std::fs::write(
                path.with_file_name(format!("sundayscreen.sqlite{suffix}")),
                b"x",
            )
            .unwrap();
        }

        let moved = quarantine_database(&path, 1_700_000_000);
        assert_eq!(
            moved.len(),
            3,
            "main file plus both WAL sidecars: {moved:?}"
        );
        for suffix in ["", "-wal", "-shm"] {
            assert!(
                !path
                    .with_file_name(format!("sundayscreen.sqlite{suffix}"))
                    .exists(),
                "sundayscreen.sqlite{suffix} must have been moved aside"
            );
            assert!(
                path.with_file_name(format!("sundayscreen.sqlite{suffix}.corrupt-1700000000"))
                    .exists(),
                "the bytes are kept for rescue"
            );
        }
        // Nothing to move is not an error — a first launch has no file yet.
        assert!(quarantine_database(&path, 1).is_empty());
    }
}
