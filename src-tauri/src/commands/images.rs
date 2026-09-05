//! The picture widget's two commands: pick one, and read one back.
//!
//! ## The contract, in two sentences
//!
//! **The webview never names a path, and never receives one.** `image_pick`
//! opens the native dialog in RUST (the «flytt oppsettet» precedent, word
//! for word), copies the chosen file into the app's own picture directory
//! under a fresh UUID, and answers with that id. `image_load` takes an id,
//! runs it through the ONE id rule (`layout::sanitized_image_id`) BEFORE any
//! path is built, and answers with bytes. Neither is a general-purpose file
//! bridge, and SECURITY.md's promise — "no filesystem access from the
//! webview" — survives intact: `capabilities/default.json` is untouched, so
//! `plugin:dialog|open` and friends stay ACL-denied to the page.
//!
//! ## What is deliberately NOT here
//!
//! There is **no `image_delete`**. «Fjern bilde» in the UI writes
//! `imageId: ""` and nothing else; the file is collected by the boot sweep in
//! `db/images.rs`, which is the only place that can safely decide a picture is
//! an orphan (that module's header has the three reasons). Fewer commands is
//! also a smaller reachable surface — and a delete command taking an id from
//! the page is exactly the shape this file exists to avoid.

use base64::Engine as _;
use sundayscreen_core::layout::{sanitized_image_id, IMAGE_FILE_MAX_BYTES};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::images;
use crate::db::store::new_id;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// The file-type filter the pick dialog offers. Format names are proper nouns
/// — like «SundayScreen» in `commands/transfer.rs`, they need no catalogue,
/// which is what keeps the backend from owning a sentence a teacher reads.
const FILTER_NAME: &str = "PNG · JPEG · WebP";
/// What the dialog will SHOW. `jpeg` is here as well as `jpg` because both
/// are ordinary on disk; the extension decides nothing afterwards — the bytes
/// do (`images::sniff`).
const FILTER_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// One picture, on its way to the webview.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "StoredImage.ts")]
#[serde(rename_all = "camelCase")]
pub struct StoredImage {
    /// `image/png`, `image/jpeg` or `image/webp` — read off the stored bytes,
    /// never off the file name. The page needs it to build a `Blob` the
    /// browser will render.
    pub mime: String,
    /// The picture, base64. Big — a 10 MiB photograph crosses as ~13 MiB of
    /// JSON — and that is accepted deliberately: it happens ONCE per picture
    /// per boot, because `app/widgets/image/blob-cache.ts` holds the object
    /// URL for as long as a card is showing it.
    pub bytes_base64: String,
}

/// The app's picture directory, created if it is not there.
fn dir_for(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("no app data directory: {e}")))?;
    let dir = images::images_dir(&base);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Pick a picture and copy it into the app's own directory. Answers with the
/// stored id, or `None` when the teacher closed the dialog.
///
/// A closed dialog is NOT a failure — the transfer commands' rule, and the
/// same one: nothing was chosen, so there is nothing to report.
///
/// The size is checked from the file's METADATA, before a byte is read: the
/// dialog's filter is a suggestion, and a mistaken pick can be a gigabyte of
/// video wearing `.png`. Over the ceiling it REJECTS and the message names
/// the limit — never a silent downscale. Re-encoding a teacher's picture
/// behind her back would be the fabricated success this house forbids, one
/// layer down: what she would then have on the board is not the file she
/// chose.
///
/// `db` is taken and not used, and that is the point. On a degraded boot the
/// `Db` state is not managed, so Tauri REJECTS this call before the dialog
/// opens — a picture copied onto disk with no database to store its id in is
/// a file nothing will ever point at, and a card that stays empty after a
/// successful-looking pick.
#[tauri::command]
pub async fn image_pick(
    app: AppHandle,
    _db: State<'_, Db>,
    dialog_title: String,
) -> AppResult<Option<String>> {
    let dir = dir_for(&app)?;

    // `blocking_pick_file` on the async runtime — the documented pattern, and
    // NOT on the main thread, where it would deadlock the event loop that has
    // to draw the dialog (see `commands/transfer.rs`).
    let Some(picked) = app
        .dialog()
        .file()
        .set_title(dialog_title)
        .add_filter(FILTER_NAME, &FILTER_EXTENSIONS)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| AppError::Internal(format!("the chosen file has no usable path: {e}")))?;

    let size = std::fs::metadata(&path)?.len();
    if size > IMAGE_FILE_MAX_BYTES {
        tracing::warn!(file = %path.display(), size, "picture refused — over the size ceiling");
        return Err(AppError::Validation(format!(
            "the picture is {size} bytes; the limit is {IMAGE_FILE_MAX_BYTES}"
        )));
    }

    let bytes = std::fs::read(&path)?;
    let id = new_id();
    let Some(stored) = images::write_stored(&dir, &id, &bytes)? else {
        tracing::warn!(file = %path.display(), "picture refused — the bytes are not a PNG, JPEG or WebP");
        return Err(AppError::Validation(
            "the file is not a PNG, JPEG or WebP picture".into(),
        ));
    };
    tracing::info!(file = %stored.display(), "picture stored");
    Ok(Some(id))
}

/// Read a stored picture back. `None` is the HONEST "there is no such
/// picture here" — never an error.
///
/// That state is ordinary rather than exceptional, which is why it is an
/// answer and not a rejection: a setup imported from a machine whose pictures
/// did not all fit in the file lands with configs pointing at ids this
/// machine has no bytes for, and the card says «bildet mangler» rather than
/// lighting the error ring for something the teacher can simply fix.
///
/// The id is validated BEFORE a path is built — `sanitized_image_id` is the
/// same rule the clamp runs, and it is not redundant here: transfer import
/// writes widget configs RAW, so between an import and the first save the
/// database holds bytes the clamp has never seen.
#[tauri::command]
pub async fn image_load(app: AppHandle, image_id: String) -> AppResult<Option<StoredImage>> {
    let Some(id) = sanitized_image_id(&image_id) else {
        // Not an error: an empty id is the ordinary "no picture yet" state,
        // and a malformed one is a broken row that reads the same on the
        // board. Neither is worth a rejection the teacher cannot act on.
        return Ok(None);
    };
    let dir = dir_for(&app)?;
    let Some(path) = images::find_stored(&dir, &id) else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path)?;
    // Sniffed on the way OUT as well as on the way in. The directory is on a
    // disk a teacher (or anything else on the machine) can write to, and the
    // `mime` handed to the page decides how the page will treat the bytes.
    let Some(format) = images::sniff(&bytes) else {
        tracing::warn!(file = %path.display(), "a stored picture is not a picture any more");
        return Ok(None);
    };
    Ok(Some(StoredImage {
        mime: format.mime.to_string(),
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    }))
}

#[cfg(test)]
mod tests {
    use sundayscreen_core::layout::sanitized_image_id;

    /// The gate `image_load` runs before it builds a path. The rule itself is
    /// table-tested in `layout.rs`; what this pins is that the COMMAND's
    /// entry point is that rule and not a hand-rolled cousin — the shape of
    /// bug that has bitten this house before is two spellings of one rule.
    #[test]
    fn the_command_refuses_every_id_that_is_not_ours() {
        for hostile in [
            "../../../etc/passwd",
            "..",
            "a/b.png",
            "a\\b",
            "",
            "0192F0A4-7B1E-7C3D-9F52-6A1B2C3D4E5F",
        ] {
            assert!(
                sanitized_image_id(hostile).is_none(),
                "refusing {hostile:?}"
            );
        }
        let ok = "0192f0a4-7b1e-7c3d-9f52-6a1b2c3d4e5f";
        assert_eq!(sanitized_image_id(ok).as_deref(), Some(ok));
    }
}
