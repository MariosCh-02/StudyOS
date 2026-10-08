//! User-chosen paths.
//!
//! File dialogs are opened here in Rust, and files dropped onto the window are
//! recorded from the native drag-and-drop event. Commands that read or write a
//! path the web view passes in (`import_attachment`, `read_text_file`,
//! `write_text_file`, backup import/export) only accept a path recorded here,
//! once. So script in the web view can't read or overwrite arbitrary files.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct UserPaths(Mutex<HashSet<PathBuf>>);

impl UserPaths {
    pub fn allow<I: IntoIterator<Item = PathBuf>>(&self, paths: I) {
        if let Ok(mut set) = self.0.lock() {
            // Keep the set small; old, unused choices simply expire.
            if set.len() > 500 {
                set.clear();
            }
            set.extend(paths);
        }
    }
    fn take(&self, path: &str) -> Option<PathBuf> {
        let p = PathBuf::from(path);
        self.0.lock().ok()?.take(&p)
    }
}

/// The path, if the user chose it in a dialog or dropped it on the window.
pub fn take_user_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    app.state::<UserPaths>()
        .take(path)
        .ok_or_else(|| "That file wasn't chosen in StudyOS. Pick it again or drop it onto the window.".to_string())
}

const ATTACHMENT_EXTS: &[&str] = &["pdf", "docx", "pptx", "xlsx", "csv", "txt", "md", "png", "jpg", "jpeg", "gif", "webp", "zip"];
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const SAVE_EXTS: &[&str] = &["ics", "bib", "json", "md", "csv", "txt", "zip"];

fn filter_for(kind: &str) -> Result<(&'static str, &'static [&'static str]), String> {
    Ok(match kind {
        "attachments" => ("Study files", ATTACHMENT_EXTS),
        "images" => ("Images", IMAGE_EXTS),
        "ics" => ("Calendar", &["ics"]),
        "bib" => ("BibTeX", &["bib"]),
        "backup" => ("StudyOS backup or export", &["json", "zip"]),
        _ => return Err("Unknown file type.".into()),
    })
}

/// Open dialog. Returns the chosen paths (empty if cancelled).
#[tauri::command]
pub async fn pick_open_files(app: AppHandle, paths: State<'_, UserPaths>, kind: String, multiple: bool) -> Result<Vec<String>, String> {
    let (label, exts) = filter_for(&kind)?;
    let dialog = app.dialog().file().add_filter(label, exts);
    let picked = tauri::async_runtime::spawn_blocking(move || if multiple { dialog.blocking_pick_files() } else { dialog.blocking_pick_file().map(|f| vec![f]) })
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let chosen: Vec<PathBuf> = picked.into_iter().filter_map(|f| f.into_path().ok()).collect();
    paths.allow(chosen.iter().cloned());
    Ok(chosen.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// Save dialog. Returns the chosen path, or None if cancelled.
#[tauri::command]
pub async fn pick_save_file(app: AppHandle, paths: State<'_, UserPaths>, default_name: String, extension: String, label: String) -> Result<Option<String>, String> {
    let ext = SAVE_EXTS.iter().find(|e| **e == extension).ok_or("This file type can't be saved.")?;
    let name: String = default_name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()).take(120).collect();
    let dialog = app.dialog().file().add_filter(label, &[*ext]).set_file_name(name);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file()).await.map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|f| f.into_path().ok()) else { return Ok(None) };
    paths.allow([path.clone()]);
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_single_use_and_exact() {
        let reg = UserPaths::default();
        reg.allow([PathBuf::from("C:/Users/me/notes.ics")]);
        assert!(reg.take("C:/Users/me/other.ics").is_none());
        assert!(reg.take("C:/Users/me/notes.ics").is_some());
        assert!(reg.take("C:/Users/me/notes.ics").is_none());
    }

    #[test]
    fn only_known_file_kinds() {
        assert!(filter_for("attachments").is_ok());
        assert!(filter_for("exe").is_err());
    }
}
