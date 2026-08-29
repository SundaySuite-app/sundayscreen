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
use crate::db::store::{self, ClassRow, MemberRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;

/// Longest class name we accept.
const NAME_MAX_CHARS: usize = 80;

/// Everything the frontend needs after a class switch, read in one command
/// so the swap is atomic from the shell's point of view.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "ClassSnapshot.ts")]
#[serde(rename_all = "camelCase")]
pub struct ClassSnapshot {
    pub class: ClassRow,
    pub members: Vec<MemberRow>,
    pub widgets: Vec<WidgetInstance>,
}

fn valid_class_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::Validation("class name must not be empty".into()));
    }
    Ok(name.chars().take(NAME_MAX_CHARS).collect())
}

async fn require_class(pool: &SqlitePool, id: &str) -> AppResult<ClassRow> {
    store::get_class(pool, id).await?.ok_or(AppError::NotFound {
        entity: "class",
        id: id.to_string(),
    })
}

async fn snapshot_for(pool: &SqlitePool, class: ClassRow) -> AppResult<ClassSnapshot> {
    let members = store::list_members(pool, &class.id).await?;
    let widgets = layout_cmd::load_for(pool, &class.id).await?;
    Ok(ClassSnapshot {
        class,
        members,
        widgets,
    })
}

/// Switch the active class: point the settings at it and read its full
/// snapshot. The frontend flushes the OLD class's pending saves before
/// calling this (the sequencing seam in state/layout.ts).
pub async fn switch_for(pool: &SqlitePool, class_id: &str) -> AppResult<ClassSnapshot> {
    let class = require_class(pool, class_id).await?;
    // Serialized RMW (F9-funn B#3): a plain load→save here silently reverted
    // any settings field a concurrent save had just written.
    settings::update(pool, |s| {
        s.active_class_id = Some(class_id.to_string());
    })
    .await?;
    snapshot_for(pool, class).await
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
pub async fn class_ensure_active(db: State<'_, Db>, default_name: String) -> AppResult<ClassRow> {
    let pool = db.pool();
    // The whole bootstrap holds the settings lock (F9-funn B#4): two
    // concurrent ensures must not both see "no class" and mint two defaults.
    let guard = settings::lock().await;
    let mut s = settings::load(pool).await?;

    if let Some(id) = &s.active_class_id {
        if let Some(class) = store::get_class(pool, id).await? {
            return Ok(class);
        }
    }

    let class = match store::first_class(pool).await? {
        Some(existing) => existing,
        None => {
            let name = valid_class_name(&default_name)?;
            store::insert_class(pool, &name).await?
        }
    };

    s.active_class_id = Some(class.id.clone());
    settings::save_with(pool, s, &guard).await?;
    Ok(class)
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
        layout_cmd::save_for(&pool, &b.id, vec![text_widget("w1")])
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
