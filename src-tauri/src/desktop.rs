//! Desktop integration: system tray (menu bar on macOS), the optional global
//! shortcut and, on macOS, the application menu.
//!
//! Closing the window can hide StudyOS to the tray (so reminders and the
//! study timer keep running); the frontend decides that from a setting and
//! hides the window itself after saving open notes. The tray's Quit (and
//! Cmd+Q on macOS) asks the frontend to save first, with a timeout so StudyOS
//! always exits.

use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const QUIT_GRACE: Duration = Duration::from_secs(5);

/// Ctrl+Shift+S on Windows, Cmd+Shift+S on macOS.
fn focus_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let primary = Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let primary = Modifiers::CONTROL;
    Shortcut::new(Some(primary | Modifiers::SHIFT), Code::KeyS)
}

#[cfg(target_os = "macos")]
const SHORTCUT_LABEL: &str = "Cmd+Shift+S";
#[cfg(not(target_os = "macos"))]
const SHORTCUT_LABEL: &str = "Ctrl+Shift+S";

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

/// Global-shortcut plugin whose handler focuses StudyOS on the focus shortcut.
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

/// Turns the system-wide focus shortcut on or off (off by default, because it
/// takes the shortcut away from other programs, e.g. "Save As").
#[tauri::command]
pub fn set_focus_shortcut(app: AppHandle, enabled: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    let s = focus_shortcut();
    let registered = gs.is_registered(s);
    if enabled && !registered {
        gs.register(s).map_err(|_| format!("{SHORTCUT_LABEL} is already used by another program. Close it or leave this off."))?;
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

// Ids of the macOS menu's own items (see `on_app_menu`).
const APP_QUIT: &str = "app-quit";
const APP_MINIMIZE: &str = "app-minimize";

/// macOS application menu. Edit items are needed for Cmd+C/V/X/A/Z to reach
/// the web view. Quit is our own item so open notes are saved first (the
/// standard one exits immediately), and Minimize has no Cmd+M so the editor
/// keeps it for inline maths.
#[cfg(target_os = "macos")]
pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::Submenu;
    let sep = || PredefinedMenuItem::separator(app);
    let studyos = Submenu::with_items(
        app,
        "StudyOS",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About StudyOS"), None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("Hide StudyOS"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &MenuItem::with_id(app, APP_QUIT, "Quit StudyOS", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &MenuItem::with_id(app, APP_MINIMIZE, "Minimize", true, None::<&str>)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&studyos, &edit, &window])
}

/// Handles the app menu's own items (only macOS has an app menu).
pub fn on_app_menu(app: &AppHandle, id: &str) {
    match id {
        APP_QUIT => request_quit(app),
        APP_MINIMIZE => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.minimize();
            }
        }
        _ => {}
    }
}
