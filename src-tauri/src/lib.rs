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
            // A corrupt database must not be an invisible crash on a machine
            // with no terminal (F9-funn B#9): back the file up and boot
            // fresh. Losing layouts is bad; an app that silently never opens
            // again is worse — and the backup keeps the bytes for rescue.
            let pool = match tauri::async_runtime::block_on(db::store::open_pool(&db_path)) {
                Ok(pool) => pool,
                Err(first_err) => {
                    tracing::error!(
                        db = %db_path.display(),
                        "opening database failed — backing it up and recreating: {first_err}"
                    );
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    for suffix in ["", "-wal", "-shm"] {
                        let src = db_dir.join(format!("sundayscreen.sqlite{suffix}"));
                        if src.exists() {
                            let dst =
                                db_dir.join(format!("sundayscreen.sqlite{suffix}.corrupt-{stamp}"));
                            let _ = std::fs::rename(&src, &dst);
                        }
                    }
                    tauri::async_runtime::block_on(db::store::open_pool(&db_path)).map_err(|e| {
                        tracing::error!("recreating database also failed: {e}");
                        format!("opening database: {e}")
                    })?
                }
            };

            // Restore the saved window geometry BEFORE the shell paints, so
            // the projector setup comes back without a visible jump.
            match tauri::async_runtime::block_on(settings::load(&pool)) {
                Ok(loaded) => {
                    window::restore_window_state(app.handle(), &loaded);
                    // The silent boot check — the app's ONE network call, and
                    // it swallows every failure (offline is the normal
                    // classroom state).
                    #[cfg(feature = "updater")]
                    update::spawn_boot_check(app.handle().clone(), loaded.update_channel);
                }
                Err(e) => tracing::warn!("settings load for window restore failed: {e}"),
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
            commands::picker::picker_draw,
            commands::picker::picker_reset,
            commands::picker::groups_split,
            window::window_set_fullscreen,
            update::update_check,
            update::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
