//! The scene library: named, reusable screens. Global scenes (class_id =
//! NULL) are usable in every class — widgets read the ACTIVE class's data,
//! so a layout is class-agnostic. A class's default scene is managed by the
//! class lifecycle (created with it, dies with it) and is deliberately NOT
//! part of the library: it cannot be renamed, listed or deleted here.

use sqlx::SqlitePool;
use tauri::State;

use crate::commands::classes::{lesson_switch_for, ClassSnapshot};
use crate::db::store::{self, SceneRow, WidgetRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;

/// Longest scene name we accept.
const NAME_MAX_CHARS: usize = 80;

fn valid_scene_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::Validation("scene name must not be empty".into()));
    }
    Ok(name.chars().take(NAME_MAX_CHARS).collect())
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
pub async fn duplicate_for(pool: &SqlitePool, scene_id: &str, name: &str) -> AppResult<SceneRow> {
    require_scene(pool, scene_id).await?;
    let name = valid_scene_name(name)?;
    let rows = store::load_widget_rows(pool, scene_id).await?;
    let copy = store::insert_global_scene(pool, &name).await?;
    let fresh: Vec<WidgetRow> = rows
        .into_iter()
        .map(|r| WidgetRow {
            id: store::new_id(),
            ..r
        })
        .collect();
    store::replace_widgets(pool, &copy.id, &fresh).await?;
    Ok(copy)
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
