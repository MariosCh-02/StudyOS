//! Windows integration: system tray icon and the optional global shortcut.
//!
//! Closing the window can hide StudyOS to the tray (so reminders and the
//! study timer keep running); the frontend decides that from a setting and
//! hides the window itself after saving open notes. The tray's Quit asks the
//! frontend to save first, with a timeout so StudyOS always exits.

use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const QUIT_GRACE: Duration = Duration::from_secs(5);

fn focus_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS)
}

/// Brings the main window to the front (also used by single-instance).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn request_quit(app: &AppHandle) {
    // The frontend saves open notes and then calls `quit_app`.
    let _ = app.emit_to("main", "tray-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_GRACE);
        handle.exit(0);
    });
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open StudyOS", true, None::<&str>)?;
    let lecture = MenuItem::with_id(app, "lecture", "Quick Lecture Mode", true, None::<&str>)?;
    let timer = MenuItem::with_id(app, "timer", "Start study timer", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit StudyOS", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lecture, &timer, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("StudyOS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "lecture" | "timer" => {
                show_main(app);
                let _ = app.emit_to("main", "tray-action", event.id.as_ref());
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Global-shortcut plugin whose handler focuses StudyOS on Ctrl+Shift+S.
pub fn shortcut_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() == ShortcutState::Pressed && *shortcut == focus_shortcut() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build()
}

/// Turns the system-wide Ctrl+Shift+S on or off (off by default, because it
/// takes the shortcut away from other programs, e.g. "Save As").
#[tauri::command]
pub fn set_focus_shortcut(app: AppHandle, enabled: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    let s = focus_shortcut();
    let registered = gs.is_registered(s);
    if enabled && !registered {
        gs.register(s).map_err(|_| "Ctrl+Shift+S is already used by another program. Close it or leave this off.".to_string())?;
    } else if !enabled && registered {
        gs.unregister(s).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Exits StudyOS (called by the frontend once open notes are saved).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
