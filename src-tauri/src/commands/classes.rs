//! Class and member commands. The pool-taking functions carry the logic
//! (and the tests); the `#[tauri::command]` wrappers only unwrap managed
//! state.

use serde::Serialize;
use sqlx::SqlitePool;
use sundayscreen_core::layout::WidgetInstance;
use sundayscreen_core::members::reconcile;
use tauri::State;
use ts_rs::TS;

use crate::commands::layout as layout_cmd;
use crate::db::store::{self, ClassRow, MemberRow, SceneRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;

/// Longest class name we accept.
const NAME_MAX_CHARS: usize = 80;

/// Everything the frontend needs after a class/scene switch, read in one
/// command so the swap is atomic from the shell's point of view.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "ClassSnapshot.ts")]
#[serde(rename_all = "camelCase")]
pub struct ClassSnapshot {
    pub class: ClassRow,
    pub scene: SceneRow,
    pub members: Vec<MemberRow>,
    pub widgets: Vec<WidgetInstance>,
}

/// What `class_ensure_active` resolves on boot: the active class AND the
/// active scene (healed to the class default when the pointer is stale).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "ActiveContext.ts")]
#[serde(rename_all = "camelCase")]
pub struct ActiveContext {
    pub class: ClassRow,
    pub scene: SceneRow,
}

fn valid_class_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::Validation("class name must not be empty".into()));
    }
    Ok(name.chars().take(NAME_MAX_CHARS).collect())
}

pub(crate) async fn require_class(pool: &SqlitePool, id: &str) -> AppResult<ClassRow> {
    store::get_class(pool, id).await?.ok_or(AppError::NotFound {
        entity: "class",
        id: id.to_string(),
    })
}

async fn snapshot_for(
    pool: &SqlitePool,
    class: ClassRow,
    scene: SceneRow,
) -> AppResult<ClassSnapshot> {
    let members = store::list_members(pool, &class.id).await?;
    let widgets = layout_cmd::load_for(pool, &scene.id).await?;
    Ok(ClassSnapshot {
        class,
        scene,
        members,
        widgets,
    })
}

/// THE switch: point both pointers (class + scene) under the settings lock
/// and read the full snapshot. `scene_id = None` means the class's default
/// scene; `Some` must be a GLOBAL library scene (a class default belongs to
/// its class alone). The frontend flushes the OLD scene's pending saves
/// before calling this (the sequencing seam in state/layout.ts).
pub async fn lesson_switch_for(
    pool: &SqlitePool,
    class_id: &str,
    scene_id: Option<&str>,
) -> AppResult<ClassSnapshot> {
    let class = require_class(pool, class_id).await?;
    let scene = match scene_id {
        None => store::ensure_default_scene(pool, &class).await?,
        Some(id) => {
            let scene = store::get_scene(pool, id)
                .await?
                .ok_or(AppError::NotFound {
                    entity: "scene",
                    id: id.to_string(),
                })?;
            if scene.class_id.is_some() && scene.class_id.as_deref() != Some(class_id) {
                return Err(AppError::Validation(
                    "a class default scene cannot be shown in another class".into(),
                ));
            }
            scene
        }
    };
    // Serialized RMW (F9-funn B#3): a plain load→save here silently reverted
    // any settings field a concurrent save had just written.
    settings::update(pool, |s| {
        s.active_class_id = Some(class_id.to_string());
        s.active_scene_id = Some(scene.id.clone());
    })
    .await?;
    snapshot_for(pool, class, scene).await
}

/// Switch the active class — lands on that class's default scene.
pub async fn switch_for(pool: &SqlitePool, class_id: &str) -> AppResult<ClassSnapshot> {
    lesson_switch_for(pool, class_id, None).await
}

/// Delete a class. If it was the active one, the settings are repointed at
/// the first remaining class (or cleared — `class_ensure_active` will
/// bootstrap a fresh one on next boot).
pub async fn delete_for(pool: &SqlitePool, class_id: &str) -> AppResult<()> {
    if !store::delete_class(pool, class_id).await? {
        return Err(AppError::NotFound {
            entity: "class",
            id: class_id.to_string(),
        });
    }
    let fallback = store::first_class(pool).await?.map(|c| c.id);
    settings::update(pool, |s| {
        if s.active_class_id.as_deref() == Some(class_id) {
            s.active_class_id = fallback.clone();
        }
        // The class's default scene died in the cascade; a stale pointer
        // heals to the (new) active class's default at the next resolve.
        if s.active_scene_id.as_deref() == Some(&store::default_scene_id(class_id)) {
            s.active_scene_id = None;
        }
    })
    .await?;
    Ok(())
}

/// Replace the member list from the textarea's lines. Identity is preserved
/// by name (core::members::reconcile), so re-saving the same list never
/// resets the picker's draw state.
pub async fn members_set_for(
    pool: &SqlitePool,
    class_id: &str,
    names: Vec<String>,
) -> AppResult<Vec<MemberRow>> {
    require_class(pool, class_id).await?;
    let existing: Vec<(String, String)> = store::list_members(pool, class_id)
        .await?
        .into_iter()
        .map(|m| (m.id, m.name))
        .collect();
    let specs = reconcile(&existing, &names);
    store::replace_members(pool, class_id, &specs).await
}

// ── The command wrappers ────────────────────────────────────────────────────

/// Resolve the active class, creating one if the database has none.
///
/// Order: the settings' `active_class_id` if it still exists → the first
/// class in display order → a fresh class named `default_name` (the frontend
/// passes the translated default, so DB content never depends on backend
/// i18n).
#[tauri::command]
pub async fn class_ensure_active(
    db: State<'_, Db>,
    default_name: String,
) -> AppResult<ActiveContext> {
    let pool = db.pool();
    // The whole bootstrap holds the settings lock (F9-funn B#4): two
    // concurrent ensures must not both see "no class" and mint two defaults.
    let guard = settings::lock().await;
    let mut s = settings::load(pool).await?;

    let class = match &s.active_class_id {
        Some(id) => match store::get_class(pool, id).await? {
            Some(class) => class,
            None => resolve_class(pool, &default_name).await?,
        },
        None => resolve_class(pool, &default_name).await?,
    };

    // Resolve the scene pointer: keep it when it still exists AND is legal
    // for this class (global, or this class's own default); heal otherwise.
    let scene = match &s.active_scene_id {
        Some(id) => match store::get_scene(pool, id).await? {
            Some(scene)
                if scene.class_id.is_none() || scene.class_id.as_deref() == Some(&class.id) =>
            {
                scene
            }
            _ => store::ensure_default_scene(pool, &class).await?,
        },
        None => store::ensure_default_scene(pool, &class).await?,
    };

    s.active_class_id = Some(class.id.clone());
    s.active_scene_id = Some(scene.id.clone());
    settings::save_with(pool, s, &guard).await?;
    Ok(ActiveContext { class, scene })
}

async fn resolve_class(pool: &SqlitePool, default_name: &str) -> AppResult<ClassRow> {
    match store::first_class(pool).await? {
        Some(existing) => Ok(existing),
        None => {
            let name = valid_class_name(default_name)?;
            store::insert_class(pool, &name).await
        }
    }
}

#[tauri::command]
pub async fn class_list(db: State<'_, Db>) -> AppResult<Vec<ClassRow>> {
    store::list_classes(db.pool()).await
}

#[tauri::command]
pub async fn class_create(db: State<'_, Db>, name: String) -> AppResult<ClassRow> {
    let name = valid_class_name(&name)?;
    store::insert_class(db.pool(), &name).await
}

#[tauri::command]
pub async fn class_rename(
    db: State<'_, Db>,
    class_id: String,
    name: String,
) -> AppResult<ClassRow> {
    let pool = db.pool();
    let name = valid_class_name(&name)?;
    if !store::rename_class(pool, &class_id, &name).await? {
        return Err(AppError::NotFound {
            entity: "class",
            id: class_id,
        });
    }
    require_class(pool, &class_id).await
}

#[tauri::command]
pub async fn class_delete(db: State<'_, Db>, class_id: String) -> AppResult<()> {
    delete_for(db.pool(), &class_id).await
}

#[tauri::command]
pub async fn class_switch(db: State<'_, Db>, class_id: String) -> AppResult<ClassSnapshot> {
    switch_for(db.pool(), &class_id).await
}

#[tauri::command]
pub async fn members_get(db: State<'_, Db>, class_id: String) -> AppResult<Vec<MemberRow>> {
    store::list_members(db.pool(), &class_id).await
}

#[tauri::command]
pub async fn members_set(
    db: State<'_, Db>,
    class_id: String,
    names: Vec<String>,
) -> AppResult<Vec<MemberRow>> {
    members_set_for(db.pool(), &class_id, names).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sundayscreen_core::layout::{NormRect, TextAlign, WidgetConfig};

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    fn text_widget(id: &str) -> WidgetInstance {
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
                content: "hei".into(),
                font_scale: 1.0,
                align: TextAlign::Center,
                extra: Default::default(),
            },
        }
    }

    #[tokio::test]
    async fn switch_returns_the_full_snapshot_and_repoints_the_settings() {
        let (pool, _d) = temp_pool().await;
        let a = store::insert_class(&pool, "7B").await.unwrap();
        let b = store::insert_class(&pool, "8A").await.unwrap();
        layout_cmd::save_for(
            &pool,
            &store::default_scene_id(&b.id),
            vec![text_widget("w1")],
        )
        .await
        .unwrap();
        members_set_for(&pool, &b.id, vec!["Kari".into()])
            .await
            .unwrap();

        let snap = switch_for(&pool, &b.id).await.unwrap();
        assert_eq!(snap.class.id, b.id);
        assert_eq!(snap.members.len(), 1);
        assert_eq!(snap.widgets.len(), 1);
        assert_eq!(
            settings::load(&pool).await.unwrap().active_class_id,
            Some(b.id.clone())
        );

        // Switching back gives A's (empty) world.
        let back = switch_for(&pool, &a.id).await.unwrap();
        assert!(back.members.is_empty());
        assert!(back.widgets.is_empty());
    }

    #[tokio::test]
    async fn switch_to_a_missing_class_is_not_found() {
        let (pool, _d) = temp_pool().await;
        assert_eq!(
            switch_for(&pool, "ghost").await.unwrap_err().code(),
            "not_found"
        );
    }

    #[tokio::test]
    async fn deleting_the_active_class_repoints_at_the_first_remaining() {
        let (pool, _d) = temp_pool().await;
        let a = store::insert_class(&pool, "7B").await.unwrap();
        let b = store::insert_class(&pool, "8A").await.unwrap();
        switch_for(&pool, &b.id).await.unwrap();

        delete_for(&pool, &b.id).await.unwrap();
        assert_eq!(
            settings::load(&pool).await.unwrap().active_class_id,
            Some(a.id.clone())
        );

        // Deleting the last class clears the pointer entirely.
        delete_for(&pool, &a.id).await.unwrap();
        assert_eq!(settings::load(&pool).await.unwrap().active_class_id, None);
    }

    #[tokio::test]
    async fn members_set_round_trips_and_preserves_identity() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let first = members_set_for(
            &pool,
            &class.id,
            vec!["Kari".into(), "  Ola  ".into(), "".into()],
        )
        .await
        .unwrap();
        assert_eq!(
            first.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(),
            vec!["Kari", "Ola"],
            "trimmed, empty lines dropped"
        );

        let second = members_set_for(&pool, &class.id, vec!["Ola".into(), "Kari".into()])
            .await
            .unwrap();
        assert_eq!(second[1].id, first[0].id, "Kari keeps her id across saves");
        assert_eq!(second[0].id, first[1].id, "Ola too, reordered");
    }
}
