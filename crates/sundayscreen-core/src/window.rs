//! Window-restore decisions — the monitor-sanity clamp.
//!
//! A saved geometry may reference a monitor that is gone (the projector was
//! unplugged, the rig changed). Restoring it verbatim would open the app
//! OFF-SCREEN — invisible and, to a teacher, "broken". The rule: restore
//! only when the window's centre lands on SOME connected monitor; otherwise
//! fall back to the config default.

use crate::settings::WindowState;

/// One monitor's logical-pixel rectangle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl MonitorRect {
    fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }
}

/// Whether the saved state may be restored on this rig. With NO monitor
/// information (the platform would not say) the state is trusted — refusing
/// to restore because we could not check would punish the common case.
pub fn restorable(state: &WindowState, monitors: &[MonitorRect]) -> bool {
    if monitors.is_empty() {
        return true;
    }
    let cx = state.x + state.w / 2.0;
    let cy = state.y + state.h / 2.0;
    monitors.iter().any(|m| m.contains(cx, cy))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(x: f64, y: f64) -> WindowState {
        WindowState {
            x,
            y,
            w: 1280.0,
            h: 800.0,
            fullscreen: false,
        }
    }

    const PRIMARY: MonitorRect = MonitorRect {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1080.0,
    };
    const PROJECTOR: MonitorRect = MonitorRect {
        x: 1920.0,
        y: 0.0,
        w: 1024.0,
        h: 768.0,
    };

    #[test]
    fn a_state_on_a_connected_monitor_is_restorable() {
        assert!(restorable(&state(100.0, 100.0), &[PRIMARY]));
        assert!(restorable(&state(2000.0, -300.0), &[PRIMARY, PROJECTOR]));
    }

    #[test]
    fn a_state_on_a_gone_monitor_is_not() {
        // Saved while on the projector; today only the laptop is connected.
        assert!(!restorable(&state(2000.0, 100.0), &[PRIMARY]));
    }

    #[test]
    fn the_centre_decides_not_the_corner() {
        // Mostly off-screen to the left, but the centre is still on: fine —
        // the teacher can grab it.
        assert!(restorable(&state(-600.0, 100.0), &[PRIMARY]));
        // Centre off the left edge: not restorable.
        assert!(!restorable(&state(-700.0, 100.0), &[PRIMARY]));
    }

    #[test]
    fn no_monitor_information_trusts_the_state() {
        assert!(restorable(&state(99_999.0, 99_999.0), &[]));
    }
}
