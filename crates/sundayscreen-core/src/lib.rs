//! The pure, GUI-free domain core for SundayScreen.
//!
//! Everything here is deterministic and unit-tested headlessly: no webview, no
//! display, no clock reads, no filesystem. The `src-tauri` crate is the thin
//! I/O shell over these decisions.

pub mod groups;
pub mod layout;
pub mod members;
pub mod picker;
pub mod schedule;
pub(crate) mod serde_util;
pub mod settings;
pub mod theme;
pub mod timer;
pub mod transfer;
pub mod update;
pub mod window;
