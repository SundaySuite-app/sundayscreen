//! The picture store — files under `app_data_dir/images/`, and the boot sweep
//! that collects the ones nothing points at any more.
//!
//! ## Why the bytes are a FILE and the config is an id
//!
//! `layout_save` is replace-all PER SCENE and runs on every drag of every
//! widget; `duplicate` `structuredClone`s a config; `backup_rotating` keeps
//! three generations. A data-URI in the config would ride all three, and burst
//! `transfer::WIDGET_CONFIG_MAX_CHARS` on the first photograph. So the config
//! carries a UUID and the picture lives beside the database.
//!
//! ## Why the GC is a BOOT SWEEP and not a delete command
//!
//! Three roads make "delete when the widget goes" wrong, and all three are
//! real in this app:
//!
//! - `scene_duplicate` copies configs RAW, so the same `imageId` can live on
//!   several screens. A per-scene diff on save would delete a file another
//!   screen still points at.
//! - `removeWidget` has a 15 s in-memory undo (`state/layout.ts`). Deleting
//!   the file with the widget would make «angre» restore an empty card.
//! - the file may be referenced by a config for a widget kind THIS build
//!   cannot render (promise 3), which no per-kind rule would ever see.
//!
//! So: at boot, once, after the pool is open and the backup is taken, every
//! stored config is read and every `"imageId"` string in it — at any depth, in
//! ANY kind — counts as a reference. Files whose stem is not referenced are
//! removed. It is never fatal and it never runs on a degraded boot: with no
//! pool there is no proof that anything is an orphan, and "we could not read
//! the references" must never become "so we deleted the pictures".
//!
//! The honest cost, written into PRIVACY.md: a picture the teacher removes
//! from a screen stays on disk until the next app start.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use crate::error::AppResult;

/// The sub-directory of the app-data dir where pictures live.
const IMAGE_DIR_NAME: &str = "images";

/// The config key that names a stored picture. Spelled ONCE here and
/// documented as a convention on `WidgetConfig::Image` — the sweep reads it
/// out of every kind, including kinds from the future.
const IMAGE_ID_KEY: &str = "imageId";

/// `<app data>/images`. Pure — the caller decides whether to create it.
pub fn images_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(IMAGE_DIR_NAME)
}

/// One picture format this app will store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageFormat {
    /// The file extension we write, and one of the three [`find_stored`]
    /// looks for.
    pub ext: &'static str,
    /// The media type handed to the webview so a `Blob` renders.
    pub mime: &'static str,
}

const PNG: ImageFormat = ImageFormat {
    ext: "png",
    mime: "image/png",
};
const JPEG: ImageFormat = ImageFormat {
    ext: "jpg",
    mime: "image/jpeg",
};
const WEBP: ImageFormat = ImageFormat {
    ext: "webp",
    mime: "image/webp",
};

/// Every extension a stored picture can wear — the list [`find_stored`] walks.
const STORED_EXTENSIONS: [&str; 3] = ["png", "jpg", "webp"];

/// What these bytes ACTUALLY are, by their magic numbers — or `None`.
///
/// The file dialog's extension filter is a suggestion and the transfer file's
/// `mime` is a claim; neither is evidence. This is the evidence, and it runs
/// on both roads into the store (a teacher's pick, and an imported setup):
/// what gets written under a `.png` name is a PNG because the first eight
/// bytes said so.
pub fn sniff(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(PNG);
    }
    // The JPEG SOI marker plus the first byte of the next one. Every JFIF and
    // Exif file starts this way.
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some(JPEG);
    }
    // RIFF container, four bytes of length, then the form type. The length is
    // deliberately NOT checked — a truncated WebP is still a WebP, and this
    // function answers "what is it", not "is it whole".
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(WEBP);
    }
    None
}

/// Where a stored picture with this id lives, if it is there at all.
///
/// The id must ALREADY have passed `layout::sanitized_image_id` — this
/// function joins it onto a path, and there is exactly one gate for that.
pub fn find_stored(dir: &Path, id: &str) -> Option<PathBuf> {
    STORED_EXTENSIONS.iter().find_map(|ext| {
        let path = dir.join(format!("{id}.{ext}"));
        path.is_file().then_some(path)
    })
}

/// Write `bytes` as the picture `id`, choosing the extension from what the
/// bytes REALLY are. `None` when they are not a picture this app stores.
///
/// The id is the caller's responsibility to have sanitised; the byte ceiling
/// is too (the pick checks the file's metadata before reading, so it never
/// has 10 MiB in memory to refuse).
pub fn write_stored(dir: &Path, id: &str, bytes: &[u8]) -> AppResult<Option<PathBuf>> {
    let Some(format) = sniff(bytes) else {
        return Ok(None);
    };
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{}.{}", id, format.ext));
    std::fs::write(&path, bytes)?;
    Ok(Some(path))
}

/// Add every `"imageId"` string in one stored config to `out`, at any depth
/// and in any kind.
///
/// Depth and kind-blindness are both deliberate. A widget kind a NEWER
/// SundayScreen wrote is retained in the database and skipped by the API
/// (promise 3) — if the sweep only looked at `kind = 'image'`, a downgrade
/// would boot once and delete the newer version's pictures out from under it.
/// Erring towards KEEPING a file is the cheap direction: an orphan costs a few
/// hundred kilobytes, a wrong delete costs a photograph.
///
/// A config that is not JSON contributes nothing and is not an error: it is
/// already a broken row (`row_to_instance` answers `default_for(kind)` for
/// it), and the sweep is not the place to discover that.
pub fn collect_referenced(config: &str, out: &mut HashSet<String>) {
    fn walk(value: &serde_json::Value, out: &mut HashSet<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, v) in map {
                    if key == IMAGE_ID_KEY {
                        if let Some(id) = v.as_str() {
                            if !id.is_empty() {
                                out.insert(id.to_string());
                            }
                        }
                    }
                    walk(v, out);
                }
            }
            serde_json::Value::Array(items) => {
                for v in items {
                    walk(v, out);
                }
            }
            _ => {}
        }
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(config) {
        walk(&value, out);
    }
}

/// Every picture id any stored widget points at.
pub async fn referenced_ids(pool: &SqlitePool) -> AppResult<HashSet<String>> {
    let configs: Vec<String> = sqlx::query_scalar("SELECT config FROM widget_instance")
        .fetch_all(pool)
        .await?;
    let mut out = HashSet::new();
    for config in &configs {
        collect_referenced(config, &mut out);
    }
    Ok(out)
}

/// Delete the files in `dir` whose stem nothing references. Answers with how
/// many went.
///
/// A file the sweep cannot delete is logged and skipped — one locked file must
/// not stop the rest, and none of this is worth a failed boot.
pub fn sweep_dir(dir: &Path, referenced: &HashSet<String>) -> std::io::Result<usize> {
    if !dir.is_dir() {
        return Ok(0);
    }
    let mut removed = 0usize;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // The STEM is the id: `<uuid>.<ext>`. A file with no stem, or one
        // whose stem is referenced, is left exactly where it is.
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if referenced.contains(stem) {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(e) => {
                tracing::warn!(file = %path.display(), "could not remove an orphaned picture: {e}")
            }
        }
    }
    Ok(removed)
}

/// The boot sweep: read the references, then remove what is not among them.
///
/// Called from `lib.rs` AFTER the pool is open and the backup is taken, and
/// never on a degraded boot — the call site is inside the branch that has a
/// pool, because "we could not read the references" must never become "so we
/// deleted the pictures".
pub async fn sweep_orphans(pool: &SqlitePool, dir: &Path) -> AppResult<usize> {
    let referenced = referenced_ids(pool).await?;
    Ok(sweep_dir(dir, &referenced)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The smallest byte strings that sniff as each format — enough for the
    /// magic-number test, which is all the store ever asks.
    const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR";
    const JPEG_BYTES: &[u8] = b"\xff\xd8\xff\xe0\x00\x10JFIF";
    const WEBP_BYTES: &[u8] = b"RIFF\x24\x00\x00\x00WEBPVP8 ";

    #[test]
    fn the_three_formats_are_recognised_by_their_bytes() {
        assert_eq!(sniff(PNG_BYTES).unwrap().ext, "png");
        assert_eq!(sniff(JPEG_BYTES).unwrap().mime, "image/jpeg");
        assert_eq!(sniff(WEBP_BYTES).unwrap().ext, "webp");
    }

    #[test]
    fn anything_that_is_not_a_picture_is_refused() {
        for bytes in [
            &b"%PDF-1.7"[..],
            b"GIF89a",
            b"<svg xmlns=",
            b"MZ\x90\x00",
            b"RIFF\x24\x00\x00\x00WAVEfmt ", // a sound file in the same container
            b"",
            b"\x89PNG", // the marker, cut short
        ] {
            assert!(sniff(bytes).is_none(), "{bytes:?} is not a picture");
        }
    }

    #[test]
    fn a_picture_is_written_under_the_extension_its_bytes_earn() {
        let dir = tempfile::tempdir().unwrap();
        // A JPEG handed over under an id says nothing about its format; the
        // BYTES do, and they are what names the file.
        let path = write_stored(dir.path(), "abc", JPEG_BYTES)
            .unwrap()
            .expect("a JPEG is stored");
        assert_eq!(path.file_name().unwrap(), "abc.jpg");
        assert_eq!(find_stored(dir.path(), "abc").unwrap(), path);
        assert!(find_stored(dir.path(), "def").is_none());

        assert!(
            write_stored(dir.path(), "evil", b"<script>alert(1)</script>")
                .unwrap()
                .is_none(),
            "a non-picture is never written"
        );
        assert!(!dir.path().join("evil.png").exists());
    }

    #[test]
    fn a_reference_is_any_image_id_string_in_any_kind_at_any_depth() {
        let mut out = HashSet::new();
        collect_referenced(r#"{"kind":"image","imageId":"a1","fit":"cover"}"#, &mut out);
        // A kind this build has never heard of — promise 3 says its row
        // survives, and its picture has to survive with it.
        collect_referenced(r#"{"kind":"collage","imageId":"b2"}"#, &mut out);
        // …and one that nests them, because a future kind might.
        collect_referenced(
            r#"{"kind":"collage","slots":[{"imageId":"c3"},{"imageId":"d4"}]}"#,
            &mut out,
        );
        // The empty string is «no picture», not a reference to one.
        collect_referenced(r#"{"kind":"image","imageId":""}"#, &mut out);
        // Neither a non-string nor a config that is not JSON at all
        // contributes anything, and neither is an error.
        collect_referenced(r#"{"kind":"image","imageId":42}"#, &mut out);
        collect_referenced("{ not json ]]]", &mut out);

        let mut ids: Vec<&str> = out.iter().map(|s| s.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, ["a1", "b2", "c3", "d4"]);
    }

    #[test]
    fn the_sweep_keeps_what_is_referenced_and_removes_what_is_not() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["keep-1", "keep-2", "orphan"] {
            write_stored(dir.path(), id, PNG_BYTES).unwrap().unwrap();
        }
        // Something that is not one of ours, with no extension at all: it has
        // a stem, it is not referenced, and it goes — the directory is the
        // app's, and a stray file in it is an orphan by definition.
        std::fs::write(dir.path().join("notes.txt"), b"hei").unwrap();

        let referenced: HashSet<String> =
            ["keep-1", "keep-2"].iter().map(|s| s.to_string()).collect();
        assert_eq!(sweep_dir(dir.path(), &referenced).unwrap(), 2);
        assert!(find_stored(dir.path(), "keep-1").is_some());
        assert!(find_stored(dir.path(), "keep-2").is_some());
        assert!(find_stored(dir.path(), "orphan").is_none());
        assert!(!dir.path().join("notes.txt").exists());

        // Idempotent: a second pass has nothing left to do.
        assert_eq!(sweep_dir(dir.path(), &referenced).unwrap(), 0);
    }

    #[test]
    fn a_missing_directory_is_not_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let never = dir.path().join("images");
        assert_eq!(sweep_dir(&never, &HashSet::new()).unwrap(), 0);
    }

    #[tokio::test]
    async fn the_boot_sweep_reads_the_real_rows_and_spares_an_unknown_kinds_picture() {
        use crate::db::store::{self, WidgetRow};

        let dir = tempfile::tempdir().unwrap();
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .unwrap();
        let images = images_dir(dir.path());
        for id in ["on-a-board", "on-a-future-board", "nobodys"] {
            write_stored(&images, id, PNG_BYTES).unwrap().unwrap();
        }

        let class = store::insert_class(&pool, "7B").await.unwrap();
        store::replace_widgets(
            &pool,
            &store::default_scene_id(&class.id),
            &[
                WidgetRow {
                    id: "w1".into(),
                    kind: "image".into(),
                    x: 0.1,
                    y: 0.1,
                    w: 0.3,
                    h: 0.2,
                    z: 0,
                    config: r#"{"kind":"image","imageId":"on-a-board"}"#.into(),
                },
                // The row that makes this test worth writing: a kind this
                // build cannot render, holding a picture it must not delete.
                WidgetRow {
                    id: "w2".into(),
                    kind: "collage".into(),
                    x: 0.1,
                    y: 0.4,
                    w: 0.3,
                    h: 0.2,
                    z: 1,
                    config: r#"{"kind":"collage","imageId":"on-a-future-board"}"#.into(),
                },
            ],
        )
        .await
        .unwrap();

        assert_eq!(sweep_orphans(&pool, &images).await.unwrap(), 1);
        assert!(find_stored(&images, "on-a-board").is_some());
        assert!(
            find_stored(&images, "on-a-future-board").is_some(),
            "a downgrade must not eat a newer version's picture"
        );
        assert!(find_stored(&images, "nobodys").is_none());
    }
}
