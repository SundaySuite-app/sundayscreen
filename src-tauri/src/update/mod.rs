//! The updater shell — the ONE network feature the app has, and therefore
//! the one place "fails silently offline" must be engineered rather than
//! hoped: the boot check catches every error path and only logs; the manual
//! check returns a status the panel can show honestly.
//!
//! The channel is per-machine state in the settings, which is why every
//! check builds its endpoint at call time (`core::update::channel_feed_url`)
//! instead of trusting tauri.conf.json's single static URL.

use std::sync::{Arc, Mutex};

use serde::Serialize;
#[cfg(feature = "updater")]
use sundayscreen_core::settings::UpdateChannel;
use tauri::State;
use ts_rs::TS;

use crate::db::Db;
#[cfg(not(feature = "updater"))]
use crate::error::AppError;
use crate::error::AppResult;
#[cfg(feature = "updater")]
use crate::settings;

/// What a manual check answers.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "UpdateStatus.ts")]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateStatus {
    UpToDate,
    Available {
        version: String,
    },
    /// Built without the updater feature.
    Disabled,
    Error {
        message: String,
    },
}

/// Where the silent boot check leaves its answer.
///
/// The check has existed since v0.1 and has always written to a terminal no
/// classroom has open. This is the mailbox that gives it a RECEIVER: one slot,
/// written once ~5 s after boot, read once by the shell.
///
/// It is an `Arc` inside rather than a bare `Mutex` so the spawned task can
/// hold its OWN handle. `app.state::<T>()` panics when the type was never
/// managed, and a panic inside the boot check would be a crash caused by the
/// one feature that is supposed to fail silently. Managing it before the spawn
/// (see `lib.rs`) is the rule; carrying the handle is what makes the rule
/// unbreakable.
#[derive(Clone, Default)]
pub struct BootUpdate(Arc<Mutex<Option<UpdateStatus>>>);

impl BootUpdate {
    /// Post the answer. A poisoned lock is logged and dropped — the update
    /// marker is the least important thing in the room.
    #[cfg(feature = "updater")]
    fn post(&self, status: UpdateStatus) {
        match self.0.lock() {
            Ok(mut slot) => *slot = Some(status),
            Err(e) => tracing::warn!("the boot check could not store its answer: {e}"),
        }
    }

    fn read(&self) -> Option<UpdateStatus> {
        self.0.lock().ok().and_then(|slot| slot.clone())
    }
}

/// What the boot check found, or `None` while it has not answered yet (and
/// forever, on a machine that is offline — which is the normal classroom
/// state, and why this is a READ with a fallback rather than a rejection).
#[tauri::command]
pub fn update_pending(pending: State<'_, BootUpdate>) -> Option<UpdateStatus> {
    pending.read()
}

#[cfg(feature = "updater")]
async fn check_feed(app: &tauri::AppHandle, channel: UpdateChannel) -> UpdateStatus {
    use tauri_plugin_updater::UpdaterExt;

    let url = match sundayscreen_core::update::channel_feed_url(channel).parse() {
        Ok(url) => url,
        Err(e) => {
            return UpdateStatus::Error {
                message: format!("feed url: {e}"),
            }
        }
    };
    let updater = match app
        .updater_builder()
        // No timeout would let a captive portal hang the manual check for
        // minutes with the button disabled (F9-funn U#13).
        .timeout(std::time::Duration::from_secs(15))
        .endpoints(vec![url])
        .and_then(|b| b.build())
    {
        Ok(updater) => updater,
        Err(e) => {
            return UpdateStatus::Error {
                message: format!("updater build: {e}"),
            }
        }
    };
    match updater.check().await {
        Ok(Some(update)) => UpdateStatus::Available {
            version: update.version.clone(),
        },
        Ok(None) => UpdateStatus::UpToDate,
        Err(e) => UpdateStatus::Error {
            message: e.to_string(),
        },
    }
}

/// The silent boot check: log the outcome, POST it to `slot`, swallow
/// EVERYTHING — an offline classroom must never see this fail. Spawned from
/// setup, with the mailbox handed in (see [`BootUpdate`]).
#[cfg(feature = "updater")]
pub fn spawn_boot_check(app: tauri::AppHandle, channel: UpdateChannel, slot: BootUpdate) {
    tauri::async_runtime::spawn(async move {
        // Let the shell finish waking before touching the network.
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let status = check_feed(&app, channel).await;
        match &status {
            UpdateStatus::Available { version } => {
                tracing::info!(%version, "update available on the {} ring", channel.as_tag());
            }
            UpdateStatus::UpToDate => tracing::info!("up to date"),
            UpdateStatus::Error { message } => {
                // Offline is the normal classroom state — info, not warn.
                tracing::info!("update check did not complete: {message}");
            }
            UpdateStatus::Disabled => {}
        }
        // Every outcome, not just the interesting one: "the check ran and
        // said up to date" and "the check never answered" are different
        // facts, and only the mailbox can tell them apart.
        slot.post(status);
    });
}

/// Manual check from the manage panel. Errors are a STATUS here, not a
/// rejection — "could not check" is an answer the panel shows, not a fault.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, db: State<'_, Db>) -> AppResult<UpdateStatus> {
    #[cfg(not(feature = "updater"))]
    {
        let _ = (app, db);
        Ok(UpdateStatus::Disabled)
    }
    #[cfg(feature = "updater")]
    {
        let s = settings::load(db.pool()).await?;
        Ok(check_feed(&app, s.update_channel).await)
    }
}

/// Download, install and relaunch. A WRITE — failures REJECT so the panel
/// never claims an update it cannot back up. Returns a STATUS for the one
/// non-restart outcome (the feed answered "nothing" between check and
/// install — F9-funn B#10a: that used to resolve as a fabricated success);
/// a successful install restarts the app and never resolves.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, db: State<'_, Db>) -> AppResult<UpdateStatus> {
    #[cfg(not(feature = "updater"))]
    {
        let _ = (app, db);
        Err(AppError::Validation("updater feature disabled".into()))
    }
    #[cfg(feature = "updater")]
    {
        use tauri_plugin_updater::UpdaterExt;

        let s = settings::load(db.pool()).await?;
        let url = sundayscreen_core::update::channel_feed_url(s.update_channel)
            .parse()
            .map_err(|e| crate::error::AppError::Internal(format!("feed url: {e}")))?;
        let updater = app
            .updater_builder()
            .timeout(std::time::Duration::from_secs(15))
            .endpoints(vec![url])
            .and_then(|b| b.build())
            .map_err(|e| crate::error::AppError::Internal(format!("updater build: {e}")))?;
        let update = updater
            .check()
            .await
            .map_err(|e| crate::error::AppError::Internal(format!("update check: {e}")))?;
        let Some(update) = update else {
            return Ok(UpdateStatus::UpToDate);
        };
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| crate::error::AppError::Internal(format!("update install: {e}")))?;
        app.restart();
    }
}
