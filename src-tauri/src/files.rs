//! Reading and writing user-chosen text files (paths must come from a
//! StudyOS dialog, see paths.rs) (calendar and BibTeX import/export and,
//! later, data exports). Paths come from the native open/save dialogs; the
//! extension allow-lists keep these commands from touching anything else.

use std::fs;
use std::path::Path;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const READABLE: &[&str] = &["ics", "bib"];
const WRITABLE: &[&str] = &["ics", "bib", "json", "md", "csv", "txt"];

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

fn check_ext(path: &Path, allowed: &[&str]) -> Result<(), String> {
    let ext = extension(path);
    if allowed.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!("Only {} files are allowed here.", allowed.iter().map(|e| format!(".{e}")).collect::<Vec<_>>().join(", ")))
    }
}

#[tauri::command]
pub async fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    read_text_at(&crate::paths::take_user_path(&app, &path)?)
}

#[tauri::command]
pub async fn write_text_file(app: tauri::AppHandle, path: String, contents: String) -> Result<(), String> {
    write_text_at(&crate::paths::take_user_path(&app, &path)?, &contents)
}

fn read_text_at(p: &Path) -> Result<String, String> {
    check_ext(p, READABLE)?;
    let meta = fs::metadata(p).map_err(|e| format!("Couldn't read the file: {e}"))?;
    if !meta.is_file() {
        return Err("That isn't a file.".into());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("The file is larger than 10 MB.".into());
    }
    let bytes = fs::read(p).map_err(|e| format!("Couldn't read the file: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn write_text_at(p: &Path, contents: &str) -> Result<(), String> {
    check_ext(p, WRITABLE)?;
    fs::write(p, contents).map_err(|e| format!("Couldn't save the file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_rules() {
        assert!(check_ext(Path::new("C:/x/timetable.ICS"), READABLE).is_ok());
        assert!(check_ext(Path::new("C:/x/notes.txt"), READABLE).is_err());
        assert!(check_ext(Path::new("C:/x/run.bat"), WRITABLE).is_err());
        assert!(check_ext(Path::new("C:/x/export.json"), WRITABLE).is_ok());
        assert!(check_ext(Path::new("C:/x/refs.bib"), READABLE).is_ok());
    }

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("studyos-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("cal.ics");
        write_text_at(&file, "BEGIN:VCALENDAR").unwrap();
        assert_eq!(read_text_at(&file).unwrap(), "BEGIN:VCALENDAR");
        let _ = fs::remove_dir_all(dir);
    }
}
