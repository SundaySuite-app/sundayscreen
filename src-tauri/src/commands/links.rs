//! The link widget's one action: open its stored address in the system
//! browser.
//!
//! The contract this file exists to hold is a single sentence: **the webview
//! sends a widget ID, never a URL.** Everything else follows from it. The
//! command looks the widget up in the database, checks it really is a link,
//! reads the address out of the stored config, and runs that address through
//! the SAME rule the clamp uses (`sundayscreen_core::layout::sanitized_url`)
//! before anything is handed to the operating system.
//!
//! Re-validating here is not belt-and-braces for its own sake. «Flytt
//! oppsettet» imports widget configs RAW — `TransferWidget` carries the
//! config JSON straight to `widget_instance` without ever round-tripping it
//! through `WidgetConfig` — so between an import and the first save there are
//! bytes in the database that the clamp has not seen. The gate that talks to
//! the OS cannot assume otherwise, and it does not.

use sqlx::SqlitePool;
use sundayscreen_core::layout::sanitized_url;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::db::store;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// What `link_open` would hand the system browser — the whole decision,
/// separated from the one line that actually opens it.
///
/// Split out so it can be tested against hand-INSERTed rows: opening a URL
/// for real needs a running desktop session and would, if it worked, launch a
/// browser on whoever ran `cargo test`.
pub async fn open_url_target_for(pool: &SqlitePool, widget_id: &str) -> AppResult<String> {
    let Some(row) = store::get_widget_row(pool, widget_id).await? else {
        return Err(AppError::NotFound {
            entity: "widget",
            id: widget_id.to_string(),
        });
    };
    // The `kind` COLUMN is the authority here exactly as it is in
    // `row_to_instance` — a config that claims to be a link on a row that is
    // not one proves the row is corrupt, not that it is a link.
    if row.kind != "link" {
        return Err(AppError::Validation(
            "only a link widget can be opened".into(),
        ));
    }
    // A config that does not parse means this build cannot know the address —
    // and that answer matches what the BOARD is showing, because
    // `row_to_instance` fell back to `default_for("link")` (url = "") for the
    // very same bytes. The teacher sees "no link set" and gets told the same
    // thing here, rather than a JSON error about a field she never typed.
    let url = serde_json::from_str::<serde_json::Value>(&row.config)
        .ok()
        .as_ref()
        .and_then(|cfg| cfg.get("url"))
        .and_then(|v| v.as_str())
        .and_then(sanitized_url);
    url.ok_or_else(|| AppError::Validation("the link widget has no http(s) address".into()))
}

/// Open a link widget's stored address in the system browser.
///
/// A WRITE-shaped command on purpose: it returns nothing, and a failure
/// rejects so the shim's error ring says so. Nothing about this call is
/// automatic — it runs when the teacher clicks the card.
#[tauri::command]
pub async fn link_open(app: AppHandle, db: State<'_, Db>, widget_id: String) -> AppResult<()> {
    let url = open_url_target_for(db.pool(), &widget_id).await?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Internal(format!("could not open the link: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::store::WidgetRow;

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    /// Put a row on a real scene the way an import does: raw `kind` and raw
    /// config bytes, with no clamp anywhere on the path.
    async fn seed(pool: &SqlitePool, kind: &str, config: &str) -> String {
        let class = store::insert_class(pool, "7B").await.unwrap();
        let scene = store::default_scene_id(&class.id);
        store::replace_widgets(
            pool,
            &scene,
            &[WidgetRow {
                id: "w1".to_string(),
                kind: kind.to_string(),
                x: 0.2,
                y: 0.2,
                w: 0.4,
                h: 0.3,
                z: 0,
                config: config.to_string(),
            }],
        )
        .await
        .unwrap();
        "w1".to_string()
    }

    #[tokio::test]
    async fn a_stored_https_url_is_what_gets_opened() {
        let (pool, _d) = temp_pool().await;
        let id = seed(
            &pool,
            "link",
            r#"{"kind":"link","title":"Oppgaver","url":"https://www.udir.no/side?q=1","showQr":true}"#,
        )
        .await;
        assert_eq!(
            open_url_target_for(&pool, &id).await.unwrap(),
            "https://www.udir.no/side?q=1",
            "byte for byte — the gate validates, it does not rewrite"
        );
    }

    /// The whole reason this gate re-runs the rule. Transfer import writes
    /// config bytes RAW, so a hostile «flytt oppsettet»-file can put this
    /// exact row in the database without the clamp ever seeing it. The row
    /// renders as an empty link on the board; here it must refuse to open.
    #[tokio::test]
    async fn a_javascript_uri_in_the_database_never_reaches_the_browser() {
        for hostile in [
            r#"{"kind":"link","url":"javascript:alert(1)"}"#,
            r#"{"kind":"link","url":"JaVaScRiPt:alert(1)"}"#,
            r#"{"kind":"link","url":"file:///etc/passwd"}"#,
            r#"{"kind":"link","url":"data:text/html,<script>x</script>"}"#,
            r#"{"kind":"link","url":"http://udir.no\n.evil.example"}"#,
        ] {
            let (pool, _d) = temp_pool().await;
            let id = seed(&pool, "link", hostile).await;
            let err = open_url_target_for(&pool, &id).await.unwrap_err();
            assert_eq!(err.code(), "validation", "refusing {hostile}");
        }
    }

    #[tokio::test]
    async fn an_empty_or_missing_url_says_the_link_is_not_set() {
        for cfg in [
            r#"{"kind":"link","url":""}"#,
            r#"{"kind":"link","title":"Oppgaver"}"#,
            r#"{"kind":"link","url":123}"#,
            "{ not json at all ]]]",
        ] {
            let (pool, _d) = temp_pool().await;
            let id = seed(&pool, "link", cfg).await;
            let err = open_url_target_for(&pool, &id).await.unwrap_err();
            assert_eq!(err.code(), "validation", "refusing {cfg}");
        }
    }

    /// A config that CLAIMS to be a link on a row that is not one. The kind
    /// column decides, so this opens nothing.
    #[tokio::test]
    async fn a_widget_of_another_kind_cannot_be_opened() {
        let (pool, _d) = temp_pool().await;
        let id = seed(
            &pool,
            "text",
            r#"{"kind":"link","url":"https://evil.example"}"#,
        )
        .await;
        let err = open_url_target_for(&pool, &id).await.unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[tokio::test]
    async fn an_unknown_widget_id_is_not_found() {
        let (pool, _d) = temp_pool().await;
        let err = open_url_target_for(&pool, "ghost").await.unwrap_err();
        assert_eq!(err.code(), "not_found");
    }
}
