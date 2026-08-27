//! Window management: fullscreen the classroom way, and boot-time restore
//! of the saved geometry (with the core's monitor-sanity clamp).

use sundayscreen_core::settings::Settings;
use sundayscreen_core::window::{restorable, MonitorRect};
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::error::{AppError, AppResult};

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

/// Apply the saved geometry on boot — only when its centre lands on a
/// connected monitor (`sundayscreen_core::window::restorable`); a projector
/// that is gone must not strand the window off-screen.
pub fn restore_window_state(app: &tauri::AppHandle, settings: &Settings) {
    let Some(state) = &settings.window else {
        return;
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let monitors: Vec<MonitorRect> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let pos = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            MonitorRect {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
            }
        })
        .collect();

    if !restorable(state, &monitors) {
        tracing::info!(
            "saved window state is on a disconnected monitor — using the default geometry"
        );
        return;
    }

    let _ = window.set_position(LogicalPosition::new(state.x, state.y));
    let _ = window.set_size(LogicalSize::new(state.w, state.h));
    if state.fullscreen {
        let _ = set_fullscreen(&window, true);
    }
}
