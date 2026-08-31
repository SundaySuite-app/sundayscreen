//! The updater shell — the ONE network feature the app has, and therefore
//! the one place "fails silently offline" must be engineered rather than
//! hoped: the boot check catches every error path and only logs; the manual
//! check returns a status the panel can show honestly.
//!
//! The channel is per-machine state in the settings, which is why every
//! check builds its endpoint at call time (`core::update::channel_feed_url`)
//! instead of trusting tauri.conf.json's single static URL.
//!
//! Since ADR-014 the boot check has a SECOND half: when the teacher has left
//! automatic updates on (the default), a found update is DOWNLOADED in the
//! background and held in memory, and the bytes are installed at
//! `RunEvent::Exit` — the one moment in a school day where a restart costs
//! nothing. The split is deliberate and load-bearing:
//! `Update::download_and_install` would have restarted the app mid-lesson,
//! and on Windows the plugin's installer ends in `std::process::exit(0)`.

use std::sync::{Arc, Mutex};

use serde::Serialize;
#[cfg(feature = "updater")]
use sundayscreen_core::settings::{Settings, UpdateChannel};
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
    /// Downloaded AND signature-verified; it installs when the app closes.
    ///
    /// Posted ONLY by the boot check, and only after `Update::download`
    /// returned (minisign verification happens inside it). A manual check
    /// never answers this: it asks the feed, and the feed knows nothing about
    /// what this machine has already fetched.
    Downloaded {
        version: String,
    },
    /// Built without the updater feature.
    Disabled,
    Error {
        message: String,
    },
}

/// How far the background download has got. Kept as a plain enum — separate
/// from the [`Slot`] that holds the actual bytes — so the two decisions below
/// are unit-testable without a running Tauri app or a network.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagePhase {
    /// Nothing found, or automatic updates are off.
    Idle,
    /// The bytes are on their way.
    Downloading,
    /// Downloaded and verified — installable.
    Ready,
    /// The download failed. The mailbox still says `Available`, so the marker
    /// and the manual button carry on as before.
    Failed,
}

/// Should the boot check follow its answer up with a background download?
///
/// Only an `Available` answer is worth fetching, and only when the teacher
/// has left automatic updates on. Every other status — including
/// `Downloaded`, which the boot check itself posts afterwards — is a no.
pub fn stage_after_check(status: &UpdateStatus, auto_update: bool) -> bool {
    auto_update && matches!(status, UpdateStatus::Available { .. })
}

/// Should the closing app install what it has staged?
///
/// TWO facts have to be true, and only the first is about the bytes.
///
/// [`StagePhase::Ready`] is the older half. `Downloading` is the case that
/// matters there: an app closed mid-download has bytes that were never
/// verified and half a file — it must close, not install.
///
/// `auto_update` is the half R5 found missing. It used to be read ONCE, at
/// boot, and handed to the background download — so a teacher who read
/// «v0.5.0 installeres når du lukker appen» and then turned the switch off
/// got the install anyway, which is the exact opposite of what the switch
/// says it does. Staged bytes are not a decision that has already been taken;
/// the setting AT CLOSING TIME is the decision, and it is a veto in both
/// directions (off again before she closes, on again before she closes).
pub fn install_at_exit(phase: StagePhase, auto_update: bool) -> bool {
    auto_update && matches!(phase, StagePhase::Ready)
}

/// What the mailbox should say about a version this machine has found.
///
/// `downloaded = false` deliberately keeps the OLD sentence: a failed
/// download must leave the marker and the manual «Oppdater og start på nytt»
/// exactly as they were, because that route still works.
pub fn staged_status(version: &str, downloaded: bool) -> UpdateStatus {
    if downloaded {
        UpdateStatus::Downloaded {
            version: version.to_string(),
        }
    } else {
        UpdateStatus::Available {
            version: version.to_string(),
        }
    }
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

/// The staged update: verified bytes waiting for the app to close.
///
/// Same «carry your own handle» discipline as [`BootUpdate`], and for the
/// same reason — it is managed before anything can spawn into it, and the
/// background task holds a clone rather than looking it up. A panic here
/// would be a crash caused by the one feature that must fail silently.
///
/// It lives in memory only. A machine shut down between the download and the
/// next launch simply downloads again; nothing half-written is ever left on
/// disk for a later boot to trip over.
#[cfg(feature = "updater")]
#[derive(Clone, Default)]
pub struct Staged(Arc<Mutex<Slot>>);

#[cfg(feature = "updater")]
#[derive(Default)]
enum Slot {
    #[default]
    Idle,
    Downloading,
    Ready {
        version: String,
        // Boxed: `Update` is a wide struct and this enum sits behind a mutex
        // every phase check touches.
        update: Box<tauri_plugin_updater::Update>,
        bytes: Vec<u8>,
    },
    Failed,
}

#[cfg(feature = "updater")]
impl Staged {
    /// A poisoned lock is logged and dropped — exactly like [`BootUpdate`].
    /// The consequence is only that an update installs one launch later.
    fn set(&self, next: Slot) {
        match self.0.lock() {
            Ok(mut slot) => *slot = next,
            Err(e) => tracing::warn!("the staged-update slot could not be written: {e}"),
        }
    }

    fn mark_downloading(&self) {
        self.set(Slot::Downloading);
    }

    fn mark_failed(&self) {
        self.set(Slot::Failed);
    }

    fn set_ready(&self, version: String, update: tauri_plugin_updater::Update, bytes: Vec<u8>) {
        self.set(Slot::Ready {
            version,
            update: Box::new(update),
            bytes,
        });
    }

    fn phase(&self) -> StagePhase {
        match self.0.lock() {
            Ok(slot) => match &*slot {
                Slot::Idle => StagePhase::Idle,
                Slot::Downloading => StagePhase::Downloading,
                Slot::Ready { .. } => StagePhase::Ready,
                Slot::Failed => StagePhase::Failed,
            },
            // Unreadable is not installable.
            Err(e) => {
                tracing::warn!("the staged-update slot is unreadable: {e}");
                StagePhase::Failed
            }
        }
    }

    /// Take the verified bytes, leaving the slot empty.
    ///
    /// TAKE, not read: it is what makes «the manual button installed it» and
    /// «the exit hook installs it» mutually exclusive. `app.restart()` runs
    /// the exit hook too, and an install repeated on the way out would unpack
    /// an archive over an app directory that is already being replaced.
    ///
    /// The take happens BEFORE the install, which has a price worth naming:
    /// an `update_install` the teacher cancels at the admin prompt throws
    /// away a download the exit hook could have used, and the next boot
    /// fetches the same archive again. One boot's bandwidth, once — and it
    /// buys the double-install guard outright, whereas a take-on-success
    /// would have to know which failures left the app directory untouched
    /// and which did not.
    fn take_ready(&self) -> Option<(String, Box<tauri_plugin_updater::Update>, Vec<u8>)> {
        let mut slot = self.0.lock().ok()?;
        match std::mem::replace(&mut *slot, Slot::Idle) {
            Slot::Ready {
                version,
                update,
                bytes,
            } => Some((version, update, bytes)),
            other => {
                *slot = other;
                None
            }
        }
    }
}

/// How long the closing app waits for the installer before giving up.
///
/// The bound exists for ONE path, and it is a real one: on macOS the
/// plugin's installer falls back to an admin prompt via AppleScript when
/// `rename` is denied (a `.app` that IT installed into `/Applications` for a
/// standard user), and that fallback does
/// `run_on_main_thread(…)` + `rx.recv().unwrap()`. `run_on_main_thread` posts
/// to the event loop — which, under `RunEvent::Exit`, is already destroyed.
/// The closure would never run and the receive would never return: an app
/// that refuses to close. Nothing is half-done on THAT path, because the
/// AppleScript branch is only reached AFTER `rename` failed, i.e. before
/// anything has moved.
///
/// The deadlock is not the only way to reach the bound, though, and the
/// other way is not as clean. A slow but PROGRESSING install — a large
/// archive, a virus scanner reading every file as it is unpacked — can still
/// be inside `install` when the 30 s run out, and nothing cancels it: the
/// thread below is detached, and the process exits from under it mid-unpack.
/// That window is narrow and it is ACCEPTED rather than closed, because the
/// alternative is an unbounded wait — a projector holding a window that will
/// not close, in front of a class. 30 s rather than 3 is the size of the
/// concession; the rig line in NEEDS-RICHARD is where a real archive on a
/// real machine gets to say whether it was enough.
#[cfg(feature = "updater")]
const INSTALL_AT_EXIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Install the staged bytes on the way out. Every outcome is a log line —
/// nothing here may keep the window open.
///
/// Called from the `RunEvent::Exit` arm in `lib.rs`. NOT `ExitRequested`:
/// macOS Cmd+Q goes `NSApp terminate:` → `applicationWillTerminate` →
/// `LoopDestroyed`, so no window is ever `Destroyed` and `ExitRequested` is
/// never sent — see ADR-014.
///
/// Takes the `AppHandle` for ONE reason: the automatic-update switch is read
/// here, now, from the database — see [`auto_update_now`].
#[cfg(feature = "updater")]
pub fn install_staged_at_exit(app: &tauri::AppHandle, staged: &Staged) {
    install_staged_when(staged, || auto_update_now(app));
}

/// [`install_staged_at_exit`] with the setting as a THUNK.
///
/// Two things fall out of that, and both were wanted. The ordinary close —
/// nothing staged, which is every close on all but one launch in a term —
/// never touches the database at all, because the phase is asked first. And
/// the decision becomes testable without an `AppHandle`, a window or a
/// network.
#[cfg(feature = "updater")]
fn install_staged_when(staged: &Staged, auto_update: impl FnOnce() -> bool) {
    let phase = staged.phase();
    // Is there anything to decide about? Asked before the setting, so a close
    // with an empty slot costs no read; the phase is then half of the
    // decision itself, one line down.
    if phase != StagePhase::Ready {
        tracing::info!(?phase, "closing with nothing staged to install");
        return;
    }
    if !install_at_exit(phase, auto_update()) {
        // The bytes STAY in the slot. She may turn the switch back on before
        // the next close, and «Installer nå» in the manage panel installs
        // them either way — clearing a verified download here would be the
        // app making a point about a setting at the teacher's expense.
        tracing::info!(
            "automatic updates are off — the staged update stays where it is, uninstalled"
        );
        return;
    }
    // The phase said Ready; the take is what makes it true.
    let Some((version, update, bytes)) = staged.take_ready() else {
        return;
    };

    // A worker thread, so the bounded wait below is possible at all: the
    // install is synchronous and, on the macOS admin path, can block forever.
    let (tx, rx) = std::sync::mpsc::channel();
    let installing = version.clone();
    std::thread::spawn(move || {
        // On Windows this never returns: the plugin's installer ends in
        // `std::process::exit(0)` (ADR-014 — that is also why this cannot run
        // in the background during a lesson).
        let outcome = update.install(&bytes).map_err(|e| e.to_string());
        let _ = tx.send(outcome);
    });

    match rx.recv_timeout(INSTALL_AT_EXIT_TIMEOUT) {
        Ok(Ok(())) => tracing::info!(version = %installing, "installed on the way out"),
        Ok(Err(e)) => tracing::warn!(version = %installing, "the staged install failed: {e}"),
        Err(e) => tracing::warn!(
            version = %installing,
            "the staged install did not finish in {}s — closing anyway: {e}",
            INSTALL_AT_EXIT_TIMEOUT.as_secs()
        ),
    }
}

/// Ask the feed, and KEEP the handle. `check_feed` throws the handle away,
/// which is fine for a status but useless for a download — and the plugin
/// gives no way to reconstruct an `Update` from a version string.
#[cfg(feature = "updater")]
async fn check_feed_update(
    app: &tauri::AppHandle,
    channel: UpdateChannel,
) -> (UpdateStatus, Option<tauri_plugin_updater::Update>) {
    use tauri_plugin_updater::UpdaterExt;

    let url = match sundayscreen_core::update::channel_feed_url(channel).parse() {
        Ok(url) => url,
        Err(e) => {
            return (
                UpdateStatus::Error {
                    message: format!("feed url: {e}"),
                },
                None,
            )
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
            return (
                UpdateStatus::Error {
                    message: format!("updater build: {e}"),
                },
                None,
            )
        }
    };
    match updater.check().await {
        Ok(Some(update)) => (
            UpdateStatus::Available {
                version: update.version.clone(),
            },
            Some(update),
        ),
        Ok(None) => (UpdateStatus::UpToDate, None),
        Err(e) => (
            UpdateStatus::Error {
                message: e.to_string(),
            },
            None,
        ),
    }
}

#[cfg(feature = "updater")]
async fn check_feed(app: &tauri::AppHandle, channel: UpdateChannel) -> UpdateStatus {
    check_feed_update(app, channel).await.0
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

/// Is the automatic half switched on, according to the database as it stands
/// NOW? The same shape and the same fallback as [`channel_for`].
///
/// `None` (no database on this boot) and a failed read both land on the
/// stored default, which for `auto_update` is ON — and that is deliberately
/// the behaviour this app had before the setting was consulted at all. Bytes
/// only exist in the slot because the switch was on when the boot check ran;
/// "we could not read the setting" is not the teacher turning it off, and
/// answering `false` there would silently strand a download she asked for.
#[cfg(feature = "updater")]
async fn auto_update_for(pool: Option<&sqlx::SqlitePool>) -> bool {
    let Some(pool) = pool else {
        tracing::info!("no database on this boot — using the default update setting");
        return Settings::default().auto_update;
    };
    match settings::load(pool).await {
        Ok(s) => s.auto_update,
        Err(e) => {
            tracing::warn!("reading the automatic-update setting failed — using the default: {e}");
            Settings::default().auto_update
        }
    }
}

/// The switch, read FRESH on the way out — the whole of the R5 fix.
///
/// Two things about WHERE this runs, because both are easy to get wrong.
/// `RunEvent::Exit` fires on the event-loop thread and NOT inside the async
/// runtime, so `block_on` here is the same move `setup` makes three times in
/// `lib.rs` — and it is not the worker thread the install itself is handed
/// to below, which is a different thread with a different bound. And
/// `try_state`, never a `State<'_, Db>` argument: this is called from the run
/// closure, where a boot fault means there is simply no `Db` to find.
#[cfg(feature = "updater")]
fn auto_update_now(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    let db = app.try_state::<Db>();
    tauri::async_runtime::block_on(auto_update_for(db.as_deref().map(|d| d.pool())))
}

/// The silent boot check: log the outcome, POST it to `slot`, swallow
/// EVERYTHING — an offline classroom must never see this fail. Spawned from
/// setup, with the mailbox and the staging slot handed in (see
/// [`BootUpdate`], [`Staged`]).
///
/// When `auto_update` is on it also DOWNLOADS what it found, into `staged`.
/// That work sits behind the same 5 s sleep, in the same background task, so
/// the boot is never held up by it — and a failure costs only the automatic
/// half: the mailbox keeps its `Available`, and the marker plus the manual
/// button carry on unchanged.
#[cfg(feature = "updater")]
pub fn spawn_boot_check(
    app: tauri::AppHandle,
    channel: UpdateChannel,
    auto_update: bool,
    slot: BootUpdate,
    staged: Staged,
) {
    tauri::async_runtime::spawn(async move {
        // Let the shell finish waking before touching the network.
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let (status, update) = check_feed_update(&app, channel).await;
        match &status {
            UpdateStatus::Available { version } => {
                tracing::info!(%version, "update available on the {} ring", channel.as_tag());
            }
            UpdateStatus::UpToDate => tracing::info!("up to date"),
            UpdateStatus::Error { message } => {
                // Offline is the normal classroom state — info, not warn.
                tracing::info!("update check did not complete: {message}");
            }
            UpdateStatus::Downloaded { .. } | UpdateStatus::Disabled => {}
        }
        let stage = stage_after_check(&status, auto_update);
        // Every outcome, not just the interesting one: "the check ran and
        // said up to date" and "the check never answered" are different
        // facts, and only the mailbox can tell them apart.
        slot.post(status);

        if !stage {
            return;
        }
        // `stage_after_check` said Available, so the handle is there; the
        // `else` is belt and braces, not a path.
        let Some(update) = update else { return };
        let version = update.version.clone();
        staged.mark_downloading();
        // Signature verification (minisign) happens INSIDE `download` — the
        // bytes that reach `set_ready` are already proven ours.
        match update.download(|_, _| {}, || {}).await {
            Ok(bytes) => {
                tracing::info!(
                    %version,
                    "update downloaded and verified — it installs when the app closes"
                );
                staged.set_ready(version.clone(), update, bytes);
                slot.post(staged_status(&version, true));
            }
            Err(e) => {
                // Not an error the teacher should meet: the manual route is
                // untouched and the mailbox still says the version is there.
                tracing::warn!(%version, "downloading the update failed — leaving it manual: {e}");
                staged.mark_failed();
            }
        }
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
        use tauri::Manager;
        use tauri_plugin_updater::UpdaterExt;

        // Already downloaded and verified? Install THOSE bytes: no second
        // trip to the feed, and the take empties the slot so the exit hook
        // cannot install the same archive again on the way out.
        //
        // `try_state`, never `State<'_, Staged>` as an argument — that is the
        // exact trap `channel_for` documents. Tauri checks a `State`
        // parameter BEFORE the body runs, and this command is the remedy the
        // `databaseTooNew` chip points at; a build without the updater
        // feature manages no `Staged` at all.
        if let Some(staged) = app.try_state::<Staged>() {
            if let Some((version, update, bytes)) = staged.take_ready() {
                tracing::info!(%version, "installing the staged update on request");
                update.install(bytes).map_err(|e| {
                    crate::error::AppError::Internal(format!("update install: {e}"))
                })?;
                app.restart();
            }
        }

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

/// The two decisions the automatic path turns on, and the sentence it posts.
///
/// They are unit-testable BECAUSE they are pure: the install itself is native
/// (a real archive, a real event loop, a real `RunEvent::Exit`) and cannot be
/// exercised from any test tier this repo has — so what CAN be pinned down is
/// pinned down here, and the rest is a rig-test line in NEEDS-RICHARD.
#[cfg(test)]
mod decision_tests {
    use super::*;

    fn available(v: &str) -> UpdateStatus {
        UpdateStatus::Available {
            version: v.to_string(),
        }
    }

    #[test]
    fn only_an_available_update_is_worth_downloading() {
        assert!(stage_after_check(&available("9.9.9"), true));
        // The setting is the whole veto.
        assert!(!stage_after_check(&available("9.9.9"), false));
    }

    #[test]
    fn nothing_else_is_ever_staged() {
        for status in [
            UpdateStatus::UpToDate,
            UpdateStatus::Disabled,
            UpdateStatus::Error {
                message: "offline".into(),
            },
            // The boot check posts this one itself, right after a successful
            // download. Re-staging it would be a second download of bytes we
            // already hold.
            UpdateStatus::Downloaded {
                version: "9.9.9".into(),
            },
        ] {
            assert!(
                !stage_after_check(&status, true),
                "{status:?} must not start a download"
            );
        }
    }

    #[test]
    fn only_ready_bytes_are_installed_on_the_way_out() {
        assert!(install_at_exit(StagePhase::Ready, true));
        // The one that matters: closing mid-download must close, not install
        // an unverified half file.
        assert!(!install_at_exit(StagePhase::Downloading, true));
        assert!(!install_at_exit(StagePhase::Idle, true));
        assert!(!install_at_exit(StagePhase::Failed, true));
    }

    /// R5-funn M3. The panel said «v0.5.0 installeres når du lukker appen»,
    /// she turned the switch off, and the app installed it anyway — the
    /// staged bytes had outvoted the setting for the rest of the session.
    #[test]
    fn the_switch_still_vetoes_an_update_that_is_already_staged() {
        // Downloaded, verified, sitting in the slot — and switched off since.
        assert!(!install_at_exit(StagePhase::Ready, false));
        // …and switched back ON before she closes: the same bytes install.
        // The veto is a reading, not a latch.
        assert!(install_at_exit(StagePhase::Ready, true));

        // It cannot RESCUE anything either: a half download is not
        // installable just because the switch is on.
        for phase in [
            StagePhase::Idle,
            StagePhase::Downloading,
            StagePhase::Failed,
        ] {
            assert!(
                !install_at_exit(phase, true),
                "{phase:?} with the switch on"
            );
            assert!(
                !install_at_exit(phase, false),
                "{phase:?} with the switch off"
            );
        }
    }

    #[test]
    fn a_failed_download_leaves_the_old_sentence_standing() {
        // Downloaded → the panel says «installeres når du lukker appen».
        assert!(matches!(
            staged_status("9.9.9", true),
            UpdateStatus::Downloaded { version } if version == "9.9.9"
        ));
        // Not downloaded → exactly what the mailbox said before ADR-014, so
        // the marker and the manual button behave as they always did.
        assert!(matches!(
            staged_status("9.9.9", false),
            UpdateStatus::Available { version } if version == "9.9.9"
        ));
    }

    /// The wire shape the frontend switches on. A renamed phase is a silently
    /// dead branch in `app-info.ts`, not a compile error.
    #[test]
    fn downloaded_serialises_as_its_camel_case_phase() {
        let json = serde_json::to_string(&staged_status("9.9.9", true)).unwrap();
        assert_eq!(json, r#"{"phase":"downloaded","version":"9.9.9"}"#);
    }
}

#[cfg(all(test, feature = "updater"))]
mod slot_tests {
    use super::*;

    /// A `tauri_plugin_updater::Update` cannot be constructed from outside
    /// the plugin, so the Ready arm is unreachable here. Everything that
    /// guards it is not.
    #[test]
    fn an_empty_slot_has_nothing_to_give_and_says_so() {
        let staged = Staged::default();
        assert_eq!(staged.phase(), StagePhase::Idle);
        assert!(staged.take_ready().is_none());

        staged.mark_downloading();
        assert_eq!(staged.phase(), StagePhase::Downloading);
        assert!(
            staged.take_ready().is_none(),
            "a download in flight is not a take"
        );
        assert_eq!(
            staged.phase(),
            StagePhase::Downloading,
            "a refused take must not reset the phase"
        );

        staged.mark_failed();
        assert_eq!(staged.phase(), StagePhase::Failed);
        assert!(staged.take_ready().is_none());
    }

    /// The exit hook on the ordinary boot: no update, no work, no delay —
    /// and no database read either. The panic IS the assertion: the setting
    /// is only worth opening the settings blob for once there is something
    /// staged to decide about, and every close in a term but one is this one.
    #[test]
    fn closing_with_nothing_staged_returns_immediately_without_reading_anything() {
        install_staged_when(&Staged::default(), || {
            panic!("an ordinary close must not go to the database")
        });
    }

    /// A download still in flight is not installable, and the switch does not
    /// make it so in either direction — nor may the hook empty the slot on
    /// its way past.
    #[test]
    fn a_download_in_flight_survives_the_close_whatever_the_switch_says() {
        for on in [true, false] {
            let staged = Staged::default();
            staged.mark_downloading();
            install_staged_when(&staged, || on);
            assert_eq!(
                staged.phase(),
                StagePhase::Downloading,
                "the exit hook disturbed a slot it had no business in"
            );
        }
    }

    /// Clones share one slot — the background task's handle and the run
    /// closure's handle must be the same mailbox, or the download would land
    /// somewhere the exit hook never looks.
    #[test]
    fn every_clone_is_the_same_slot() {
        let a = Staged::default();
        let b = a.clone();
        b.mark_downloading();
        assert_eq!(a.phase(), StagePhase::Downloading);
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

    /// R5-funn M3, the half no pure function can hold: the answer the exit
    /// hook uses has to come from the database AS IT IS NOW, never from the
    /// copy `spawn_boot_check` was handed five seconds after launch.
    #[tokio::test]
    async fn the_automatic_switch_is_read_fresh_and_flips_both_ways() {
        let (pool, _d) = temp_pool().await;
        assert!(
            auto_update_for(Some(&pool)).await,
            "an untouched install has automatic updates on"
        );

        // The journey: the panel says it installs when she closes the app,
        // and she turns the switch off.
        settings::update(&pool, |s| s.auto_update = false)
            .await
            .unwrap();
        assert!(!auto_update_for(Some(&pool)).await);

        // …and off-then-ON again before she closes must install after all.
        settings::update(&pool, |s| s.auto_update = true)
            .await
            .unwrap();
        assert!(auto_update_for(Some(&pool)).await);
    }

    /// The degraded boot again: no database, so no setting to read. The
    /// fallback is the stored DEFAULT, which is ON — a read we could not do
    /// is not a teacher who opted out.
    #[tokio::test]
    async fn without_a_database_the_exit_hook_keeps_the_default() {
        assert!(auto_update_for(None).await);
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
