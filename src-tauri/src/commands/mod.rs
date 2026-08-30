//! The Tauri command surface, one module per domain.

use crate::error::{AppError, AppResult};

/// The date-key gate every command that takes a frontend-minted
/// `YYYY-MM-DD` runs — the planner's writes AND the picker's "who is here
/// today". The rule itself is pure and lives in the core
/// ([`sundayscreen_core::schedule::is_valid_date`]); this is only the
/// translation into an `AppError`, kept in ONE place so the two domains
/// cannot drift apart.
///
/// ADR-009: JS owns the wall clock, Rust validates the shape.
pub(crate) fn valid_date(date: &str) -> AppResult<()> {
    if !sundayscreen_core::schedule::is_valid_date(date) {
        return Err(AppError::Validation(
            "date must be a real YYYY-MM-DD day".into(),
        ));
    }
    Ok(())
}

pub mod app;
pub mod classes;
pub mod layout;
pub mod picker;
pub mod planner;
pub mod scenes;
pub mod settings;
pub mod transfer;
