//! App metadata commands — the two questions the shell asks about ITSELF
//! rather than about a class: which build is this, and did the boot go well?

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::BootFault;

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

/// The boot's verdict, in managed state.
///
/// ALWAYS managed — `None` on a clean start — which is what lets this one
/// command answer even when the database did not open and `Db` is therefore
/// NOT managed. Keep it free of `Db`: it is the surface that explains the
/// missing `Db`.
pub struct BootStatus(pub Option<BootFault>);

/// Did anything go wrong on the way up? Read ONCE by the shell at boot.
///
/// `None` is the normal answer and means "nothing to say" — not "everything
/// is fine with the database", which is a claim the running commands make on
/// their own by working.
#[tauri::command]
pub fn boot_fault(status: State<'_, BootStatus>) -> Option<BootFault> {
    status.0.clone()
}
