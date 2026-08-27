//! The Tauri shell: plugin registration, the database pool, and the command
//! surface. Every decision worth testing lives in `sundayscreen-core`; this
//! crate is the I/O around it.

pub mod commands;
pub mod db;
pub mod error;
pub mod settings;

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
            let pool =
                tauri::async_runtime::block_on(db::store::open_pool(&db_path)).map_err(|e| {
                    tracing::error!(db = %db_path.display(), "opening database failed: {e}");
                    format!("opening database: {e}")
                })?;
            app.manage(db::Db::new(pool));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::settings::settings_get,
            commands::settings::settings_save,
            commands::classes::class_ensure_active,
            commands::layout::layout_load,
            commands::layout::layout_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
