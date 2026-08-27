//! App metadata commands.

use serde::Serialize;
use ts_rs::TS;

/// What the frontend shows in the about/status line.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "AppInfo.ts")]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "SundayScreen".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
