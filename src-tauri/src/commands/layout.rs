//! Layout commands — the thin shell over the core's tolerance seam. The
//! pool-taking functions carry the logic (and the tests); the `#[tauri::command]`
//! wrappers only unwrap managed state.

use sqlx::SqlitePool;
use sundayscreen_core::layout::{clamp_layout, row_to_instance, WidgetInstance};
use tauri::State;

use crate::db::store::{self, WidgetRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// A class's renderable layout. Rows whose `kind` this build does not know
/// are SKIPPED, never deleted.
pub async fn load_for(pool: &SqlitePool, class_id: &str) -> AppResult<Vec<WidgetInstance>> {
    let rows = store::load_widget_rows(pool, class_id).await?;
    let mut widgets: Vec<WidgetInstance> = rows
        .iter()
        .filter_map(|r| row_to_instance(&r.id, &r.kind, r.x, r.y, r.w, r.h, r.z, &r.config))
        .collect();
    clamp_layout(&mut widgets);
    Ok(widgets)
}

/// Replace the class's layout with `widgets` — plus every stored row whose
/// kind this build does not know, preserved byte-for-byte at the top of the
/// z order (a newer version's widgets survive a downgraded save; promise #3
/// in CLAUDE.md). A write that fails REJECTS.
pub async fn save_for(
    pool: &SqlitePool,
    class_id: &str,
    mut widgets: Vec<WidgetInstance>,
) -> AppResult<()> {
    if store::get_class(pool, class_id).await?.is_none() {
        return Err(AppError::NotFound {
            entity: "class",
            id: class_id.to_string(),
        });
    }

    clamp_layout(&mut widgets);

    // `row_to_instance` returning None is exactly the "unknown to this
    // build" test.
    let stored = store::load_widget_rows(pool, class_id).await?;
    let unknown: Vec<WidgetRow> = stored
        .into_iter()
        .filter(|r| row_to_instance(&r.id, &r.kind, r.x, r.y, r.w, r.h, r.z, &r.config).is_none())
        .collect();

    let mut rows: Vec<WidgetRow> = Vec::with_capacity(widgets.len() + unknown.len());
    for w in &widgets {
        rows.push(WidgetRow {
            id: w.id.clone(),
            kind: w.config.kind().to_string(),
            x: w.rect.x,
            y: w.rect.y,
            w: w.rect.w,
            h: w.rect.h,
            z: w.z,
            config: serde_json::to_string(&w.config)?,
        });
    }
    let base_z = widgets.len() as i64;
    for (i, mut row) in unknown.into_iter().enumerate() {
        row.z = base_z + i as i64;
        rows.push(row);
    }

    store::replace_widgets(pool, class_id, &rows).await
}

#[tauri::command]
pub async fn layout_load(db: State<'_, Db>, class_id: String) -> AppResult<Vec<WidgetInstance>> {
    load_for(db.pool(), &class_id).await
}

#[tauri::command]
pub async fn layout_save(
    db: State<'_, Db>,
    class_id: String,
    widgets: Vec<WidgetInstance>,
) -> AppResult<()> {
    save_for(db.pool(), &class_id, widgets).await
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
            },
        }
    }

    #[tokio::test]
    async fn save_then_load_round_trips() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();

        save_for(&pool, &class.id, vec![text_widget("w1", "Husk gymtøy!")])
            .await
            .unwrap();
        let loaded = load_for(&pool, &class.id).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "w1");
        let WidgetConfig::Text { content, .. } = &loaded[0].config;
        assert_eq!(content, "Husk gymtøy!");
    }

    #[tokio::test]
    async fn save_to_a_missing_class_is_not_found() {
        let (pool, _d) = temp_pool().await;
        let err = save_for(&pool, "ghost", vec![]).await.unwrap_err();
        assert_eq!(err.code(), "not_found");
    }

    #[tokio::test]
    async fn unknown_kind_rows_survive_a_save_and_are_skipped_by_load() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();

        // A "newer version" wrote a widget kind this build does not know.
        store::replace_widgets(
            &pool,
            &class.id,
            &[store::WidgetRow {
                id: "future".to_string(),
                kind: "dayplan".to_string(),
                x: 0.5,
                y: 0.5,
                w: 0.4,
                h: 0.3,
                z: 0,
                config: r#"{"kind":"dayplan","entries":[]}"#.to_string(),
            }],
        )
        .await
        .unwrap();

        // Load renders nothing (the kind is unknown) …
        assert!(load_for(&pool, &class.id).await.unwrap().is_empty());

        // … and a save of the visible layout must NOT destroy the row.
        save_for(&pool, &class.id, vec![text_widget("w1", "hei")])
            .await
            .unwrap();
        let rows = store::load_widget_rows(&pool, &class.id).await.unwrap();
        assert_eq!(rows.len(), 2);
        let future = rows.iter().find(|r| r.id == "future").expect("preserved");
        assert_eq!(future.kind, "dayplan");
        assert_eq!(future.config, r#"{"kind":"dayplan","entries":[]}"#);
        // Byte-for-byte except z, which is re-stacked above the known ones.
        assert_eq!(future.z, 1);
    }

    #[tokio::test]
    async fn load_clamps_a_hand_edited_offscreen_row() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        store::replace_widgets(
            &pool,
            &class.id,
            &[store::WidgetRow {
                id: "w1".to_string(),
                kind: "text".to_string(),
                x: 5.0,
                y: -3.0,
                w: 0.001,
                h: 20.0,
                z: 7,
                config: r#"{"kind":"text"}"#.to_string(),
            }],
        )
        .await
        .unwrap();

        let loaded = load_for(&pool, &class.id).await.unwrap();
        assert_eq!(loaded.len(), 1);
        let r = loaded[0].rect;
        assert!(r.x >= 0.0 && r.x + r.w <= 1.0);
        assert!(r.y >= 0.0 && r.y + r.h <= 1.0);
        assert!(r.w >= sundayscreen_core::layout::MIN_NORM_SIZE);
        assert_eq!(loaded[0].z, 0, "z re-indexed densely");
    }
}
