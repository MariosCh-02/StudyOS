mod attachments;
mod ai;
mod backups;
mod db;
mod paths;
mod desktop;
mod files;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection string used by both the Rust side (migrations) and the
/// frontend (`Database.load`). Relative sqlite paths resolve to the
/// per-user app config directory (%APPDATA%\com.studyos.app).
pub const DB_URL: &str = "sqlite:studyos.db";

/// Schema migrations. Each file is applied exactly once, in order, inside a
/// transaction. Never edit a migration that has shipped; add a new one.
/// The same SQL files are applied by the frontend test-suite.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/0001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "sync",
            sql: include_str!("../migrations/0002_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "lectures_notes_attachments",
            sql: include_str!("../migrations/0003_lectures_notes_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "calendar",
            sql: include_str!("../migrations/0004_calendar.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "tracking",
            sql: include_str!("../migrations/0005_tracking.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "learning",
            sql: include_str!("../migrations/0006_learning.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "knowledge",
            sql: include_str!("../migrations/0007_knowledge.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "research",
            sql: include_str!("../migrations/0008_research.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "tag_names",
            sql: include_str!("../migrations/0009_tag_names.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Launching StudyOS a second time focuses the running window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(desktop::shortcut_plugin())
        .manage(paths::UserPaths::default())
        // Files dropped onto the window may be imported (see paths.rs).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                use tauri::Manager;
                window.state::<paths::UserPaths>().allow(paths.iter().cloned());
            }
        })
        .setup(|app| {
            // A missing tray is not fatal: StudyOS then simply quits when closed.
            if let Err(e) = desktop::build_tray(app.handle()) {
                eprintln!("StudyOS: couldn't create the tray icon: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            attachments::import_attachment,
            attachments::import_attachment_bytes,
            attachments::read_attachment,
            attachments::attachment_exists,
            attachments::open_attachment,
            files::read_text_file,
            files::write_text_file,
            ai::ai_set_key,
            ai::ai_has_key,
            ai::ai_delete_key,
            ai::ai_complete,
            ai::ai_list_models,
            ai::ai_chat,
            ai::ai_cancel,
            backups::backup_save,
            backups::backup_list,
            backups::backup_read,
            backups::backup_delete,
            backups::backup_open_folder,
            backups::archive_export,
            backups::backup_import_file,
            desktop::set_focus_shortcut,
            db::db_select,
            db::db_execute,
            paths::pick_open_files,
            paths::pick_save_file,
            desktop::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StudyOS");
}
