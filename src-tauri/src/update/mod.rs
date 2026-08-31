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

#[cfg(feature = "updater")]
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

/// Which ring to ask, given whatever database this boot ended up with.
///
/// `None` means there is none: on a boot fault `Db` is deliberately never
/// managed (see `lib.rs`), and both update commands used to take
/// `State<'_, Db>` for this one field. Tauri answers an unmanaged-state
/// argument with a generic `InvokeError`, so on the ONE fault whose chip
/// reads «install the newest version again» — `databaseTooNew` — the button
/// that does exactly that failed with a sentence about a missing field. The
/// channel is a preference, not a precondition: without a database we check
/// the default (stable) ring, which is where every install is unless someone
/// deliberately moved it, and a beta machine's fallback is the safer ring
/// rather than no answer at all.
///
/// A failed READ lands in the same place for the same reason.
#[cfg(feature = "updater")]
async fn channel_for(pool: Option<&sqlx::SqlitePool>) -> UpdateChannel {
    let Some(pool) = pool else {
        tracing::info!("no database on this boot — checking the default update ring");
        return UpdateChannel::default();
    };
    match settings::load(pool).await {
        Ok(s) => s.update_channel,
        Err(e) => {
            tracing::warn!("reading the update channel failed — using the default ring: {e}");
            UpdateChannel::default()
        }
    }
}

/// The channel this call should use, looked up WITHOUT requiring the state to
/// exist. `try_state` is the whole point: `State<'_, Db>` as an argument is a
/// hard requirement Tauri enforces before the command body ever runs.
#[cfg(feature = "updater")]
async fn channel_of(app: &tauri::AppHandle) -> UpdateChannel {
    use tauri::Manager;
    let db = app.try_state::<Db>();
    channel_for(db.as_deref().map(|d| d.pool())).await
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
///
/// Takes no `State<'_, Db>`: it must work in degraded mode (see
/// [`channel_for`]), and a `State` argument is checked before the body runs.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> AppResult<UpdateStatus> {
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        Ok(UpdateStatus::Disabled)
    }
    #[cfg(feature = "updater")]
    {
        let channel = channel_of(&app).await;
        Ok(check_feed(&app, channel).await)
    }
}

/// Download, install and relaunch. A WRITE — failures REJECT so the panel
/// never claims an update it cannot back up. Returns a STATUS for the one
/// non-restart outcome (the feed answered "nothing" between check and
/// install — F9-funn B#10a: that used to resolve as a fabricated success);
/// a successful install restarts the app and never resolves.
///
/// No `State<'_, Db>` here either, and for the sharper half of the same
/// reason: `databaseTooNew` is the fault whose remedy IS this button.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> AppResult<UpdateStatus> {
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        Err(AppError::Validation("updater feature disabled".into()))
    }
    #[cfg(feature = "updater")]
    {
        use tauri_plugin_updater::UpdaterExt;

        let channel = channel_of(&app).await;
        let url = sundayscreen_core::update::channel_feed_url(channel)
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

#[cfg(all(test, feature = "updater"))]
mod tests {
    use super::*;
    use crate::db::store;
    use sqlx::SqlitePool;

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    /// The degraded boot, which is the ONE the update button matters most on:
    /// `databaseTooNew` tells the teacher to install the newest version, and
    /// on that boot there is no `Db` to read a channel out of.
    #[tokio::test]
    async fn without_a_database_the_check_still_has_a_ring_to_ask() {
        assert_eq!(channel_for(None).await, UpdateChannel::Stable);
    }

    #[tokio::test]
    async fn with_a_database_the_stored_channel_wins() {
        let (pool, _d) = temp_pool().await;
        assert_eq!(
            channel_for(Some(&pool)).await,
            UpdateChannel::Stable,
            "an untouched install follows stable"
        );

        settings::update(&pool, |s| s.update_channel = UpdateChannel::Beta)
            .await
            .unwrap();
        assert_eq!(channel_for(Some(&pool)).await, UpdateChannel::Beta);
    }
}
