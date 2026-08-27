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

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Row, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use crate::error::AppResult;

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

/// Open (creating if needed) the SQLite database at `db_path` and run all
/// pending migrations. Foreign keys are enforced.
pub async fn open_pool(db_path: &Path) -> AppResult<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePool::connect_with(opts).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
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

/// Create a class at the end of the display order. Returns the stored row.
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
    sqlx::query("INSERT INTO class (id, name, sort_index, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(&row.id)
        .bind(&row.name)
        .bind(row.sort_index)
        .bind(row.created_at)
        .execute(pool)
        .await?;
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
}

/// A class's members, in display order. Generic over the executor so the
/// picker can read them inside its draw transaction (F9-funn #2).
pub async fn list_members<'e, E>(executor: E, class_id: &str) -> AppResult<Vec<MemberRow>>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let rows = sqlx::query(
        "SELECT id, name, sort_index FROM class_member
         WHERE class_id = ?1 ORDER BY sort_index, created_at",
    )
    .bind(class_id)
    .fetch_all(executor)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| MemberRow {
            id: r.get("id"),
            name: r.get("name"),
            sort_index: r.get("sort_index"),
        })
        .collect())
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
    let mut out = Vec::with_capacity(specs.len());
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
                out.push(MemberRow {
                    id: id.clone(),
                    name: spec.name.clone(),
                    sort_index,
                });
            }
            None => {
                let id = new_id();
                sqlx::query(
                    "INSERT INTO class_member (id, class_id, name, sort_index, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(&id)
                .bind(class_id)
                .bind(&spec.name)
                .bind(sort_index)
                .bind(stamp)
                .execute(&mut *tx)
                .await?;
                out.push(MemberRow {
                    id,
                    name: spec.name.clone(),
                    sort_index,
                });
            }
        }
    }

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

/// Every widget row for a class, in z order.
pub async fn load_widget_rows(pool: &SqlitePool, class_id: &str) -> AppResult<Vec<WidgetRow>> {
    let rows = sqlx::query(
        "SELECT id, kind, x, y, w, h, z, config FROM widget_instance
         WHERE class_id = ?1 ORDER BY z, id",
    )
    .bind(class_id)
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

/// Replace a class's ENTIRE layout in one transaction — idempotent and
/// atomic: a failed insert rolls the delete back, so a crash mid-save can
/// never leave a mixed layout.
pub async fn replace_widgets(
    pool: &SqlitePool,
    class_id: &str,
    rows: &[WidgetRow],
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM widget_instance WHERE class_id = ?1")
        .bind(class_id)
        .execute(&mut *tx)
        .await?;
    let stamp = now_ms();
    for row in rows {
        sqlx::query(
            "INSERT INTO widget_instance (id, class_id, kind, x, y, w, h, z, config, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&row.id)
        .bind(class_id)
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

    /// A pool over a temp-dir database file, fully migrated.
    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    #[tokio::test]
    async fn migrations_create_every_table() {
        let (pool, _d) = temp_pool().await;
        // Every migrated table must be SELECTable on a fresh database.
        for table in [
            "app_setting",
            "class",
            "class_member",
            "widget_instance",
            "draw_state",
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
            "INSERT INTO widget_instance (id, class_id, kind, x, y, w, h, z, config, created_at)
             VALUES ('w1','c1','text',0.1,0.1,0.3,0.2,0,'{}',1.0)",
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

        for table in ["class_member", "widget_instance", "draw_state"] {
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

        replace_widgets(
            &pool,
            &class.id,
            &[widget_row("w1", 0), widget_row("w2", 1)],
        )
        .await
        .unwrap();
        let loaded = load_widget_rows(&pool, &class.id).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "w1");
        assert_eq!(loaded[0].config, r#"{"kind":"text","content":"hei"}"#);

        // A second save REPLACES — w1/w2 are gone, only w3 remains.
        replace_widgets(&pool, &class.id, &[widget_row("w3", 0)])
            .await
            .unwrap();
        let after = load_widget_rows(&pool, &class.id).await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, "w3");
    }

    #[tokio::test]
    async fn replace_widgets_only_touches_the_named_class() {
        let (pool, _d) = temp_pool().await;
        let a = insert_class(&pool, "7B").await.unwrap();
        let b = insert_class(&pool, "8A").await.unwrap();
        replace_widgets(&pool, &a.id, &[widget_row("wa", 0)])
            .await
            .unwrap();
        replace_widgets(&pool, &b.id, &[widget_row("wb", 0)])
            .await
            .unwrap();

        replace_widgets(&pool, &a.id, &[]).await.unwrap();
        assert!(load_widget_rows(&pool, &a.id).await.unwrap().is_empty());
        assert_eq!(load_widget_rows(&pool, &b.id).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn replace_widgets_for_a_missing_class_fails_and_rolls_back() {
        let (pool, _d) = temp_pool().await;
        let class = insert_class(&pool, "7B").await.unwrap();
        replace_widgets(&pool, &class.id, &[widget_row("keep", 0)])
            .await
            .unwrap();

        // FK failure on insert must not have deleted anything anywhere.
        let res = replace_widgets(&pool, "no-such-class", &[widget_row("wx", 0)]).await;
        assert!(res.is_err(), "saving to a missing class must fail");
        assert_eq!(load_widget_rows(&pool, &class.id).await.unwrap().len(), 1);
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
}
