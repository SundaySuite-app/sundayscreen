//! The scene library: named, reusable screens. Global scenes (class_id =
//! NULL) are usable in every class — widgets read the ACTIVE class's data,
//! so a layout is class-agnostic. A class's default scene is managed by the
//! class lifecycle (created with it, dies with it) and is deliberately NOT
//! part of the library: it cannot be renamed, listed or deleted here.

use serde::Serialize;
use sqlx::SqlitePool;
use sundayscreen_core::members::CLASS_NAME_MAX_CHARS;
use sundayscreen_core::theme::SceneTheme;
use tauri::State;
use ts_rs::TS;

use crate::commands::classes::{lesson_switch_for, ClassSnapshot};
use crate::commands::valid_date;
use crate::db::planner as pstore;
use crate::db::store::{self, SceneRow, WidgetRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;

/// Where a screen is still used in the PLAN — the two numbers behind «denne
/// skjermen brukes i N timer».
///
/// Two fields rather than one total: they are different sentences to a
/// teacher (a weekly cell repeats every week; a date override happens once),
/// and adding them here would take that choice away from the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "SceneUsage.ts")]
#[serde(rename_all = "camelCase")]
pub struct SceneUsage {
    /// Cells in the recurring weekly timetable pointing at this screen.
    #[ts(type = "number")]
    pub week_slots: u32,
    /// Date overrides pointing at it on `today` or later. The past is not
    /// counted: it cannot be affected by a deletion made now.
    #[ts(type = "number")]
    pub future_overrides: u32,
}

// A screen's name is bounded by the same `members::CLASS_NAME_MAX_CHARS` a
// class name is — `transfer::check_limits` checks both against that ONE
// constant, so a local copy here could only ever drift into disagreement.

fn valid_scene_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::Validation("scene name must not be empty".into()));
    }
    Ok(name.chars().take(CLASS_NAME_MAX_CHARS).collect())
}

async fn require_scene(pool: &SqlitePool, id: &str) -> AppResult<SceneRow> {
    store::get_scene(pool, id).await?.ok_or(AppError::NotFound {
        entity: "scene",
        id: id.to_string(),
    })
}

fn require_global(scene: &SceneRow) -> AppResult<()> {
    if scene.class_id.is_some() {
        return Err(AppError::Validation(
            "a class's default scene is not a library scene".into(),
        ));
    }
    Ok(())
}

pub async fn rename_for(pool: &SqlitePool, scene_id: &str, name: &str) -> AppResult<SceneRow> {
    let scene = require_scene(pool, scene_id).await?;
    require_global(&scene)?;
    let name = valid_scene_name(name)?;
    store::rename_scene(pool, scene_id, &name).await?;
    require_scene(pool, scene_id).await
}

/// Delete a library scene. If it was on screen, the pointer heals to the
/// active class's default at the next resolve (ensure/switch).
pub async fn delete_for(pool: &SqlitePool, scene_id: &str) -> AppResult<()> {
    let scene = require_scene(pool, scene_id).await?;
    require_global(&scene)?;
    store::delete_scene(pool, scene_id).await?;
    settings::update(pool, |s| {
        if s.active_scene_id.as_deref() == Some(scene_id) {
            s.active_scene_id = None;
        }
    })
    .await?;
    Ok(())
}

/// Copy any scene (a class default included — this IS «lagre som ny
/// skjerm») into a fresh GLOBAL library scene with fresh widget ids.
///
/// The BACKDROP travels with the copy. A duplicated screen that came back
/// white is a bug a teacher notices immediately: the colour is part of what
/// she recognises the screen by, exactly like the widgets on it.
pub async fn duplicate_for(pool: &SqlitePool, scene_id: &str, name: &str) -> AppResult<SceneRow> {
    let source = require_scene(pool, scene_id).await?;
    let name = valid_scene_name(name)?;
    let rows = store::load_widget_rows(pool, scene_id).await?;
    let mut copy = store::insert_global_scene(pool, &name).await?;
    let fresh: Vec<WidgetRow> = rows
        .into_iter()
        .map(|r| WidgetRow {
            id: store::new_id(),
            ..r
        })
        .collect();
    store::replace_widgets(pool, &copy.id, &fresh).await?;
    if source.theme != copy.theme {
        store::set_scene_theme(pool, &copy.id, source.theme).await?;
        copy.theme = source.theme;
    }
    Ok(copy)
}

/// Recolour a screen's backdrop.
///
/// NO `require_global`: a class's default screen is the one on the wall most
/// of the week, and colouring it is the whole point. The two restricted verbs
/// (rename, delete) are restricted because they would take a row the class
/// lifecycle owns; a theme is a column on a row that keeps existing.
pub async fn set_theme_for(
    pool: &SqlitePool,
    scene_id: &str,
    theme: SceneTheme,
) -> AppResult<SceneRow> {
    require_scene(pool, scene_id).await?;
    store::set_scene_theme(pool, scene_id, theme).await?;
    require_scene(pool, scene_id).await
}

/// Count where `scene_id` is still planned. `today` is the frontend's local
/// wall date (JS owns the clock) and is validated like every other date key.
///
/// Deliberately NOT `require_scene`: this is asked WHILE a deletion is being
/// armed, and answering «0 places» for a screen that has just disappeared is
/// a truthful answer to «what would this deletion take with it».
pub async fn usage_for(pool: &SqlitePool, scene_id: &str, today: &str) -> AppResult<SceneUsage> {
    valid_date(today)?;
    let (week_slots, future_overrides) = pstore::scene_usage_counts(pool, scene_id, today).await?;
    Ok(SceneUsage {
        week_slots: week_slots.max(0) as u32,
        future_overrides: future_overrides.max(0) as u32,
    })
}

// ── The command wrappers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn scene_list(db: State<'_, Db>) -> AppResult<Vec<SceneRow>> {
    store::list_global_scenes(db.pool()).await
}

#[tauri::command]
pub async fn scene_create(db: State<'_, Db>, name: String) -> AppResult<SceneRow> {
    let name = valid_scene_name(&name)?;
    store::insert_global_scene(db.pool(), &name).await
}

#[tauri::command]
pub async fn scene_rename(
    db: State<'_, Db>,
    scene_id: String,
    name: String,
) -> AppResult<SceneRow> {
    rename_for(db.pool(), &scene_id, &name).await
}

#[tauri::command]
pub async fn scene_delete(db: State<'_, Db>, scene_id: String) -> AppResult<()> {
    delete_for(db.pool(), &scene_id).await
}

#[tauri::command]
pub async fn scene_duplicate(
    db: State<'_, Db>,
    scene_id: String,
    name: String,
) -> AppResult<SceneRow> {
    duplicate_for(db.pool(), &scene_id, &name).await
}

/// Recolour a screen. The argument is the TYPED enum, so an unknown spelling
/// is refused at the IPC boundary rather than written to the column — the
/// leniency lives where stored bytes are READ (`SceneTheme::parse`), which is
/// where a newer build's word can actually turn up.
#[tauri::command]
pub async fn scene_set_theme(
    db: State<'_, Db>,
    scene_id: String,
    theme: SceneTheme,
) -> AppResult<SceneRow> {
    set_theme_for(db.pool(), &scene_id, theme).await
}

/// What a deletion would take with it — read when the teacher ARMS the
/// delete, so the confirmation can say how many lessons still point here.
#[tauri::command]
pub async fn scene_usage(
    db: State<'_, Db>,
    scene_id: String,
    today: String,
) -> AppResult<SceneUsage> {
    usage_for(db.pool(), &scene_id, &today).await
}

/// The ONE switch: class + scene in a single atomic pointer move + snapshot.
/// `scene_id = None` lands on the class's default scene.
#[tauri::command]
pub async fn lesson_switch(
    db: State<'_, Db>,
    class_id: String,
    scene_id: Option<String>,
) -> AppResult<ClassSnapshot> {
    lesson_switch_for(db.pool(), &class_id, scene_id.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::layout as layout_cmd;
    use sundayscreen_core::layout::{NormRect, TextAlign, WidgetConfig, WidgetInstance};

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    fn text_widget(id: &str, content: &str) -> WidgetInstance {
        WidgetInstance {
            id: id.to_string(),
            rect: NormRect {
                x: 0.1,
                y: 0.1,
                w: 0.3,
                h: 0.2,
            },
            z: 0,
            config: WidgetConfig::Text {
                content: content.to_string(),
                font_scale: 1.0,
                align: TextAlign::Center,
                extra: Default::default(),
            },
        }
    }

    #[tokio::test]
    async fn saving_scene_a_never_touches_scene_b() {
        let (pool, _d) = temp_pool().await;
        let a = store::insert_global_scene(&pool, "Skriveøkt")
            .await
            .unwrap();
        let b = store::insert_global_scene(&pool, "Prøve").await.unwrap();
        layout_cmd::save_for(&pool, &b.id, vec![text_widget("wb", "b")])
            .await
            .unwrap();

        layout_cmd::save_for(&pool, &a.id, vec![text_widget("wa", "a")])
            .await
            .unwrap();
        layout_cmd::save_for(&pool, &a.id, vec![]).await.unwrap();

        assert!(layout_cmd::load_for(&pool, &a.id).await.unwrap().is_empty());
        assert_eq!(layout_cmd::load_for(&pool, &b.id).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn duplicate_copies_widgets_with_fresh_ids() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let default_id = store::default_scene_id(&class.id);
        layout_cmd::save_for(&pool, &default_id, vec![text_widget("w1", "hei")])
            .await
            .unwrap();

        let copy = duplicate_for(&pool, &default_id, "Skriveøkt")
            .await
            .unwrap();
        assert!(copy.class_id.is_none(), "the copy is a library scene");
        let widgets = layout_cmd::load_for(&pool, &copy.id).await.unwrap();
        assert_eq!(widgets.len(), 1);
        assert_ne!(widgets[0].id, "w1", "fresh id");

        // The source is untouched.
        assert_eq!(
            layout_cmd::load_for(&pool, &default_id)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn a_duplicate_keeps_the_screens_colour() {
        let (pool, _d) = temp_pool().await;
        let source = store::insert_global_scene(&pool, "Prøve").await.unwrap();
        assert_eq!(
            source.theme,
            SceneTheme::Standard,
            "a new screen starts here"
        );
        set_theme_for(&pool, &source.id, SceneTheme::Tavle)
            .await
            .unwrap();

        let copy = duplicate_for(&pool, &source.id, "Prøve 2").await.unwrap();
        assert_eq!(copy.theme, SceneTheme::Tavle, "the answer carries it");
        assert_eq!(
            store::get_scene(&pool, &copy.id)
                .await
                .unwrap()
                .unwrap()
                .theme,
            SceneTheme::Tavle,
            "and so does the row"
        );
    }

    #[tokio::test]
    async fn a_class_default_screen_may_be_recoloured() {
        // The one verb that is NOT `require_global`-gated, and deliberately:
        // the default screen is the one on the wall most of the week.
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let default_id = store::default_scene_id(&class.id);

        let scene = set_theme_for(&pool, &default_id, SceneTheme::Kjolig)
            .await
            .unwrap();
        assert_eq!(scene.theme, SceneTheme::Kjolig);
        assert!(scene.class_id.is_some(), "still the class's own screen");

        // …and an unknown id is still a NotFound, not a silent no-op.
        assert_eq!(
            set_theme_for(&pool, "no-such-scene", SceneTheme::Tavle)
                .await
                .unwrap_err()
                .code(),
            "not_found"
        );
    }

    #[tokio::test]
    async fn class_default_scenes_are_not_library_scenes() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let default_id = store::default_scene_id(&class.id);

        assert!(store::list_global_scenes(&pool).await.unwrap().is_empty());
        assert_eq!(
            rename_for(&pool, &default_id, "x")
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            delete_for(&pool, &default_id).await.unwrap_err().code(),
            "validation"
        );
    }

    #[tokio::test]
    async fn deleting_the_active_scene_clears_the_pointer() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let scene = store::insert_global_scene(&pool, "Prøve").await.unwrap();
        lesson_switch_for(&pool, &class.id, Some(&scene.id))
            .await
            .unwrap();
        assert_eq!(
            settings::load(&pool).await.unwrap().active_scene_id,
            Some(scene.id.clone())
        );

        delete_for(&pool, &scene.id).await.unwrap();
        assert_eq!(settings::load(&pool).await.unwrap().active_scene_id, None);
    }

    #[tokio::test]
    async fn lesson_switch_refuses_another_classes_default() {
        let (pool, _d) = temp_pool().await;
        let a = store::insert_class(&pool, "7B").await.unwrap();
        let b = store::insert_class(&pool, "8A").await.unwrap();
        assert_eq!(
            lesson_switch_for(&pool, &a.id, Some(&store::default_scene_id(&b.id)))
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
    }

    #[tokio::test]
    async fn scene_usage_counts_the_week_and_only_the_future_of_the_calendar() {
        use crate::commands::planner::{self as planner_cmd, OverrideSpec, SlotSpec};
        use sundayscreen_core::schedule::{OverrideKind, PeriodKind};

        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let scene = store::insert_global_scene(&pool, "Prøve").await.unwrap();
        let other = store::insert_global_scene(&pool, "Skriveøkt")
            .await
            .unwrap();
        let periods = planner_cmd::periods_set_for(
            &pool,
            vec![
                planner_cmd::PeriodSpec {
                    id: None,
                    label: "1. time".into(),
                    start_min: 510,
                    end_min: 555,
                    kind: PeriodKind::Lesson,
                },
                planner_cmd::PeriodSpec {
                    id: None,
                    label: "2. time".into(),
                    start_min: 565,
                    end_min: 610,
                    kind: PeriodKind::Lesson,
                },
            ],
        )
        .await
        .unwrap();
        let slot = |scene_id: &str| SlotSpec {
            class_id: Some(class.id.clone()),
            subject: "Norsk".into(),
            scene_id: Some(scene_id.to_string()),
            merged_with_next: false,
        };
        // Two weekly cells on the screen, one on another screen.
        planner_cmd::slot_set_for(&pool, 1, &periods[0].id, Some(&slot(&scene.id)))
            .await
            .unwrap();
        planner_cmd::slot_set_for(&pool, 2, &periods[0].id, Some(&slot(&scene.id)))
            .await
            .unwrap();
        planner_cmd::slot_set_for(&pool, 3, &periods[0].id, Some(&slot(&other.id)))
            .await
            .unwrap();

        let ovr = |scene_id: &str| OverrideSpec {
            kind: OverrideKind::Lesson,
            class_id: Some(class.id.clone()),
            subject: "Matte".into(),
            scene_id: Some(scene_id.to_string()),
            title: "Prøve".into(),
            merged_with_next: None,
        };
        for date in ["2026-08-20", "2026-09-01", "2026-09-14"] {
            planner_cmd::override_set_for(&pool, date, &periods[0].id, Some(&ovr(&scene.id)))
                .await
                .unwrap();
        }
        // …and one on another screen, on a future date.
        planner_cmd::override_set_for(&pool, "2026-09-14", &periods[1].id, Some(&ovr(&other.id)))
            .await
            .unwrap();

        let usage = usage_for(&pool, &scene.id, "2026-09-01").await.unwrap();
        assert_eq!(usage.week_slots, 2);
        assert_eq!(
            usage.future_overrides, 2,
            "TODAY counts; 2026-08-20 is over and cannot be affected"
        );

        // A screen nothing points at answers zero rather than failing.
        let unused = store::insert_global_scene(&pool, "Ubrukt").await.unwrap();
        let zero = usage_for(&pool, &unused.id, "2026-09-01").await.unwrap();
        assert_eq!((zero.week_slots, zero.future_overrides), (0, 0));

        // The date comes from the frontend and is gated like every other one:
        // a nonsense key would make `date >= ?` compare against nothing real.
        assert_eq!(
            usage_for(&pool, &scene.id, "2026-99-99")
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
    }

    #[tokio::test]
    async fn cascade_class_to_default_scene_to_widgets() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let default_id = store::default_scene_id(&class.id);
        layout_cmd::save_for(&pool, &default_id, vec![text_widget("w1", "hei")])
            .await
            .unwrap();

        crate::commands::classes::delete_for(&pool, &class.id)
            .await
            .unwrap();
        assert!(store::get_scene(&pool, &default_id)
            .await
            .unwrap()
            .is_none());
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM widget_instance")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0);
    }
}
