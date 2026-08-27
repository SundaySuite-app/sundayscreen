//! Settings commands — the whole validated object crosses in one vocabulary,
//! so nothing can be silently re-defaulted per-field.

use sundayscreen_core::settings::Settings;
use tauri::State;

use crate::db::Db;
use crate::error::AppResult;
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
