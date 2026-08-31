//! Settings commands — the whole validated object crosses in one vocabulary,
//! so nothing can be silently re-defaulted per-field.

use sqlx::SqlitePool;
use sundayscreen_core::settings::{Settings, WindowState};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;

#[tauri::command]
pub async fn settings_get(db: State<'_, Db>) -> AppResult<Settings> {
    settings::load(db.pool()).await
}

/// A rejected save travels to the caller — the frontend's "saved" receipt must
/// stay honest, so this never fabricates success.
#[tauri::command]
pub async fn settings_save(db: State<'_, Db>, settings: Settings) -> AppResult<Settings> {
    settings::save(db.pool(), settings).await
}

/// Save ONLY the window geometry, and answer with what was actually stored.
///
/// Window moves and resizes are the app's most frequent write by a wide
/// margin, and each one used to travel as a WHOLE `Settings` object the
/// frontend had assembled from its own last read. That is the classic
/// lost-update seam: anything a concurrent writer had just put in another
/// field (the active class, the update ring) was overwritten by a blob that
/// predated it. This goes through `settings::update` instead — one serialized
/// read-modify-write under the same lock every other RMW caller holds — and
/// touches one field.
///
/// The RETURN is the point of the return type: `validate` CLAMPS a too-small
/// window to the minimum and DROPS an absurd one entirely, so what is on disk
/// is regularly not what was sent. Answering with the stored value lets the
/// frontend adopt the truth rather than keep believing its own number.
///
/// A geometry so broken that `validate` dropped it REJECTS. There is then no
/// stored window state to answer with, and the alternative — echoing the
/// caller's own numbers back, or answering `null` — would be a receipt for a
/// write that did not happen (promise 4).
pub async fn set_window_for(pool: &SqlitePool, window: WindowState) -> AppResult<WindowState> {
    let stored = settings::update(pool, |s| s.window = Some(window)).await?;
    stored.window.ok_or_else(|| {
        AppError::Validation(
            "that window geometry is not usable and was not stored — nothing was changed".into(),
        )
    })
}

#[tauri::command]
pub async fn settings_set_window(db: State<'_, Db>, window: WindowState) -> AppResult<WindowState> {
    set_window_for(db.pool(), window).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sundayscreen_core::settings::{MIN_WINDOW_H, MIN_WINDOW_W};

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = crate::db::store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    fn window(w: f64, h: f64) -> WindowState {
        WindowState {
            x: 20.0,
            y: 40.0,
            w,
            h,
            fullscreen: false,
        }
    }

    #[tokio::test]
    async fn the_window_write_touches_the_window_and_nothing_else() {
        let (pool, _d) = temp_pool().await;
        settings::update(&pool, |s| {
            s.active_class_id = Some("k7".into());
            s.snap_enabled = false;
        })
        .await
        .unwrap();

        let stored = set_window_for(&pool, window(1600.0, 900.0)).await.unwrap();
        assert_eq!(stored.w, 1600.0);

        let after = settings::load(&pool).await.unwrap();
        assert_eq!(after.window, Some(stored));
        assert_eq!(
            after.active_class_id.as_deref(),
            Some("k7"),
            "a geometry save must not carry a stale copy of anything else"
        );
        assert!(!after.snap_enabled);
    }

    #[tokio::test]
    async fn the_answer_is_the_clamped_truth_not_what_was_asked_for() {
        let (pool, _d) = temp_pool().await;
        let stored = set_window_for(&pool, window(100.0, 50.0)).await.unwrap();
        assert_eq!(stored.w, MIN_WINDOW_W);
        assert_eq!(stored.h, MIN_WINDOW_H);
        assert_eq!(settings::load(&pool).await.unwrap().window, Some(stored));
    }

    #[tokio::test]
    async fn a_geometry_validate_throws_away_rejects_rather_than_reporting_a_save() {
        let (pool, _d) = temp_pool().await;
        let err = set_window_for(&pool, window(f64::NAN, 800.0))
            .await
            .expect_err("nothing was stored, so nothing may be reported as stored");
        assert_eq!(err.code(), "validation");
        assert_eq!(settings::load(&pool).await.unwrap().window, None);
    }
}
