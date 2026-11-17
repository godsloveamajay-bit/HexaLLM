use tauri::{command, AppHandle, Manager};
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

#[command]
pub async fn pet_open(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("pet").is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, "pet", WebviewUrl::App("pet".into()))
        .title("HexaLLM Pet")
        .inner_size(220.0, 260.0)
        .always_on_top(true)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    let _ = window;
    Ok(())
}

#[command]
pub async fn pet_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pet") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
