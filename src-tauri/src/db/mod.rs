//! Database state: the one pool, shared as managed Tauri state.

pub mod import;
pub mod planner;
pub mod store;

use sqlx::SqlitePool;

/// Managed wrapper around the app's SQLite pool.
pub struct Db {
    pool: SqlitePool,
}

impl Db {
    pub fn new(pool: SqlitePool) -> Self {
        Db { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
