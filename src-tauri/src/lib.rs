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

    // The native file dialog, for «flytt oppsettet» alone. Every byte read or
    // written goes through Rust (`commands::transfer`), and the webview cannot
    // reach the plugin's own commands: `dialog:*` is absent from
    // `capabilities/default.json`, so Tauri's ACL DENIES all three
    // (`plugin:dialog|open`, `|save`, `|message`).
    //
    // What it is NOT is invisible to the webview, and the earlier comment here
    // said so. `tauri_plugin_dialog::init()` injects `init-iife.js` into every
    // page (every non-Android target), and that script REPLACES two globals:
    // `window.alert` → `plugin:dialog|message`, `window.confirm` →
    // `plugin:dialog|confirm`. Both then reject — the first on the ACL, the
    // second because `confirm` is not even a registered command — but the
    // replacement itself is real, and it carries a trap worth writing down:
    // the injected `window.confirm` is ASYNC. It returns a Promise, and a
    // Promise is always truthy, so `if (confirm("…"))` would take the yes
    // branch every time. This app calls neither global (nothing in `app/`
    // uses `alert`/`confirm`), which is what keeps the posture intact — not
    // the plugin being unseen.
    let builder = builder.plugin(tauri_plugin_dialog::init());

    // The system browser, for the link widget's ONE action. Same Rust-only
    // shape as the dialog above: `opener:*` is absent from
    // `capabilities/default.json`, so Tauri's ACL denies the plugin's own
    // three commands (`plugin:opener|open_url`, `|open_path`,
    // `|reveal_item_in_dir`) to the webview. What the page can call is
    // `link_open`, which takes a WIDGET ID and reads the address out of the
    // database — the webview never names a URL.
    //
    // `Builder::new().open_js_links_on_click(false)` rather than the usual
    // `init()`, and this is the part that had to be READ rather than assumed
    // (the dialog plugin taught this file that "invisible to the webview" can
    // be simply untrue). `tauri_plugin_opener::init()` is
    // `Builder::default().build()`, and that default is `true`
    // (tauri-plugin-opener-2.5.5/src/lib.rs:185-191) — it injects
    // `init-iife.js` into EVERY page, and that script adds a global `click`
    // listener which walks `composedPath()` for an `<a>`, and for any anchor
    // with `target="_blank"` — or ANY anchor at all when Ctrl or Shift is
    // held — calls `preventDefault()` and fires `plugin:opener|open_url`
    // with the href.
    //
    // The ACL would reject that invoke, so nothing would open. But the
    // `preventDefault()` happens FIRST and unconditionally, so a Ctrl-click
    // on an ordinary in-app anchor would be silently cancelled — and only on
    // Windows, where the page is served from `http://tauri.localhost`; on
    // macOS the `tauri:` scheme fails the script's own protocol test and the
    // click behaves normally. A platform-divergent swallowed click, bought
    // for a feature this app does not use: the link widget's click surface is
    // a BUTTON, and `app/` has no external `<a href>` at all. So the script
    // is not injected, and the posture rests on what is registered rather
    // than on what an ACL happens to refuse.
    let builder = builder.plugin(
        tauri_plugin_opener::Builder::new()
            .open_js_links_on_click(false)
            .build(),
    );

    // The staged update lives OUTSIDE the builder because two places need it:
    // `setup` (which manages it and hands a clone to the boot check) and the
    // run closure below (which installs what is in it on the way out).
    #[cfg(feature = "updater")]
    let staged = update::Staged::default();
    #[cfg(feature = "updater")]
    let staged_for_setup = staged.clone();

    let app = builder
        .setup(move |app| {
            use tauri::Manager;

            // The boot check's mailbox, managed BEFORE anything can spawn into
            // it (`update::BootUpdate`). It has no dependency on the database
            // and must answer even when there is none — so it goes up first,
            // and the handle is carried into the spawn rather than looked up
            // from state inside it.
            let boot_update = update::BootUpdate::default();
            app.manage(boot_update.clone());

            // Same rule, same reason: the slot the background download writes
            // into goes up BEFORE anything can spawn, and both the task and
            // the run closure carry their own handle rather than looking it
            // up. `update_install` reaches it with `try_state`, so a boot
            // that never got here still answers instead of rejecting.
            #[cfg(feature = "updater")]
            app.manage(staged_for_setup.clone());

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
            //
            // And when it does not open, `setup` still SUCCEEDS. Returning
            // `Err` here stops the whole app — which means the one thing that
            // could explain the problem, a window with a sentence in it, never
            // appears. The shell boots degraded instead (exactly like a plain
            // browser: typed fallbacks where the shim has them, honest
            // rejections everywhere else) and puts `BootFault` at the top of
            // its chip. `set_ignore_missing` is still NOT the fix: nothing
            // reads or writes a schema it does not understand, because `Db` is
            // simply never managed.
            let mut fault: Option<error::BootFault> = None;

            // Open the app database (settings + classes + layouts) once and
            // share it as managed state. It lives under the OS app-data dir so
            // it survives reinstalls and isn't tied to the executable location
            // — and NAMING that directory, or creating it, can fail too. Both
            // of those were a `?` out of `setup` until R4, i.e. the very panic
            // the paragraph above exists to prevent, three lines above the
            // code that prevents it. `resolve_db_path` classifies them as
            // `Unreadable` instead, and the boot continues degraded.
            let db_path = match db::store::resolve_db_path(app.path().app_data_dir()) {
                Ok(path) => Some(path),
                Err(path_fault) => {
                    fault = Some(path_fault);
                    None
                }
            };

            let pool = match &db_path {
                // There is no path, so there is nothing to open. The fault set
                // above is already the whole explanation.
                None => None,
                Some(db_path) => match tauri::async_runtime::block_on(db::store::open_pool(db_path))
                {
                    Ok(pool) => Some(pool),
                    Err(first_err) if error::should_quarantine(&first_err) => {
                        tracing::error!(
                            db = %db_path.display(),
                            "the database file is corrupt — moving it aside and recreating: {first_err}"
                        );
                        let stamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        for moved in db::store::quarantine_database(db_path, stamp) {
                            tracing::warn!(file = %moved.display(), "kept the old bytes for rescue");
                        }
                        match tauri::async_runtime::block_on(db::store::open_pool(db_path)) {
                            Ok(pool) => {
                                // The app works and the teacher's classes are
                                // not in it. That was a `warn!` in a terminal
                                // no classroom has open until R4.
                                fault = Some(error::BootFault::started_empty(db_path));
                                Some(pool)
                            }
                            Err(e) => {
                                // NOT `from_open_error`: its sentences all end
                                // in "the file is untouched", and the
                                // quarantine above has just renamed it.
                                tracing::error!("recreating database also failed: {e}");
                                fault = Some(error::BootFault::rescue_failed(db_path));
                                None
                            }
                        }
                    }
                    Err(other) => {
                        // The file is INTACT — nothing here touches it.
                        tracing::error!(
                            db = %db_path.display(),
                            "opening the database failed — the file was NOT modified: {other}"
                        );
                        fault = Some(error::BootFault::from_open_error(&other, db_path));
                        None
                    }
                },
            };

            if let Some(f) = &fault {
                tracing::warn!(
                    kind = ?f.kind,
                    schema_version = ?f.schema_version,
                    "boot fault — the shell will say so"
                );
            }
            app.manage(commands::app::BootStatus(fault));

            // A pool exists only when a path did, so the two `Some`s always
            // arrive together — taken as a pair rather than unwrapped, because
            // "there is a database but nowhere to back it up to" must be an
            // unrepresentable state, not a panic waiting for a rare rig.
            if let (Some(pool), Some(db_path)) = (pool, &db_path) {
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
                        // The silent boot check — the app's ONE network call,
                        // and it swallows every failure (offline is the normal
                        // classroom state). Its mailbox was managed above, and
                        // it carries its own handle: nothing here can panic on
                        // unmanaged state.
                        //
                        // Since ADR-014 it also STAGES what it finds when the
                        // teacher has left automatic updates on: downloaded
                        // in the background, installed at `RunEvent::Exit`.
                        #[cfg(feature = "updater")]
                        update::spawn_boot_check(
                            app.handle().clone(),
                            loaded.update_channel,
                            loaded.auto_update,
                            boot_update,
                            staged_for_setup,
                        );
                    }
                    Err(e) => tracing::warn!("settings load for window restore failed: {e}"),
                }

                // A rotating copy of the database that just migrated cleanly,
                // so there is something to go back to when the worst happens.
                // Taken AFTER the window restore so the projector picture is
                // not held up by it, and NEVER fatal: a full disk must not
                // stop the lesson.
                //
                // `Ok(None)` is the deliberate skip: an EMPTY database is
                // never copied. The rule lives in `backup_rotating` rather
                // than here — a "was this boot the quarantine one?" flag at
                // this call site is what let the NEXT boot eat the copies
                // anyway (R4 H2).
                match tauri::async_runtime::block_on(db::store::backup_rotating(&pool, db_path)) {
                    Ok(Some(path)) => {
                        tracing::info!(backup = %path.display(), "startup backup written")
                    }
                    Ok(None) => { /* skipped, and `backup_rotating` said why */ }
                    Err(e) => tracing::warn!("startup backup failed (continuing anyway): {e}"),
                }

                // The picture sweep — the ONE place an image file is ever
                // deleted (`db/images.rs` has the three reasons a per-widget
                // delete would be wrong). Deliberately placed HERE:
                //
                // - INSIDE this branch, so it never runs on a degraded boot.
                //   Without a pool there is no way to prove a file is an
                //   orphan, and "we could not read the references" must never
                //   become "so we deleted the pictures".
                // - AFTER `backup_rotating`, so the copy of a healthy
                //   database is taken before anything on disk is removed, and
                //   the projector picture is not held up by a directory walk.
                // - NEVER fatal, exactly like the backup above: a locked file
                //   or a read-only directory must not stop a lesson.
                match app.path().app_data_dir() {
                    Ok(base) => {
                        let dir = db::images::images_dir(&base);
                        match tauri::async_runtime::block_on(db::images::sweep_orphans(&pool, &dir))
                        {
                            Ok(0) => { /* nothing to collect — the ordinary boot */ }
                            Ok(n) => tracing::info!(removed = n, "swept orphaned pictures"),
                            Err(e) => {
                                tracing::warn!("the picture sweep failed (continuing anyway): {e}")
                            }
                        }
                    }
                    Err(e) => tracing::warn!("no app data directory for the picture sweep: {e}"),
                }

                app.manage(db::Db::new(pool));
            }
            Ok(())
        })
        // Most commands below take `State<'_, Db>`, and on a boot fault that
        // state is NOT managed. Tauri 2 answers such a call with an
        // `InvokeError` ("state not managed for field `db` …",
        // tauri-2.11.5/src/state.rs:61) — a REJECTION, never a panic — so the
        // shim's own machinery handles it: reads fall back to their typed
        // defaults, writes reject, nothing fabricates a success. That is the
        // ENTIRE cost of letting `setup` succeed, which is why it was worth
        // paying: the alternative was 36 commands each learning to check a
        // flag. What it requires in exchange is that the five commands which
        // must still work — `app_info`, `boot_fault`, `update_pending` and the
        // two `window_*` (they take `WebviewWindow`, not `Db`) — never grow a
        // `Db` argument. The shell's ability to explain itself depends on it.
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::boot_fault,
            commands::settings::settings_get,
            commands::settings::settings_save,
            commands::settings::settings_set_window,
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
            commands::images::image_pick,
            commands::images::image_load,
            commands::links::link_open,
            commands::scenes::scene_list,
            commands::scenes::scene_get,
            commands::scenes::scene_create,
            commands::scenes::scene_rename,
            commands::scenes::scene_delete,
            commands::scenes::scene_duplicate,
            commands::scenes::scene_set_theme,
            commands::scenes::scene_usage,
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
            commands::picker::picker_draw_many,
            commands::picker::picker_reset,
            commands::picker::groups_split,
            commands::picker::attendance_set,
            commands::transfer::transfer_export,
            commands::transfer::transfer_import,
            window::window_set_fullscreen,
            window::window_is_fullscreen,
            update::update_check,
            update::update_install,
            update::update_pending,
        ])
        // `build(…)?.run(closure)` rather than `run(context)` — the latter IS
        // this, with an empty closure (tauri-2.11.5/src/app.rs:2449). The
        // closure is the entire reason: it is the only place the app can
        // install a staged update.
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // ── The one hook that catches EVERY way this app closes ──────────────
    //
    // `RunEvent::Exit`, and deliberately not `ExitRequested` (ADR-014).
    // `ExitRequested` is sent from exactly two places in
    // tauri-runtime-wry — a window becoming `Destroyed` (the close box) and
    // `Message::RequestExit` (`app.exit()`/`app.restart()`) — and macOS
    // Cmd+Q reaches NEITHER: `NSApp terminate:` goes straight to
    // `applicationWillTerminate` → `AppState::exit()` → `LoopDestroyed`, so no
    // window is ever destroyed. `Exit` covers both paths, fires exactly once,
    // and runs immediately before `cleanup_before_exit()`
    // (tauri-2.11.5/src/app.rs:1430).
    //
    // Nothing here may keep the window open: `install_staged_at_exit` logs
    // every outcome, waits at most 30 s, and returns.
    //
    // The handle goes in with the slot, and it is not decoration: the
    // automatic-update switch is read from the database HERE, at closing
    // time, rather than trusted from the copy handed to `spawn_boot_check`
    // at launch (R5-funn M3). A teacher who turns the switch off after the
    // download has already been staged must get what the switch says.
    app.run(move |_app, _event| {
        #[cfg(feature = "updater")]
        if matches!(_event, tauri::RunEvent::Exit) {
            update::install_staged_at_exit(_app, &staged);
        }
    });
}
