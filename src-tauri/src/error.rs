//! Centralised error type for the SundayScreen backend.
//!
//! Tauri commands return `Result<T, AppError>` — `AppError` implements
//! `serde::Serialize` so it crosses the IPC boundary as a stable JSON shape
//! (`{ code, message }`) the frontend can pattern-match on.

use serde::{Serialize, Serializer};
use thiserror::Error;

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
