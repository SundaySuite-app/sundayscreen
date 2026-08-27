//! Settings persistence — the thin sqlx shell over the pure core model.
//!
//! The whole [`Settings`](sundayscreen_core::settings::Settings) struct is
//! stored as one JSON string in the `app_setting` key/value bag under
//! [`SETTINGS_KEY`]. The per-field defaults, validation (clamping) and
//! partial-JSON merge all live in `sundayscreen-core` (and carry the tests);
//! this module only reads/writes that one row and threads the core's
//! `from_json_merged` → `validate` pipeline.

use sqlx::SqlitePool;
use sundayscreen_core::settings::Settings;
use tokio::sync::{Mutex, MutexGuard};

use crate::db::store;
use crate::error::AppResult;

/// The `app_setting` key the whole settings blob lives under.
pub const SETTINGS_KEY: &str = "settings";

/// The settings write lock (gransking F9, funn B#3/B#4): the blob is stored
/// whole, so every read-modify-write must be serialized or a concurrent
/// save silently reverts the other writer's field. `save` takes it; RMW
/// callers hold it across their read AND write via [`lock`] + [`save_with`].
static SETTINGS_LOCK: Mutex<()> = Mutex::const_new(());

/// Acquire the settings write lock. Hold the guard across a
/// load→mutate→[`save_with`] sequence.
pub async fn lock() -> MutexGuard<'static, ()> {
    SETTINGS_LOCK.lock().await
}

/// Load the settings: read the stored JSON (or fall back to defaults when the
/// key is absent), merge it over the defaults so older/partial blobs never
/// crash, then validate (clamp). The result is always a valid [`Settings`].
pub async fn load(pool: &SqlitePool) -> AppResult<Settings> {
    let raw = store::get_setting(pool, SETTINGS_KEY).await?;
    let mut settings = match raw {
        Some(json) => Settings::from_json_merged(&json),
        None => Settings::default(),
    };
    settings.validate();
    Ok(settings)
}

/// Validate then persist the settings, returning the stored (validated)
/// value. Takes the write lock itself — for plain whole-object saves.
pub async fn save(pool: &SqlitePool, settings: Settings) -> AppResult<Settings> {
    let guard = lock().await;
    save_with(pool, settings, &guard).await
}

/// [`save`] for callers that ALREADY hold the write lock (the `_proof`
/// parameter is exactly that — a compile-time reminder, not data).
pub async fn save_with(
    pool: &SqlitePool,
    mut settings: Settings,
    _proof: &MutexGuard<'static, ()>,
) -> AppResult<Settings> {
    settings.validate();
    let json = serde_json::to_string(&settings)?;
    store::set_setting(pool, SETTINGS_KEY, &json).await?;
    Ok(settings)
}

/// Serialized read-modify-write: load, mutate, save — all under the lock,
/// so no concurrent writer's field can be reverted by a stale blob.
pub async fn update(pool: &SqlitePool, mutate: impl FnOnce(&mut Settings)) -> AppResult<Settings> {
    let guard = lock().await;
    let mut settings = load(pool).await?;
    mutate(&mut settings);
    save_with(pool, settings, &guard).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sundayscreen_core::settings::{WindowState, MIN_WINDOW_H, MIN_WINDOW_W};

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    #[tokio::test]
    async fn load_returns_defaults_when_unset() {
        let (pool, _d) = temp_pool().await;
        assert_eq!(load(&pool).await.unwrap(), Settings::default());
    }

    #[tokio::test]
    async fn save_then_load_round_trips() {
        let (pool, _d) = temp_pool().await;
        let s = Settings {
            language: Some("en".to_string()),
            active_class_id: Some("c1".to_string()),
            snap_enabled: false,
            ..Default::default()
        };
        let stored = save(&pool, s.clone()).await.unwrap();
        assert_eq!(stored, s);
        assert_eq!(load(&pool).await.unwrap(), s);
    }

    #[tokio::test]
    async fn save_validates_before_persisting() {
        let (pool, _d) = temp_pool().await;
        let s = Settings {
            window: Some(WindowState {
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
                fullscreen: false,
            }),
            ..Default::default()
        };
        let stored = save(&pool, s).await.unwrap();
        let w = stored.window.unwrap();
        assert_eq!(w.w, MIN_WINDOW_W);
        assert_eq!(w.h, MIN_WINDOW_H);
        // Persisted value is the clamped one.
        let loaded = load(&pool).await.unwrap();
        assert_eq!(loaded.window.unwrap().w, MIN_WINDOW_W);
    }

    #[tokio::test]
    async fn load_merges_partial_stored_blob_over_defaults() {
        let (pool, _d) = temp_pool().await;
        store::set_setting(&pool, SETTINGS_KEY, r#"{ "activeClassId": "k7" }"#)
            .await
            .unwrap();
        let loaded = load(&pool).await.unwrap();
        assert_eq!(loaded.active_class_id.as_deref(), Some("k7"));
        assert_eq!(loaded.language.as_deref(), Some("no"));
        assert!(loaded.snap_enabled);
    }

    #[tokio::test]
    async fn load_returns_defaults_when_stored_blob_is_corrupt() {
        let (pool, _d) = temp_pool().await;
        store::set_setting(&pool, SETTINGS_KEY, "{ this is not json ]]]")
            .await
            .unwrap();
        assert_eq!(load(&pool).await.unwrap(), Settings::default());
    }
}
