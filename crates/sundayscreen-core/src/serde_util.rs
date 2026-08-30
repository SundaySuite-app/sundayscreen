//! Serde helpers shared by the crate's PERSISTED models.
//!
//! One rule lives here, spelled once: **a value we cannot read costs its own
//! field, never the blob around it.** Serde's default posture is the
//! opposite — one malformed value fails the whole `Deserialize`, and every
//! caller in this app answers that failure with a wholesale fallback
//! (`Settings::default()`, `WidgetConfig::default_for(kind)`). That turns a
//! single unreadable byte into an erased class list or an erased screen.
//!
//! The specialised variants that encode a NON-`Default` fallback (the
//! language's `Some("no")`, the update channel's `Stable`) stay next to the
//! defaults they encode, in `settings.rs`.

use serde::Deserialize;

/// Lenient per-field deserializer: tolerate a malformed VALUE by taking the
/// field's [`Default`] instead of failing the whole blob.
///
/// Pair it with `#[serde(default, ...)]` — the two attributes cover DIFFERENT
/// paths and both are needed:
///
///   - key ABSENT → serde never calls this function; `default` supplies the
///     value,
///   - key PRESENT but unreadable → serde calls this function, which buffers
///     the value as a [`serde_json::Value`] and falls back to `T::default()`.
///
/// Both roads therefore end at the same place, which is the point: an unknown
/// enum spelling must be indistinguishable from an absent field, not a
/// catastrophe.
pub(crate) fn lenient<'de, D, T>(de: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let raw = serde_json::Value::deserialize(de)?;
    Ok(serde_json::from_value(raw).unwrap_or_default())
}
