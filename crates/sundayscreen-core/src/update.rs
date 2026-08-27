//! Update-feed decisions — the URL the updater polls, per channel.
//!
//! The feed lives on `updates.sundaysuite.app` (NOT the telemetry host, and
//! that separation is deliberate suite-wide: the update check is made by
//! installs whose owner declined telemetry, so it must not even LOOK like it
//! reports to a telemetry endpoint). The channel is per-machine state, which
//! is why the runtime overrides tauri.conf.json's single static endpoint.

use crate::settings::UpdateChannel;

/// The app's feed root on the suite's update Worker.
pub const UPDATE_BASE: &str = "https://updates.sundaysuite.app/v1/update/sundayscreen";

/// The full feed URL for a channel.
pub fn channel_feed_url(channel: UpdateChannel) -> String {
    format!("{UPDATE_BASE}/{}", channel.as_tag())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tag_is_the_path_segment() {
        assert_eq!(
            channel_feed_url(UpdateChannel::Stable),
            "https://updates.sundaysuite.app/v1/update/sundayscreen/stable"
        );
        assert_eq!(
            channel_feed_url(UpdateChannel::Beta),
            "https://updates.sundaysuite.app/v1/update/sundayscreen/beta"
        );
    }

    #[test]
    fn the_feed_is_not_on_the_telemetry_host() {
        assert!(!UPDATE_BASE.contains("telemetry"));
    }
}
