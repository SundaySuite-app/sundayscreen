//! Window-restore decisions — the monitor-sanity clamp.
//!
//! A saved geometry may reference a monitor that is gone (the projector was
//! unplugged, the rig changed). Restoring it verbatim would open the app
//! OFF-SCREEN — invisible and, to a teacher, "broken". The rule: restore
//! only when the window's centre lands on SOME connected monitor; otherwise
//! fall back to the config default.
//!
//! [`fit_to_monitor`] is the second half of the same story: a geometry that
//! lands on a connected monitor can still be BIGGER than it. The toolbar sits
//! at the bottom edge of the window and the reveal zone is the window's
//! bottom tenth — so a window hanging 100 px below the screen edge takes both
//! away, and there is no visible way back. Same holding as [`restorable`]
//! throughout: when we cannot tell, do nothing.

use crate::settings::{WindowState, MIN_WINDOW_H, MIN_WINDOW_W};

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

/// Shrink and nudge a saved geometry so the whole window lands inside its
/// monitor's WORK AREA (the desktop minus taskbar/Dock).
///
/// `work_areas` are work areas, NOT full monitor rects — a window sized to
/// the full monitor still has its bottom edge under the Dock. `chrome_w` /
/// `chrome_h` are the decoration the window manager adds AROUND the size we
/// ask for: `set_size` sets the INNER size while a work area measures the
/// OUTER frame, so without them a title bar still hangs below the edge.
///
/// The rule, in the order it applies:
/// 1. No monitor information, or a window that is ALREADY fully visible →
///    the state is returned untouched. For every rig where nothing is wrong
///    this function is the identity, which is what keeps promise 2 ("a
///    restart restores the screen exactly") and leaves a window straddling
///    two monitors alone.
/// 2. Otherwise the host monitor is the one under the window's centre — the
///    same choice [`restorable`] makes. If the centre is on none of them,
///    nothing is changed: `restorable` has already decided that case.
/// 3. Shrink (never grow) to the work area minus the chrome, but NEVER below
///    [`MIN_WINDOW_W`]/[`MIN_WINDOW_H`] — a 400 px sliver is not a rescue.
/// 4. Pull the window back onto the work area, top-left anchored: when the
///    minimum made it wider than the screen, the left edge is the one worth
///    keeping.
pub fn fit_to_monitor(
    state: &WindowState,
    work_areas: &[MonitorRect],
    chrome_w: f64,
    chrome_h: f64,
) -> WindowState {
    if work_areas.is_empty() {
        return *state;
    }
    let cw = sane_chrome(chrome_w);
    let ch = sane_chrome(chrome_h);

    if fully_visible(state.x, state.y, state.w + cw, state.h + ch, work_areas) {
        return *state;
    }
    let (ow, oh) = (state.w + cw, state.h + ch);
    let cx = state.x + state.w / 2.0;
    let cy = state.y + state.h / 2.0;
    // The centre first (the same choice `restorable` makes), then the work
    // area the window covers most of — a centre can land in the taskbar
    // strip, which is ON the monitor but outside its work area. Overlapping
    // nothing at all means we cannot tell, so we do not touch it.
    let host = work_areas.iter().find(|a| a.contains(cx, cy)).or_else(|| {
        work_areas
            .iter()
            .filter(|a| overlap(a, state.x, state.y, ow, oh) > 0.0)
            .max_by(|a, b| {
                overlap(a, state.x, state.y, ow, oh)
                    .total_cmp(&overlap(b, state.x, state.y, ow, oh))
            })
    });
    let Some(area) = host else {
        return *state;
    };

    let w = state.w.min((area.w - cw).max(MIN_WINDOW_W));
    let h = state.h.min((area.h - ch).max(MIN_WINDOW_H));
    let x = state.x.min(area.x + area.w - (w + cw)).max(area.x);
    let y = state.y.min(area.y + area.h - (h + ch)).max(area.y);

    WindowState {
        x,
        y,
        w,
        h,
        fullscreen: state.fullscreen,
    }
}

/// A decoration measurement we can trust: a negative or non-finite reading
/// (an unmapped window answers oddly on some platforms) means "we could not
/// measure", and the honest value for that is zero — never a clamp built on
/// a NaN.
fn sane_chrome(v: f64) -> f64 {
    if v.is_finite() && v > 0.0 {
        v
    } else {
        0.0
    }
}

/// Area of the intersection between a work area and an outer window rect.
fn overlap(a: &MonitorRect, x: f64, y: f64, w: f64, h: f64) -> f64 {
    let ox = (a.x + a.w).min(x + w) - a.x.max(x);
    let oy = (a.y + a.h).min(y + h) - a.y.max(y);
    ox.max(0.0) * oy.max(0.0)
}

/// Is every corner of this outer rect on SOME work area? The 1 px inset on
/// the far edges matches [`MonitorRect::contains`], whose right/bottom bound
/// is exclusive.
fn fully_visible(x: f64, y: f64, w: f64, h: f64, areas: &[MonitorRect]) -> bool {
    let right = x + w - 1.0;
    let bottom = y + h - 1.0;
    [(x, y), (right, y), (x, bottom), (right, bottom)]
        .iter()
        .all(|(px, py)| areas.iter().any(|a| a.contains(*px, *py)))
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

    // ── fit_to_monitor ──────────────────────────────────────────────────

    fn sized(x: f64, y: f64, w: f64, h: f64) -> WindowState {
        WindowState {
            x,
            y,
            w,
            h,
            fullscreen: false,
        }
    }

    fn area(x: f64, y: f64, w: f64, h: f64) -> MonitorRect {
        MonitorRect { x, y, w, h }
    }

    #[test]
    fn a_window_that_already_fits_is_returned_untouched() {
        // The normal case must be the IDENTITY — promise 2 says a restart
        // restores the screen exactly, chrome and all.
        let s = sized(100.0, 100.0, 1280.0, 800.0);
        let work = [area(0.0, 0.0, 1920.0, 1040.0)];
        assert_eq!(fit_to_monitor(&s, &work, 0.0, 28.0), s);
    }

    #[test]
    fn no_monitor_information_changes_nothing() {
        let s = sized(0.0, 0.0, 4000.0, 4000.0);
        assert_eq!(fit_to_monitor(&s, &[], 0.0, 28.0), s);
    }

    #[test]
    fn the_1024x768_projector_gets_a_window_that_fits_below_the_taskbar() {
        // The rig this exists for: the config default on a small projector
        // with a 40 px taskbar. ~100 px used to hang under the edge, taking
        // the toolbar AND the reveal zone with it.
        let s = sized(0.0, 0.0, 1280.0, 800.0);
        let work = [area(0.0, 0.0, 1024.0, 728.0)];
        let out = fit_to_monitor(&s, &work, 0.0, 28.0);
        assert_eq!(out.w, 1024.0);
        assert_eq!(out.h, 700.0, "the title bar is part of the height");
        assert_eq!((out.x, out.y), (0.0, 0.0));
        // And the fitted state is a FIXPOINT — running it again is a no-op.
        assert_eq!(fit_to_monitor(&out, &work, 0.0, 28.0), out);
    }

    #[test]
    fn the_decoration_is_subtracted_on_both_axes() {
        let s = sized(0.0, 0.0, 1024.0, 768.0);
        let work = [area(0.0, 0.0, 1024.0, 768.0)];
        let out = fit_to_monitor(&s, &work, 16.0, 56.0);
        assert_eq!((out.w, out.h), (1008.0, 712.0));
    }

    #[test]
    fn an_unmeasurable_decoration_is_treated_as_none_not_as_nan() {
        let s = sized(0.0, 0.0, 1280.0, 800.0);
        let work = [area(0.0, 0.0, 1024.0, 728.0)];
        let out = fit_to_monitor(&s, &work, f64::NAN, -12.0);
        assert_eq!((out.w, out.h), (1024.0, 728.0));
    }

    #[test]
    fn the_minimum_wins_over_a_screen_too_small_for_it() {
        // Below the minimum the window stops being usable at all, so the
        // clamp stops there and the top-left corner is what we keep.
        let s = sized(0.0, 0.0, 1280.0, 800.0);
        let work = [area(0.0, 0.0, 800.0, 600.0)];
        let out = fit_to_monitor(&s, &work, 0.0, 28.0);
        assert_eq!(out.w, MIN_WINDOW_W);
        assert_eq!(out.h, MIN_WINDOW_H);
        assert_eq!((out.x, out.y), (0.0, 0.0));
    }

    #[test]
    fn a_window_hanging_off_the_bottom_right_is_pulled_back_on() {
        // It FITS — it is just parked too low and too far right.
        let s = sized(1200.0, 600.0, 1000.0, 700.0);
        let work = [area(0.0, 0.0, 1920.0, 1040.0)];
        let out = fit_to_monitor(&s, &work, 0.0, 28.0);
        assert_eq!((out.w, out.h), (1000.0, 700.0), "no shrink was needed");
        assert_eq!(out.x, 920.0);
        assert_eq!(out.y, 312.0);
    }

    #[test]
    fn a_centre_in_the_taskbar_strip_still_finds_its_monitor() {
        // On the monitor, outside its work area: the overlap fallback keeps
        // this window from being left hanging under the taskbar.
        let s = sized(0.0, 900.0, 1000.0, 400.0);
        let work = [area(0.0, 0.0, 1920.0, 1040.0)];
        let out = fit_to_monitor(&s, &work, 0.0, 28.0);
        assert_eq!(out.h, 400.0);
        assert_eq!(out.y, 612.0);
    }

    #[test]
    fn a_window_straddling_two_monitors_is_left_alone() {
        // Every corner is on SOME work area, so nothing is wrong — yanking
        // it onto one monitor would be the app moving the teacher's window.
        let work = [
            area(0.0, 0.0, 1920.0, 1040.0),
            area(1920.0, 0.0, 1024.0, 728.0),
        ];
        let s = sized(1700.0, 100.0, 500.0, 400.0);
        assert_eq!(fit_to_monitor(&s, &work, 0.0, 28.0), s);
    }

    #[test]
    fn a_centre_on_no_work_area_is_left_to_restorable() {
        // Centre in the gap between two monitors: we do not know which
        // screen this window belongs to, so we do not touch it.
        let work = [
            area(0.0, 0.0, 1000.0, 800.0),
            area(2000.0, 0.0, 1000.0, 800.0),
        ];
        let s = sized(1200.0, 100.0, 600.0, 400.0);
        assert_eq!(fit_to_monitor(&s, &work, 0.0, 28.0), s);
    }

    #[test]
    fn fullscreen_rides_along_untouched() {
        let s = WindowState {
            x: 0.0,
            y: 0.0,
            w: 1280.0,
            h: 800.0,
            fullscreen: true,
        };
        let out = fit_to_monitor(&s, &[area(0.0, 0.0, 1024.0, 728.0)], 0.0, 28.0);
        assert!(out.fullscreen);
    }
}
