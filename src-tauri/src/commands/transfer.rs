//! «Flytt oppsettet» — the two commands that write and read a setup file.
//!
//! ## The whole feature is Rust-side, and that is the point
//!
//! `tauri-plugin-dialog` is registered in `lib.rs` and used ONLY from here:
//! the file dialog is opened in Rust, the bytes are read and written with
//! `std::fs` in Rust, and the webview never learns that a filesystem exists.
//! `capabilities/default.json` is therefore untouched — Tauri's ACL governs
//! IPC FROM the webview, and nothing here is reachable that way. The
//! precedent is the app's own updater, which has shipped in production with
//! no capability entry for exactly the same reason.
//!
//! The two dialogs' TITLES come in as arguments, translated by the frontend
//! — the same rule `class_ensure_active(default_name)` follows: what a
//! teacher reads is decided by the catalogue she is running, never by a
//! string compiled into the backend.
//!
//! ## The export, read in one transaction
//!
//! Classes, their name lists, every screen (class defaults included — those
//! are deliberately absent from `list_global_scenes`) and every widget, plus
//! the school day. Widgets travel as the RAW `kind`/`config` strings; see
//! `sundayscreen_core::transfer` for what is deliberately NOT in the file
//! (`absent_on` above all).
//!
//! One transaction so the file is a SNAPSHOT: read query-by-query off the
//! pool, a class list and a member list taken a moment apart can disagree,
//! and the file would record a class whose names belong to another moment.

use std::path::PathBuf;

use sqlx::SqlitePool;
use sundayscreen_core::transfer::{
    self, ImportRefusal, TransferClass, TransferFile, TransferScene, TransferSlot, TransferWidget,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::import::{self, ImportOutcome, ImportReceipt};
use crate::db::planner as pstore;
use crate::db::store::{self, WidgetRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// The one file-type filter both dialogs offer. "SundayScreen" is a proper
/// noun, so it needs no catalogue; the extension is plain `.json` because a
/// double extension is what save dialogs mangle.
const FILTER_NAME: &str = "SundayScreen";
const FILTER_EXTENSIONS: [&str; 1] = ["json"];

/// Biggest setup file we will read into memory. A setup of a whole school is
/// a few hundred kilobytes; this is the guard against being handed a video
/// file with the right extension, not a limit on teaching.
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

fn to_transfer_widgets(rows: Vec<WidgetRow>) -> Vec<TransferWidget> {
    rows.into_iter()
        .map(|r| TransferWidget {
            // RAW, both of them. Deserializing to `WidgetConfig` here would
            // drop every widget kind this build does not know — the exact
            // data promise 3 exists to protect.
            kind: r.kind,
            config: r.config,
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
            z: r.z,
        })
        .collect()
}

/// Read the whole setup into a transfer payload. Public for the tests and
/// for the command below; there is no other caller.
pub async fn export_payload(
    pool: &SqlitePool,
    app_version: &str,
    exported_at: f64,
) -> AppResult<TransferFile> {
    let mut file = TransferFile::new(app_version, exported_at);
    let mut tx = pool.begin().await?;

    for class in store::list_classes(&mut *tx).await? {
        // Names only — the row also carries `absent_on`, and
        // `TransferClass::members` is a `Vec<String>` precisely so that
        // column has nowhere to go (ADR-010, PRIVACY.md).
        let members = store::list_members(&mut *tx, &class.id)
            .await?
            .into_iter()
            .map(|m| m.name)
            .collect();
        let default_id = store::default_scene_id(&class.id);
        let default_scene = match store::get_scene(&mut *tx, &default_id).await? {
            Some(scene) => Some(TransferScene {
                id: scene.id.clone(),
                name: scene.name,
                widgets: to_transfer_widgets(store::load_widget_rows(&mut *tx, &scene.id).await?),
            }),
            None => None,
        };
        file.classes.push(TransferClass {
            id: class.id,
            name: class.name,
            members,
            default_scene,
        });
    }

    for scene in store::list_global_scenes(&mut *tx).await? {
        let widgets = to_transfer_widgets(store::load_widget_rows(&mut *tx, &scene.id).await?);
        file.scenes.push(TransferScene {
            id: scene.id,
            name: scene.name,
            widgets,
        });
    }

    file.planner.periods = pstore::list_periods(&mut *tx)
        .await?
        .into_iter()
        .map(|p| transfer::TransferPeriod {
            id: p.id,
            label: p.label,
            start_min: p.start_min,
            end_min: p.end_min,
            kind: p.kind,
        })
        .collect();
    file.planner.week = pstore::list_week_slots(&mut *tx)
        .await?
        .into_iter()
        .map(|s| TransferSlot {
            weekday: s.weekday,
            period_id: s.period_id,
            class_id: s.class_id,
            subject: s.subject,
            scene_id: s.scene_id,
        })
        .collect();

    tx.commit().await?;
    Ok(file)
}

/// A dialog's answer, turned into a real path. `FilePath::Url` only happens
/// on mobile content URIs, which this app has none of — but it is a `Result`,
/// so it is handled rather than unwrapped.
fn to_path(picked: tauri_plugin_dialog::FilePath) -> AppResult<PathBuf> {
    picked
        .into_path()
        .map_err(|e| AppError::Internal(format!("the chosen file has no usable path: {e}")))
}

/// Write the whole setup to a file the teacher picks.
///
/// Answers with the path written, or `None` when she closed the dialog —
/// which is not a failure and must not be reported as one. Everything else
/// REJECTS: a full disk or a read-only stick has to reach the panel as an
/// error, never as a receipt for a file that is not there (promise 4).
#[tauri::command]
pub async fn transfer_export(
    app: AppHandle,
    db: State<'_, Db>,
    dialog_title: String,
    suggested_name: String,
) -> AppResult<Option<String>> {
    let payload = export_payload(
        db.pool(),
        &app.package_info().version.to_string(),
        store::now_ms(),
    )
    .await?;
    let json = serde_json::to_string_pretty(&payload)?;

    // `blocking_save_file` on the async runtime, which is the documented
    // pattern: the dialog's own API is callback-based and this wrapper waits
    // on a channel — safe here, and NOT on the main thread, where it would
    // deadlock the event loop that has to draw the dialog.
    let Some(picked) = app
        .dialog()
        .file()
        .set_title(dialog_title)
        .set_file_name(suggested_name)
        .add_filter(FILTER_NAME, &FILTER_EXTENSIONS)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    std::fs::write(&path, json)?;
    tracing::info!(file = %path.display(), "setup exported");
    Ok(Some(path.display().to_string()))
}

/// Read a setup file the teacher picks and ADD what is in it.
///
/// Always answers with a [`ImportReceipt`]; the refusals are outcomes, not
/// errors, because each one is a different sentence and none of them wrote
/// anything. Only a genuine I/O or storage failure travels as `Err`.
#[tauri::command]
pub async fn transfer_import(
    app: AppHandle,
    db: State<'_, Db>,
    dialog_title: String,
) -> AppResult<ImportReceipt> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title(dialog_title)
        .add_filter(FILTER_NAME, &FILTER_EXTENSIONS)
        .blocking_pick_file()
    else {
        return Ok(ImportReceipt::refused(ImportOutcome::Cancelled, ""));
    };
    let path = to_path(picked)?;

    // Size first, before the bytes are in memory: the dialog's filter is a
    // suggestion, not a guarantee, and a file picked by mistake can be a
    // gigabyte of video with the right extension.
    if std::fs::metadata(&path)?.len() > MAX_FILE_BYTES {
        tracing::warn!(file = %path.display(), "setup import refused — file is far too large");
        return Ok(ImportReceipt::refused(ImportOutcome::TooLarge, ""));
    }
    let raw = std::fs::read_to_string(&path)?;

    match transfer::parse(&raw) {
        Ok(file) => import::import_setup(db.pool(), &file).await,
        Err(ImportRefusal::NotOurFile) => Ok(ImportReceipt::refused(ImportOutcome::NotOurFile, "")),
        Err(ImportRefusal::TooNew {
            schema_version,
            app_version,
        }) => {
            tracing::warn!(
                schema_version,
                "setup import refused — the file is newer than us"
            );
            Ok(ImportReceipt::refused(ImportOutcome::TooNew, app_version))
        }
        Err(ImportRefusal::Unreadable(why)) => {
            tracing::warn!("setup import refused — {why}");
            Ok(ImportReceipt::refused(ImportOutcome::Unreadable, ""))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::planner as planner_cmd;
    use crate::db::import::count;
    use sundayscreen_core::schedule::PeriodKind;

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    fn raw_widget(id: &str, kind: &str, config: &str, z: i64) -> WidgetRow {
        WidgetRow {
            id: id.to_string(),
            kind: kind.to_string(),
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.4,
            z,
            config: config.to_string(),
        }
    }

    /// A machine with a teacher's whole year on it: two classes with names,
    /// a widget on one class's own screen, a library screen with two, and a
    /// school day whose Tuesday points at all three kinds of id.
    async fn seed_source(pool: &SqlitePool) {
        let a = store::insert_class(pool, "7B").await.unwrap();
        let b = store::insert_class(pool, "8A").await.unwrap();
        crate::commands::classes::members_set_for(
            pool,
            &a.id,
            vec!["Kari".into(), "Ola".into(), "Nils".into()],
        )
        .await
        .unwrap();
        crate::commands::classes::members_set_for(pool, &b.id, vec!["Ida".into()])
            .await
            .unwrap();

        store::replace_widgets(
            pool,
            &store::default_scene_id(&a.id),
            &[raw_widget(
                "w1",
                "text",
                r#"{"kind":"text","content":"Husk gymtøy"}"#,
                0,
            )],
        )
        .await
        .unwrap();

        let library = store::insert_global_scene(pool, "Prøve").await.unwrap();
        store::replace_widgets(
            pool,
            &library.id,
            &[
                raw_widget("w2", "clock", r#"{"kind":"clock"}"#, 0),
                // A kind THIS build has never heard of, written by a newer
                // SundayScreen. It must come through the round trip raw.
                raw_widget("w3", "dayplan", r#"{"kind":"dayplan","entries":[1,2]}"#, 1),
            ],
        )
        .await
        .unwrap();

        let periods = planner_cmd::periods_set_for(
            pool,
            vec![
                planner_cmd::PeriodSpec {
                    id: None,
                    label: "1. time".into(),
                    start_min: 480,
                    end_min: 525,
                    kind: PeriodKind::Lesson,
                },
                planner_cmd::PeriodSpec {
                    id: None,
                    label: "Friminutt".into(),
                    start_min: 525,
                    end_min: 540,
                    kind: PeriodKind::Break,
                },
            ],
        )
        .await
        .unwrap();
        // Tuesday, first period: class 7B on the LIBRARY screen.
        pstore::set_slot(
            pool,
            2,
            &periods[0].id,
            Some((&Some(a.id.clone()), "Matte", &Some(library.id.clone()))),
        )
        .await
        .unwrap();
        // Wednesday, first period: class 8A on ITS OWN DEFAULT screen — the
        // pointer that only survives if the default scene id is derived and
        // mapped, not reconstructed.
        pstore::set_slot(
            pool,
            3,
            &periods[0].id,
            Some((
                &Some(b.id.clone()),
                "Norsk",
                &Some(store::default_scene_id(&b.id)),
            )),
        )
        .await
        .unwrap();
    }

    async fn payload_of(pool: &SqlitePool) -> TransferFile {
        export_payload(pool, "0.4.0-test", 1_700_000_000_000.0)
            .await
            .expect("export")
    }

    #[tokio::test]
    async fn the_export_never_carries_an_absence_mark() {
        // ADR-010 / PRIVACY.md, at the seam where it could actually leak: a
        // pupil marked away today, exported, and the JSON asked whether the
        // stamp travelled. It must not be in the file under ANY spelling.
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let members =
            crate::commands::classes::members_set_for(&pool, &class.id, vec!["Kari".into()])
                .await
                .unwrap();
        store::set_member_absent(&pool, &class.id, &members[0].id, true, "2026-08-30")
            .await
            .unwrap();
        // The stamp really is stored — otherwise this test proves nothing.
        assert_eq!(
            store::list_members(&pool, &class.id).await.unwrap()[0]
                .absent_on
                .as_deref(),
            Some("2026-08-30")
        );

        let json = serde_json::to_string(&payload_of(&pool).await).unwrap();
        assert!(!json.contains("absentOn"), "no field: {json}");
        assert!(
            !json.contains("absent_on"),
            "not under any spelling: {json}"
        );
        assert!(!json.contains("2026-08-30"), "and no date stamp: {json}");
        assert!(json.contains("Kari"), "the NAME is what travels");
    }

    #[tokio::test]
    async fn a_round_trip_into_an_empty_database_reproduces_everything() {
        let (source, _ds) = temp_pool().await;
        seed_source(&source).await;
        let file = payload_of(&source).await;

        let (target, _dt) = temp_pool().await;
        let receipt = import::import_setup(&target, &file).await.unwrap();
        assert_eq!(receipt.outcome, ImportOutcome::Imported);
        assert_eq!(receipt.classes, 2);
        assert_eq!(receipt.scenes, 1, "library screens; defaults ride along");
        assert_eq!(receipt.members, 4);
        assert!(receipt.planner_imported);
        assert!(!receipt.planner_skipped);

        // Same content, different ids: exporting the TARGET and comparing to
        // the source payload with every id blanked is the strongest form of
        // "identical modulo ids" available.
        let mut before = file.clone();
        let mut after = payload_of(&target).await;
        for f in [&mut before, &mut after] {
            f.app_version = String::new();
            f.exported_at = 0.0;
            for class in &mut f.classes {
                class.id = String::new();
                if let Some(s) = &mut class.default_scene {
                    s.id = String::new();
                }
            }
            for scene in &mut f.scenes {
                scene.id = String::new();
            }
            for p in &mut f.planner.periods {
                p.id = String::new();
            }
            // The week plan's three pointers are re-minted ids too — compare
            // them by the NAMES they resolve to instead (below).
            f.planner.week.clear();
        }
        assert_eq!(after, before, "everything but the ids came through");

        // …and the week plan's pointers, resolved through the NEW ids.
        let names: std::collections::HashMap<String, String> = store::list_classes(&target)
            .await
            .unwrap()
            .into_iter()
            .map(|c| (c.id, c.name))
            .collect();
        let scenes: std::collections::HashMap<String, String> =
            pstore::scene_names(&target).await.unwrap();
        let week = pstore::list_week_slots(&target).await.unwrap();
        assert_eq!(week.len(), 2);
        let tuesday = week.iter().find(|s| s.weekday == 2).expect("tuesday");
        assert_eq!(names[tuesday.class_id.as_ref().unwrap()], "7B");
        assert_eq!(scenes[tuesday.scene_id.as_ref().unwrap()], "Prøve");
        assert_eq!(tuesday.subject, "Matte");
        let wednesday = week.iter().find(|s| s.weekday == 3).expect("wednesday");
        let cls = wednesday.class_id.clone().unwrap();
        assert_eq!(names[&cls], "8A");
        assert_eq!(
            wednesday.scene_id.as_deref(),
            Some(store::default_scene_id(&cls).as_str()),
            "a slot pointing at a class DEFAULT screen must land on the NEW \
             class's default — derived, then mapped"
        );
    }

    #[tokio::test]
    async fn an_unknown_widget_kind_survives_the_round_trip_raw() {
        // The downgrade promise, applied to a file: a widget kind this build
        // cannot render must arrive byte-for-byte, because a NEWER build on
        // the other machine will render it.
        let (source, _ds) = temp_pool().await;
        seed_source(&source).await;
        let file = payload_of(&source).await;

        let (target, _dt) = temp_pool().await;
        import::import_setup(&target, &file).await.unwrap();

        let library = store::list_global_scenes(&target).await.unwrap();
        let rows = store::load_widget_rows(&target, &library[0].id)
            .await
            .unwrap();
        let future = rows
            .iter()
            .find(|r| r.kind == "dayplan")
            .expect("preserved");
        assert_eq!(future.config, r#"{"kind":"dayplan","entries":[1,2]}"#);
        // And the app still refuses to render it, exactly as before.
        let visible = crate::commands::layout::load_for(&target, &library[0].id)
            .await
            .unwrap();
        assert_eq!(visible.len(), 1, "only the clock is renderable here");
    }

    #[tokio::test]
    async fn importing_adds_and_never_overwrites() {
        let (source, _ds) = temp_pool().await;
        seed_source(&source).await;
        let file = payload_of(&source).await;

        // A target that already has a class of its own, on screen.
        let (target, _dt) = temp_pool().await;
        let mine = store::insert_class(&target, "9C").await.unwrap();
        crate::commands::classes::members_set_for(&target, &mine.id, vec!["Sara".into()])
            .await
            .unwrap();
        crate::commands::classes::switch_for(&target, &mine.id)
            .await
            .unwrap();
        let before = crate::settings::load(&target).await.unwrap();

        import::import_setup(&target, &file).await.unwrap();

        // Mine is untouched, and three classes now exist.
        assert_eq!(count(&target, "class").await, 3);
        assert_eq!(
            store::list_members(&target, &mine.id).await.unwrap()[0].name,
            "Sara"
        );
        // The board did not move: the settings blob is byte-identical.
        assert_eq!(crate::settings::load(&target).await.unwrap(), before);

        // A SECOND import of the same file adds a second copy rather than
        // merging — "always new" is the whole semantics.
        import::import_setup(&target, &file).await.unwrap();
        assert_eq!(count(&target, "class").await, 5);
    }

    #[tokio::test]
    async fn the_week_plan_is_skipped_when_a_school_day_already_exists() {
        let (source, _ds) = temp_pool().await;
        seed_source(&source).await;
        let file = payload_of(&source).await;

        // The target has its OWN school day. Merging would double it:
        // re-minted period ids make `UNIQUE (weekday, period_id)` miss every
        // time, and `resolve_day` walks every period row it finds.
        let (target, _dt) = temp_pool().await;
        planner_cmd::periods_set_for(
            &target,
            vec![planner_cmd::PeriodSpec {
                id: None,
                label: "Økt 1".into(),
                start_min: 500,
                end_min: 560,
                kind: PeriodKind::Lesson,
            }],
        )
        .await
        .unwrap();

        let receipt = import::import_setup(&target, &file).await.unwrap();
        assert_eq!(receipt.outcome, ImportOutcome::Imported);
        assert!(!receipt.planner_imported);
        assert!(receipt.planner_skipped, "and the receipt has to SAY so");
        assert_eq!(receipt.classes, 2, "the classes still came");

        assert_eq!(count(&target, "period").await, 1, "one school day, still");
        assert_eq!(count(&target, "week_slot").await, 0);
    }

    #[tokio::test]
    async fn a_file_with_no_school_day_reports_neither_imported_nor_skipped() {
        let (source, _ds) = temp_pool().await;
        store::insert_class(&source, "7B").await.unwrap();
        let file = payload_of(&source).await;

        let (target, _dt) = temp_pool().await;
        let receipt = import::import_setup(&target, &file).await.unwrap();
        assert!(!receipt.planner_imported);
        assert!(!receipt.planner_skipped, "there was nothing to skip");
    }

    #[tokio::test]
    async fn an_oversized_file_is_refused_whole_rather_than_truncated() {
        let (target, _dt) = temp_pool().await;
        let mut file = TransferFile::new("t", 0.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "7B".into(),
            members: (0..sundayscreen_core::members::MEMBERS_MAX + 1)
                .map(|i| format!("Elev {i}"))
                .collect(),
            default_scene: None,
        });

        let receipt = import::import_setup(&target, &file).await.unwrap();
        assert_eq!(receipt.outcome, ImportOutcome::TooLarge);
        assert_eq!(receipt.classes, 0);
        assert_eq!(
            count(&target, "class").await,
            0,
            "a refusal must not leave half a class behind"
        );
    }

    #[tokio::test]
    async fn a_malformed_file_is_refused_and_writes_nothing() {
        let (target, _dt) = temp_pool().await;

        // An empty class name — the store's own `valid_class_name` would
        // refuse it from the UI, so the import refuses it from a file.
        let mut file = TransferFile::new("t", 0.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "   ".into(),
            members: Vec::new(),
            default_scene: None,
        });
        assert_eq!(
            import::import_setup(&target, &file).await.unwrap().outcome,
            ImportOutcome::Unreadable
        );

        // A weekend column in the weekly grid: it could never be shown, and
        // dropping it quietly is the thing this app does not do.
        let mut file = TransferFile::new("t", 0.0);
        file.planner.periods.push(transfer::TransferPeriod {
            id: "p1".into(),
            label: "1. time".into(),
            start_min: 480,
            end_min: 525,
            kind: PeriodKind::Lesson,
        });
        file.planner.week.push(TransferSlot {
            weekday: 6,
            period_id: "p1".into(),
            class_id: None,
            subject: "Lørdagsskole".into(),
            scene_id: None,
        });
        assert_eq!(
            import::import_setup(&target, &file).await.unwrap().outcome,
            ImportOutcome::Unreadable
        );

        // Overlapping periods: `planner_periods_set` refuses these, and a
        // direct INSERT is exactly the door that bypasses that gate.
        let mut file = TransferFile::new("t", 0.0);
        for (i, (start, end)) in [(480, 540), (500, 560)].into_iter().enumerate() {
            file.planner.periods.push(transfer::TransferPeriod {
                id: format!("p{i}"),
                label: format!("{i}. time"),
                start_min: start,
                end_min: end,
                kind: PeriodKind::Lesson,
            });
        }
        assert_eq!(
            import::import_setup(&target, &file).await.unwrap().outcome,
            ImportOutcome::Unreadable
        );

        assert_eq!(count(&target, "class").await, 0);
        assert_eq!(count(&target, "period").await, 0);
    }

    #[tokio::test]
    async fn a_class_always_gets_a_default_screen_even_from_a_file_without_one() {
        let (target, _dt) = temp_pool().await;
        let mut file = TransferFile::new("t", 0.0);
        file.classes.push(TransferClass {
            id: "c1".into(),
            name: "7B".into(),
            members: vec!["Kari".into()],
            default_scene: None,
        });
        import::import_setup(&target, &file).await.unwrap();

        let class = &store::list_classes(&target).await.unwrap()[0];
        let scene = store::get_scene(&target, &store::default_scene_id(&class.id))
            .await
            .unwrap()
            .expect("a class without a default screen is unrepresentable");
        assert_eq!(scene.name, "7B");
    }

    #[tokio::test]
    async fn an_export_of_an_empty_database_imports_as_nothing() {
        let (source, _ds) = temp_pool().await;
        let file = payload_of(&source).await;
        assert!(file.classes.is_empty());

        let (target, _dt) = temp_pool().await;
        let receipt = import::import_setup(&target, &file).await.unwrap();
        assert_eq!(receipt.outcome, ImportOutcome::Imported);
        assert_eq!(receipt.classes, 0);
        assert_eq!(count(&target, "class").await, 0);
    }

    #[tokio::test]
    async fn a_file_written_by_this_build_reads_back_through_the_port() {
        // The two halves meet: what `export_payload` writes is what
        // `transfer::parse` accepts, JSON text and all.
        let (source, _ds) = temp_pool().await;
        seed_source(&source).await;
        let json = serde_json::to_string_pretty(&payload_of(&source).await).unwrap();
        assert!(json.contains(r#""kind": "sundayscreen-setup""#));

        let parsed = transfer::parse(&json).expect("our own file must pass our own gate");
        let (target, _dt) = temp_pool().await;
        assert_eq!(
            import::import_setup(&target, &parsed)
                .await
                .unwrap()
                .outcome,
            ImportOutcome::Imported
        );
    }
}
