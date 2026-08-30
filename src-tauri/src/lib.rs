//! The Tauri shell: plugin registration, the database pool, and the command
//! surface. Every decision worth testing lives in `sundayscreen-core`; this
//! crate is the I/O around it.

pub mod commands;
pub mod db;
pub mod error;
pub mod settings;
pub mod update;
pub mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logging first, before anything can fail.
    {
        use tracing_subscriber::layer::SubscriberExt;
        use tracing_subscriber::util::SubscriberInitExt;

        let filter =
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().with_target(false))
            .init();
    }

    let builder = tauri::Builder::default();
    // Single-instance MUST be the FIRST plugin (Tauri requirement). A second
    // launch focuses the existing window instead of starting another process —
    // on a shared classroom PC the app WILL be double-clicked twice.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        tracing::info!("a second SundayScreen launch was blocked — focusing the existing window");
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            use tauri::Manager;

            // Open the app database (settings + classes + layouts) once and
            // share it as managed state. Lives under the OS app-data dir so it
            // survives reinstalls and isn't tied to the executable location.
            let db_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("resolving app data dir: {e}"))?;
            std::fs::create_dir_all(&db_dir).map_err(|e| {
                tracing::error!(dir = %db_dir.display(), "creating app data dir failed: {e}");
                format!("creating app data dir: {e}")
            })?;
            let db_path = db_dir.join("sundayscreen.sqlite");
            // Two very different failures used to share one answer here, and
            // the wrong one won: EVERY open error moved the file aside and
            // booted empty. Installing an older build over a newer one
            // (`MigrateError::VersionMissing`) therefore renamed classes,
            // pupil names, the week plan and every screen to `.corrupt-<epoch>`
            // without a word — product promise 3, broken by the recovery
            // path itself.
            //
            // Now the file is only ever touched when it is PROVEN broken
            // (`should_quarantine`: SQLITE_CORRUPT / SQLITE_NOTADB). That
            // case keeps the old F9-funn-B#9 behaviour — a corrupt database
            // must not be an invisible crash on a machine with no terminal,
            // and the renamed bytes stay behind for rescue. Everything else
            // leaves the file exactly as it is.
            let mut recreated = false;
            let pool = match tauri::async_runtime::block_on(db::store::open_pool(&db_path)) {
                Ok(pool) => pool,
                Err(first_err) if error::should_quarantine(&first_err) => {
                    recreated = true;
                    tracing::error!(
                        db = %db_path.display(),
                        "the database file is corrupt — moving it aside and recreating: {first_err}"
                    );
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    for moved in db::store::quarantine_database(&db_path, stamp) {
                        tracing::warn!(file = %moved.display(), "kept the old bytes for rescue");
                    }
                    tauri::async_runtime::block_on(db::store::open_pool(&db_path)).map_err(|e| {
                        tracing::error!("recreating database also failed: {e}");
                        format!("opening database: {e}")
                    })?
                }
                Err(other) => {
                    // The file is intact. Refusing to start is the honest
                    // answer: running on against a schema we do not
                    // understand would corrupt it for the newer build too
                    // (which is why `set_ignore_missing` is NOT the fix).
                    //
                    // TODO(spor 1.2): let `setup` SUCCEED with a
                    // `BootFault { kind, db_path }` in managed state instead,
                    // so the shell can say "this database was made by a newer
                    // SundayScreen — install version X or newer. The file is
                    // untouched: <path>." Until then this is a hard stop with
                    // an accurate log line, not a silent data loss.
                    tracing::error!(
                        db = %db_path.display(),
                        "opening the database failed — the file was NOT modified: {other}"
                    );
                    return Err(format!(
                        "opening database {} failed (file left untouched): {other}",
                        db_path.display()
                    )
                    .into());
                }
            };

            // Restore the saved window geometry BEFORE the shell paints, so
            // the projector setup comes back without a visible jump.
            match tauri::async_runtime::block_on(settings::load(&pool)) {
                Ok(loaded) => {
                    if window::restore_window_state(app.handle(), &loaded) {
                        // Fullscreen was asked for and could not be applied.
                        // Leaving the flag stored would make the frontend
                        // believe it is fullscreen — and a frontend in that
                        // belief saves NO window geometry for the whole
                        // session.
                        if let Err(e) =
                            tauri::async_runtime::block_on(settings::update(&pool, |s| {
                                if let Some(w) = &mut s.window {
                                    w.fullscreen = false;
                                }
                            }))
                        {
                            tracing::warn!("clearing the stale fullscreen flag failed: {e}");
                        }
                    }
                    // The silent boot check — the app's ONE network call, and
                    // it swallows every failure (offline is the normal
                    // classroom state).
                    #[cfg(feature = "updater")]
                    update::spawn_boot_check(app.handle().clone(), loaded.update_channel);
                }
                Err(e) => tracing::warn!("settings load for window restore failed: {e}"),
            }

            // A rotating copy of the database that just migrated cleanly, so
            // there is something to go back to when the worst happens. Taken
            // AFTER the window restore so the projector picture is not held up
            // by it, and NEVER fatal: a full disk must not stop the lesson.
            if recreated {
                // The database we just made is empty. Rotating it in would
                // push the last good copy one slot closer to the bin.
                tracing::warn!("skipping the startup backup — this database was just recreated");
            } else {
                match tauri::async_runtime::block_on(db::store::backup_rotating(&pool, &db_path)) {
                    Ok(path) => tracing::info!(backup = %path.display(), "startup backup written"),
                    Err(e) => tracing::warn!("startup backup failed (continuing anyway): {e}"),
                }
            }

            app.manage(db::Db::new(pool));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::settings::settings_get,
            commands::settings::settings_save,
            commands::classes::class_ensure_active,
            commands::classes::class_list,
            commands::classes::class_create,
            commands::classes::class_rename,
            commands::classes::class_delete,
            commands::classes::class_switch,
            commands::classes::members_get,
            commands::classes::members_set,
            commands::layout::layout_load,
            commands::layout::layout_save,
            commands::scenes::scene_list,
            commands::scenes::scene_create,
            commands::scenes::scene_rename,
            commands::scenes::scene_delete,
            commands::scenes::scene_duplicate,
            commands::scenes::lesson_switch,
            commands::planner::planner_periods_get,
            commands::planner::planner_periods_set,
            commands::planner::planner_week_get,
            commands::planner::planner_slot_set,
            commands::planner::planner_override_set,
            commands::planner::planner_day_get,
            commands::planner::planner_agenda_set,
            commands::planner::planner_agenda_check,
            commands::planner::planner_notes_set,
            commands::picker::picker_draw,
            commands::picker::picker_reset,
            commands::picker::groups_split,
            commands::picker::attendance_set,
            window::window_set_fullscreen,
            window::window_is_fullscreen,
            update::update_check,
            update::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
