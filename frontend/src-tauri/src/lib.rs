mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .invoke_handler(tauri::generate_handler![
            // Shell commands
            commands::shell::shell_exec,
            commands::shell::shell_exec_stream,
            // FS commands
            commands::fs::fs_read,
            commands::fs::fs_write,
            commands::fs::fs_append,
            commands::fs::fs_list,
            commands::fs::fs_mkdir,
            commands::fs::fs_remove,
            commands::fs::fs_exists,
            // Git commands
            commands::git::git_exec,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_log,
            commands::git::git_branch,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_pull,
            // Browser commands
            commands::browser::browser_open,
            commands::browser::browser_close,
            commands::browser::browser_execute_script,
            commands::browser::browser_navigate,
            commands::browser::browser_execute_actions,
            commands::browser::browser_get_content,
            // Backend commands
            commands::backend::backend_start,
            commands::backend::backend_stop,
            commands::backend::backend_status,
            commands::backend::backend_health,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }
            
            // Start backend on startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = commands::backend::backend_start(app_handle).await;
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
