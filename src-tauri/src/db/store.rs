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

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Row, SqlitePool};
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
