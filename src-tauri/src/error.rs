//! Centralised error type for the SundayScreen backend.
//!
//! Tauri commands return `Result<T, AppError>` — `AppError` implements
//! `serde::Serialize` so it crosses the IPC boundary as a stable JSON shape
//! (`{ code, message }`) the frontend can pattern-match on.

use std::path::Path;

use serde::{Serialize, Serializer};
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Error)]
pub enum AppError {
    /// Entity not found by ID — distinct so the frontend can say which thing
    /// is gone (a deleted class, a stale widget id).
    #[error("not found: {entity} id={id}")]
    NotFound { entity: &'static str, id: String },

    /// Caller passed input that fails our domain rules.
    #[error("validation: {0}")]
    Validation(String),

    /// File-system / IO failure.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialisation/deserialisation issue.
    #[error("invalid json: {0}")]
    Json(#[from] serde_json::Error),

    /// SQLite/sqlx query or connection failure.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    /// Schema-migration failure on startup.
    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    /// Anything else we couldn't classify.
    #[error("internal: {0}")]
    Internal(String),
}

impl AppError {
    /// Short, machine-readable category for the frontend to switch on.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound { .. } => "not_found",
            AppError::Validation(_) => "validation",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
            AppError::Database(_) => "database",
            AppError::Migration(_) => "migration",
            AppError::Internal(_) => "internal",
        }
    }
}

/// Custom serializer so the JSON sent to the frontend carries both a stable
/// `code` (for switch statements) and a human-readable `message`.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// Convenience alias for the project.
pub type AppResult<T> = Result<T, AppError>;

// ── Boot: is this file actually broken, or is the app just too old? ──────────

/// SQLite primary result code for a database whose pages are damaged.
const SQLITE_CORRUPT: i32 = 11;
/// SQLite primary result code for a file that is not a database at all.
const SQLITE_NOTADB: i32 = 26;

/// Does this open-the-database failure prove the FILE is broken?
///
/// Only then may the boot path move the database aside and start fresh
/// (`lib.rs`). The default is NO, and that is the whole point: until R4 the
/// boot path treated *every* failure as corruption, so installing an older
/// build over a newer one — which makes sqlx answer
/// `MigrateError::VersionMissing(5)` — renamed the teacher's classes, pupil
/// names, week plan and screens to `.corrupt-<epoch>` and booted empty.
/// Product promise 3 ("a downgrade never deletes a newer version's data")
/// lives or dies on this function.
///
/// Quarantine ONLY when SQLite itself answers `SQLITE_CORRUPT` (11) or
/// `SQLITE_NOTADB` (26) — the two codes that positively prove the bytes on
/// disk are not a usable database. They reach us through two doors:
/// - `Database`: the connection or a query said so, and
/// - `Migration(Execute(..))`: *"while executing migrations"*, which is sqlx's
///   own bookkeeping (creating and reading `_sqlx_migrations`). Measured, not
///   assumed: `SqlitePool::connect_with` on a file of plain text SUCCEEDS —
///   SQLite reads no header until the first statement — so a genuinely
///   foreign file only announces itself here. Without this door the F9-funn
///   B#9 rescue would be dead code.
///
/// Deliberately NOT quarantined:
/// - `VersionMissing` / `VersionMismatch` / `VersionTooNew` and friends: a
///   version disagreement, never damage.
/// - `ExecuteMigration(err, n)` — *"while executing migration n"* — even with
///   a corrupt code. That is OUR migration SQL failing; the fix is a new
///   build, and no bug of ours may cost a teacher her class lists.
/// - `SQLITE_BUSY`, `EACCES`, a full disk, `Io`, `Json`, `Validation`: all
///   about the environment, none about the file's contents.
///
/// The low byte of an extended result code is the primary code
/// (<https://www.sqlite.org/rescode.html>), so 267 (`SQLITE_CORRUPT_VTAB`),
/// 523 and 779 classify exactly like 11 — while 517 (`SQLITE_BUSY_SNAPSHOT`)
/// stays a plain busy.
pub fn should_quarantine(err: &AppError) -> bool {
    let sqlx_err = match err {
        AppError::Database(e) => e,
        AppError::Migration(sqlx::migrate::MigrateError::Execute(e)) => e,
        _ => return false,
    };
    let sqlx::Error::Database(db) = sqlx_err else {
        return false;
    };
    let Some(code) = db.code() else {
        return false;
    };
    let Ok(code) = code.parse::<i32>() else {
        return false;
    };
    let primary = code & 0xff;
    primary == SQLITE_CORRUPT || primary == SQLITE_NOTADB
}

// ── Boot: saying it out loud ────────────────────────────────────────────────

/// Which boot failure happened — the one axis the shell's chip switches on.
///
/// A UNIT enum on purpose. `BootFault` carries the path and the schema number
/// alongside it, so the frontend reads `fault.kind === "databaseTooNew"`
/// rather than digging through a nested tag (which is what an internally
/// tagged enum with a shared field would have cost).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "BootFaultKind.ts")]
#[serde(rename_all = "camelCase")]
pub enum BootFaultKind {
    /// The file names a schema version this build does not have — i.e. it was
    /// written by a NEWER SundayScreen. The proven downgrade case
    /// (`VersionMissing`), and the only one where "install the newer app
    /// again" is the actual remedy.
    DatabaseTooNew,
    /// The schema update itself stopped: a migration was modified since it ran
    /// (`VersionMismatch`), a statement failed (`ExecuteMigration`), or one is
    /// half-applied (`Dirty`). Our bug to fix, not the teacher's.
    SchemaUpdateStopped,
    /// Could not be opened at all — locked by another process, no permission,
    /// a full disk. Nothing about the file's contents.
    Unreadable,
    /// NOT an open failure: the bytes were PROVEN corrupt, moved aside, and
    /// the database now running is the empty one made in their place. The old
    /// bytes and the rotating backups are still on disk.
    StartedEmpty,
    /// The quarantine ran and then making a fresh database ALSO failed — so
    /// there is no database at all, and the file has been renamed.
    ///
    /// Its own kind rather than falling back to [`Self::Unreadable`] for one
    /// reason: every other sentence ends in "the file is untouched", and after
    /// a quarantine that is no longer true. A sentence that lies about the one
    /// thing this whole boot path exists to promise is worse than no sentence.
    RescueFailed,
}

/// What [`BootFault::db_path`] holds when there is no path to name.
///
/// One failure reaches the boot before any path exists: the OS could not say
/// where the app-data directory IS (`app_data_dir()`), so there is no file to
/// point at. EMPTY rather than a marker word, and the choice is deliberate: a
/// marker would be a SENTENCE the teacher reads, and sentences come from the
/// catalogue the app is running, never compiled into the backend — the same
/// rule `class_ensure_active(default_name)` and the transfer dialog titles
/// follow. An empty path makes the shell's line end at its colon; a
/// backend-authored "(unknown)" would end it in the wrong language.
pub const UNKNOWN_DB_PATH: &str = "";

/// What the boot has to tell the teacher, held in managed state and read once
/// by the shell (`boot_fault`).
///
/// It exists because the honest alternative was worse: returning `Err` from
/// `setup` stops the whole app, so the ONE thing that could explain the
/// problem — a window with a sentence in it — never appears. The shell boots
/// degraded instead (typed fallbacks where the shim has them, honest
/// rejections everywhere else) and puts this at the top of its chip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "BootFault.ts")]
#[serde(rename_all = "camelCase")]
pub struct BootFault {
    pub kind: BootFaultKind,
    /// Where the file is. The sentence ENDS in it: "the file is untouched:
    /// <path>" is what makes the promise checkable by the person reading it,
    /// and what she can hand to whoever helps her.
    pub db_path: String,
    /// The migration version sqlx named, when it named one.
    ///
    /// DIAGNOSTIC ONLY, and deliberately not in any sentence: this is a schema
    /// number (`0005_…sql` → 5), not an app version. "Install version 5 or
    /// newer" would be a fabricated instruction — there is no SundayScreen 5.
    /// The shell says "a newer SundayScreen" and leaves the number to the log.
    pub schema_version: Option<u32>,
}

impl BootFault {
    /// Classify a failed `open_pool`. Sibling to [`should_quarantine`], and
    /// for the same reason: the boot path's two decisions are the ones that
    /// have to be readable in a test rather than inferred from a `match` in
    /// `lib.rs` that nothing can call.
    pub fn from_open_error(err: &AppError, db_path: &Path) -> Self {
        use sqlx::migrate::MigrateError as M;

        // `MigrateError` is `#[non_exhaustive]`; the wildcard is required and
        // lands on `Unreadable`, which is the safe direction to be wrong in —
        // a vague "could not be opened" beside an untouched file, never a
        // confident claim about a version.
        let (kind, schema_version) = match err {
            AppError::Migration(M::VersionMissing(n) | M::VersionNotPresent(n)) => {
                (BootFaultKind::DatabaseTooNew, u32::try_from(*n).ok())
            }
            AppError::Migration(
                M::VersionMismatch(n) | M::Dirty(n) | M::ExecuteMigration(_, n),
            ) => (BootFaultKind::SchemaUpdateStopped, u32::try_from(*n).ok()),
            _ => (BootFaultKind::Unreadable, None),
        };
        BootFault {
            kind,
            db_path: db_path.display().to_string(),
            schema_version,
        }
    }

    /// The boot never got as far as an open: the app-data directory could not
    /// be resolved or could not be created (`db::store::resolve_db_path`).
    ///
    /// [`BootFaultKind::Unreadable`] is exactly right for it — nothing about
    /// the file's CONTENTS is claimed, and nothing was touched. Pass
    /// `Path::new(`[`UNKNOWN_DB_PATH`]`)` when there is no path to name.
    pub fn unreadable(db_path: &Path) -> Self {
        BootFault {
            kind: BootFaultKind::Unreadable,
            db_path: db_path.display().to_string(),
            schema_version: None,
        }
    }

    /// The quarantine happened and the app is running on a fresh, empty
    /// database. Not an error state — the app WORKS — but the teacher's
    /// classes are gone from it, and a warning in a terminal no classroom has
    /// open is not telling her.
    pub fn started_empty(db_path: &Path) -> Self {
        BootFault {
            kind: BootFaultKind::StartedEmpty,
            db_path: db_path.display().to_string(),
            schema_version: None,
        }
    }

    /// The quarantine moved the file and the replacement could not be made.
    /// Deliberately NOT `from_open_error` on that second failure: the sentence
    /// that classification produces ends in "the file is untouched", and by
    /// this point it has been renamed.
    pub fn rescue_failed(db_path: &Path) -> Self {
        BootFault {
            kind: BootFaultKind::RescueFailed,
            db_path: db_path.display().to_string(),
            schema_version: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::error::{DatabaseError, ErrorKind};
    use std::borrow::Cow;

    /// A `DatabaseError` with a chosen code. sqlx's own `SqliteError` cannot
    /// be built from outside its crate, and `SQLITE_BUSY` needs two processes
    /// fighting over one file to occur for real — so the busy and
    /// extended-code cases are synthesised here. The corrupt case is also
    /// proven for real: `store::tests::a_file_that_is_not_a_database_is_
    /// quarantined` gets code 26 out of an actual `open_pool`.
    #[derive(Debug)]
    struct CodedDbError(i32);

    impl std::fmt::Display for CodedDbError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "(code: {}) synthetic", self.0)
        }
    }
    impl std::error::Error for CodedDbError {}

    impl DatabaseError for CodedDbError {
        fn message(&self) -> &str {
            "synthetic"
        }
        fn code(&self) -> Option<Cow<'_, str>> {
            Some(self.0.to_string().into())
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> ErrorKind {
            ErrorKind::Other
        }
    }

    fn db_err(code: i32) -> AppError {
        AppError::Database(sqlx::Error::Database(Box::new(CodedDbError(code))))
    }

    #[test]
    fn a_downgrade_never_quarantines() {
        // The empirically proven case: v0.3 wrote migration 0005, an older
        // build resolves only 0001..0004, sqlx answers VersionMissing(5).
        assert!(!should_quarantine(&AppError::Migration(
            sqlx::migrate::MigrateError::VersionMissing(5)
        )));
    }

    #[test]
    fn an_edited_migration_never_quarantines() {
        assert!(!should_quarantine(&AppError::Migration(
            sqlx::migrate::MigrateError::VersionMismatch(3)
        )));
    }

    #[test]
    fn a_failing_migration_statement_never_quarantines() {
        assert!(!should_quarantine(&AppError::Migration(
            sqlx::migrate::MigrateError::ExecuteMigration(sqlx::Error::PoolClosed, 5)
        )));
        // Not even when the statement itself reports corruption: that is our
        // SQL to fix, and the file stays where it is.
        assert!(!should_quarantine(&AppError::Migration(
            sqlx::migrate::MigrateError::ExecuteMigration(
                sqlx::Error::Database(Box::new(CodedDbError(11))),
                5
            )
        )));
    }

    #[test]
    fn corruption_found_by_the_migrator_itself_is_quarantined() {
        // The real-file version of this is
        // `store::tests::a_file_that_is_not_a_database_is_quarantined`.
        assert!(should_quarantine(&AppError::Migration(
            sqlx::migrate::MigrateError::Execute(sqlx::Error::Database(Box::new(CodedDbError(26))))
        )));
        // …but a lock contention through the same door is still just busy.
        assert!(!should_quarantine(&AppError::Migration(
            sqlx::migrate::MigrateError::Execute(sqlx::Error::Database(Box::new(CodedDbError(5))))
        )));
    }

    #[test]
    fn a_locked_database_never_quarantines() {
        assert!(!should_quarantine(&db_err(5)), "SQLITE_BUSY");
        assert!(!should_quarantine(&db_err(517)), "SQLITE_BUSY_SNAPSHOT");
    }

    #[test]
    fn a_corrupt_database_is_quarantined() {
        assert!(should_quarantine(&db_err(11)), "SQLITE_CORRUPT");
        assert!(should_quarantine(&db_err(26)), "SQLITE_NOTADB");
        assert!(should_quarantine(&db_err(267)), "SQLITE_CORRUPT_VTAB");
    }

    // ── The other half of the boot decision: what do we SAY? ────────────────

    fn fault(err: AppError) -> BootFault {
        BootFault::from_open_error(&err, std::path::Path::new("/tmp/sundayscreen.sqlite"))
    }

    #[test]
    fn a_downgrade_says_the_database_is_newer() {
        let f = fault(AppError::Migration(
            sqlx::migrate::MigrateError::VersionMissing(5),
        ));
        assert_eq!(f.kind, BootFaultKind::DatabaseTooNew);
        // Kept for the log, never for the sentence: 5 is a schema version.
        assert_eq!(f.schema_version, Some(5));
        assert_eq!(f.db_path, "/tmp/sundayscreen.sqlite");
    }

    #[test]
    fn a_stopped_schema_update_is_its_own_answer() {
        // The remedy differs — "install the newer app again" would be a lie
        // here — so these may never collapse into the downgrade case.
        for err in [
            AppError::Migration(sqlx::migrate::MigrateError::VersionMismatch(3)),
            AppError::Migration(sqlx::migrate::MigrateError::Dirty(3)),
            AppError::Migration(sqlx::migrate::MigrateError::ExecuteMigration(
                sqlx::Error::PoolClosed,
                3,
            )),
        ] {
            let f = fault(err);
            assert_eq!(f.kind, BootFaultKind::SchemaUpdateStopped);
            assert_eq!(f.schema_version, Some(3));
        }
    }

    #[test]
    fn an_environment_failure_claims_nothing_about_versions() {
        for err in [
            db_err(5),
            AppError::Io(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "EACCES",
            )),
            AppError::Database(sqlx::Error::PoolTimedOut),
            AppError::Migration(sqlx::migrate::MigrateError::Execute(
                sqlx::Error::PoolClosed,
            )),
        ] {
            let f = fault(err);
            assert_eq!(f.kind, BootFaultKind::Unreadable);
            assert_eq!(f.schema_version, None);
        }
    }

    #[test]
    fn the_quarantine_case_reports_an_empty_start() {
        // The one fault that is not an open failure: everything works, and
        // the teacher's data is not in it.
        let f = BootFault::started_empty(std::path::Path::new("/tmp/sundayscreen.sqlite"));
        assert_eq!(f.kind, BootFaultKind::StartedEmpty);
        assert_eq!(f.schema_version, None);
    }

    #[test]
    fn a_failed_rescue_never_borrows_the_untouched_sentence() {
        // After a quarantine the file HAS been renamed. `from_open_error`
        // would have answered `Unreadable` here, whose sentence ends in "the
        // file is untouched" — the one claim that must never be made falsely.
        let path = std::path::Path::new("/tmp/sundayscreen.sqlite");
        assert_eq!(
            BootFault::rescue_failed(path).kind,
            BootFaultKind::RescueFailed
        );
        assert_eq!(
            BootFault::from_open_error(&db_err(11), path).kind,
            BootFaultKind::Unreadable,
            "the two must stay distinguishable — same failure, different file state"
        );
    }

    #[test]
    fn the_two_boot_decisions_stay_independent() {
        // A failure that must NOT be quarantined must still get a fault to
        // say so with — the pairing the R4 boot path is built on.
        let downgrade = AppError::Migration(sqlx::migrate::MigrateError::VersionMissing(5));
        assert!(!should_quarantine(&downgrade));
        assert_eq!(fault(downgrade).kind, BootFaultKind::DatabaseTooNew);
    }

    #[test]
    fn environment_failures_never_quarantine() {
        assert!(!should_quarantine(&AppError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "EACCES"
        ))));
        assert!(!should_quarantine(&AppError::Database(
            sqlx::Error::PoolTimedOut
        )));
        assert!(!should_quarantine(&AppError::Internal("nope".into())));
    }
}
