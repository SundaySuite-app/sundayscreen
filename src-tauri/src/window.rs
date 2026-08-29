//! Window management: fullscreen the classroom way, and boot-time restore
//! of the saved geometry (with the core's monitor-sanity clamp and the
//! work-area fit).

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};

use sundayscreen_core::settings::{Settings, MIN_WINDOW_H, MIN_WINDOW_W};
use sundayscreen_core::window::{fit_to_monitor, restorable, MonitorRect};
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::error::{AppError, AppResult};

/// The windowed size a fresh install opens at — the same numbers as
/// tauri.conf.json's `width`/`height`. They are a WISH here: the work area
/// gets the final word, because a 1280×800 window on a 1024×768 projector
/// puts the toolbar (and its reveal zone) under the screen edge, with no
/// visible way back.
const DEFAULT_WINDOW_W: f64 = 1280.0;
const DEFAULT_WINDOW_H: f64 = 800.0;

/// macOS fullscreen is SIMPLE fullscreen (see [`set_fullscreen`]), which
/// Tauri 2.11 can set but not read back: `is_fullscreen()` reports the native
/// Spaces fullscreen only and answers `false` while simple fullscreen is on.
/// So the backend remembers what it applied — one main window, one flag.
#[cfg(target_os = "macos")]
static SIMPLE_FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// Enter/leave fullscreen. macOS uses SIMPLE fullscreen on purpose: no
/// Spaces animation and no new Space — the projector shows the app, Escape
/// brings the window straight back. Windows/Linux use borderless fullscreen
/// (never exclusive, never always-on-top — alt-tab and notifications must
/// keep working).
pub fn set_fullscreen(window: &WebviewWindow, fullscreen: bool) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        window
            .set_simple_fullscreen(fullscreen)
            .map_err(|e| AppError::Internal(format!("set_simple_fullscreen: {e}")))?;
        SIMPLE_FULLSCREEN.store(fullscreen, Ordering::Relaxed);
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_fullscreen(fullscreen)
            .map_err(|e| AppError::Internal(format!("set_fullscreen: {e}")))?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_set_fullscreen(window: WebviewWindow, fullscreen: bool) -> AppResult<()> {
    set_fullscreen(&window, fullscreen)
}

/// Is the window fullscreen RIGHT NOW? The frontend must MEASURE this at
/// boot rather than trust the saved flag: a restore can fail, and a
/// frontend that wrongly believes it is fullscreen stops saving the window
/// geometry for the whole session (`saveGeometry` returns early on it).
///
/// `is_fullscreen()` alone is the trap: on macOS it answers `false` while we
/// are in simple fullscreen, so the flag it would seed is the wrong one.
#[tauri::command]
pub fn window_is_fullscreen(window: WebviewWindow) -> AppResult<bool> {
    let native = window
        .is_fullscreen()
        .map_err(|e| AppError::Internal(format!("is_fullscreen: {e}")))?;
    #[cfg(target_os = "macos")]
    {
        Ok(native || SIMPLE_FULLSCREEN.load(Ordering::Relaxed))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(native)
    }
}

/// The decoration AROUND the size we ask for, in logical pixels. `set_size`
/// sets the INNER size while a work area measures the OUTER frame, so
/// without this a title bar still hangs below the screen edge. Measured on
/// the LIVE window — decorations differ per platform, theme and DPI.
/// Unmeasurable → `(0, 0)`, which the core reads as "no chrome known".
fn chrome(window: &WebviewWindow) -> (f64, f64) {
    let (Ok(scale), Ok(outer), Ok(inner)) = (
        window.scale_factor(),
        window.outer_size(),
        window.inner_size(),
    ) else {
        tracing::warn!("could not measure the window decoration — assuming none");
        return (0.0, 0.0);
    };
    let outer = outer.to_logical::<f64>(scale);
    let inner = inner.to_logical::<f64>(scale);
    (
        (outer.width - inner.width).max(0.0),
        (outer.height - inner.height).max(0.0),
    )
}

/// Open at the config default, shrunk to whatever the primary monitor's work
/// area actually offers, and centred. Used on a FIRST start and whenever a
/// saved geometry is rejected — both land on the config default, which is
/// exactly the geometry that overflows a small projector.
///
/// `Err`/`None` from the monitor query keeps the config default untouched
/// (the same "Err ≠ empty" rule as the restore path, F9-funn B#8): a failed
/// query is not "the screen is tiny".
fn open_at_default_size(window: &WebviewWindow) {
    let monitor = match window.primary_monitor() {
        Ok(Some(m)) => m,
        Ok(None) => {
            tracing::info!("no primary monitor reported — keeping the config default size");
            return;
        }
        Err(e) => {
            tracing::warn!("primary monitor query failed — keeping the config default size: {e}");
            return;
        }
    };
    let (cw, ch) = chrome(window);
    let work = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    let w = DEFAULT_WINDOW_W.min(work.width - cw).max(MIN_WINDOW_W);
    let h = DEFAULT_WINDOW_H.min(work.height - ch).max(MIN_WINDOW_H);
    let _ = window.set_size(LogicalSize::new(w, h));
    let _ = window.center();
}

/// Apply the saved geometry on boot.
///
/// Two independent decisions, deliberately not nested:
/// - the GEOMETRY is restored only when its centre lands on a connected
///   monitor (`restorable`) and then fitted inside that monitor's work area
///   (`fit_to_monitor`);
/// - FULLSCREEN is applied either way, because a fullscreen window lands on a
///   connected monitor by definition. It used to sit inside the `!restorable`
///   early return, which left the frontend believing it was fullscreen while
///   it was not — and `saveGeometry()` skips every save in that belief, so
///   the window position stopped being saved for the entire session.
///
/// Returns `true` when fullscreen was asked for and FAILED: the caller must
/// then clear the stored flag, or the next boot inherits the same lie.
#[must_use]
pub fn restore_window_state(app: &tauri::AppHandle, settings: &Settings) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let Some(state) = &settings.window else {
        open_at_default_size(&window);
        return false;
    };

    // Err ≠ empty (F9-funn B#8): a FAILED enumeration must not collapse into
    // "no monitors, trust anything" — that inverts the clamp exactly on the
    // rigs it exists for. `restorable` keeps reading full monitor rects (a
    // window centred over the Dock is still on that screen); the FIT reads
    // work areas, where the taskbar/Dock is already subtracted.
    match window.available_monitors() {
        Ok(list) => {
            let mut monitors = Vec::with_capacity(list.len());
            let mut work_areas = Vec::with_capacity(list.len());
            for m in &list {
                let scale = m.scale_factor();
                let pos = m.position().to_logical::<f64>(scale);
                let size = m.size().to_logical::<f64>(scale);
                monitors.push(MonitorRect {
                    x: pos.x,
                    y: pos.y,
                    w: size.width,
                    h: size.height,
                });
                let area = m.work_area();
                let apos = area.position.to_logical::<f64>(scale);
                let asize = area.size.to_logical::<f64>(scale);
                work_areas.push(MonitorRect {
                    x: apos.x,
                    y: apos.y,
                    w: asize.width,
                    h: asize.height,
                });
            }

            if restorable(state, &monitors) {
                let (cw, ch) = chrome(&window);
                let fitted = fit_to_monitor(state, &work_areas, cw, ch);
                if fitted != *state {
                    tracing::info!(
                        "saved window state did not fit this monitor's work area — fitted to \
                         {}×{} at ({}, {})",
                        fitted.w,
                        fitted.h,
                        fitted.x,
                        fitted.y
                    );
                }
                let _ = window.set_position(LogicalPosition::new(fitted.x, fitted.y));
                let _ = window.set_size(LogicalSize::new(fitted.w, fitted.h));
            } else {
                tracing::info!(
                    "saved window state is on a disconnected monitor — using the default geometry"
                );
                open_at_default_size(&window);
            }
        }
        Err(e) => {
            tracing::warn!("monitor enumeration failed — skipping the geometry restore: {e}");
        }
    }

    if state.fullscreen {
        if let Err(e) = set_fullscreen(&window, true) {
            tracing::warn!("restoring fullscreen failed — clearing the stored flag: {e}");
            return true;
        }
    }
    false
}
