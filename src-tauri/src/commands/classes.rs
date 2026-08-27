//! Class commands. F1 needs only the bootstrap: SOME class must exist for
//! the layout to hang on, and the settings must point at it. Full CRUD (the
//! manage panel) lands in F3 on top of the same rows.

use tauri::State;

use crate::db::store::{self, ClassRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;

/// Longest class name we accept.
const NAME_MAX_CHARS: usize = 80;

/// Resolve the active class, creating one if the database has none.
///
/// Order: the settings' `active_class_id` if it still exists → the first
/// class in display order (the stored id can go stale when that class is
/// deleted) → a fresh class named `default_name` (the frontend passes the
/// translated default, so DB content never depends on backend i18n). The
/// settings are updated whenever the answer differs from what they said.
#[tauri::command]
pub async fn class_ensure_active(db: State<'_, Db>, default_name: String) -> AppResult<ClassRow> {
    let pool = db.pool();
    let mut s = settings::load(pool).await?;

    if let Some(id) = &s.active_class_id {
        if let Some(class) = store::get_class(pool, id).await? {
            return Ok(class);
        }
    }

    let class = match store::first_class(pool).await? {
        Some(existing) => existing,
        None => {
            let name = default_name.trim();
            let name = if name.is_empty() {
                return Err(AppError::Validation("class name must not be empty".into()));
            } else {
                name.chars().take(NAME_MAX_CHARS).collect::<String>()
            };
            store::insert_class(pool, &name).await?
        }
    };

    s.active_class_id = Some(class.id.clone());
    settings::save(pool, s).await?;
    Ok(class)
}
