use tauri::{command, Runtime, WebviewWindowBuilder, WebviewUrl, Window, Manager};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct BrowserAction {
    #[serde(rename = "type")]
    pub action_type: String,
    pub selector: Option<String>,
    pub value: Option<String>,
    pub url: Option<String>,
    pub script: Option<String>,
    pub wait_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BrowserResult {
    pub success: bool,
    pub data: Option<String>,
    pub error: Option<String>,
}

#[command]
pub async fn browser_open(window: tauri::Window, url: String, window_label: Option<String>) -> Result<String, String> {
    let label = window_label.unwrap_or_else(|| format!("browser-{}", uuid::Uuid::new_v4()));
    
    let _window = WebviewWindowBuilder::new(
        window.app_handle(),
        &label,
        WebviewUrl::External(url.parse::<url::Url>().map_err(|e| e.to_string())?),
    )
    .title("Browser")
    .inner_size(1200.0, 800.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    
    Ok(label)
}

#[command]
pub async fn browser_close(window: tauri::Window, window_label: String) -> Result<(), String> {
    if let Some(w) = window.app_handle().get_webview_window(&window_label) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn browser_execute_script(window: tauri::Window, window_label: String, script: String) -> Result<String, String> {
    window.app_handle()
        .get_webview_window(&window_label)
        .ok_or("Window not found".to_string())?
        .eval(&script)
        .map_err(|e| e.to_string())?;
    Ok("Script executed".to_string())
}

#[command]
pub async fn browser_navigate(window: tauri::Window, window_label: String, url: String) -> Result<(), String> {
    window.app_handle()
        .get_webview_window(&window_label)
        .ok_or("Window not found".to_string())?
        .navigate(url.parse::<url::Url>().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn browser_execute_actions(window: tauri::Window, window_label: String, actions: Vec<BrowserAction>) -> Result<BrowserResult, String> {
    let webview = window.app_handle()
        .get_webview_window(&window_label)
        .ok_or("Window not found".to_string())?;
    
    for action in actions {
        match action.action_type.as_str() {
            "click" => {
                if let Some(selector) = action.selector {
                    let script = format!(r#"document.querySelector("{}")?.click()"#, selector);
                    window.app_handle()
                        .get_webview_window(&window_label)
                        .ok_or("Window not found".to_string())?
                        .eval(&script)
                        .map_err(|e| e.to_string())?;
                }
            }
            "type" => {
                if let (Some(selector), Some(value)) = (action.selector, action.value) {
                    let script = format!(r#"document.querySelector("{}").value = "{}""#, selector, value.replace('"', r#"\""#));
                    window.app_handle()
                        .get_webview_window(&window_label)
                        .ok_or("Window not found".to_string())?
                        .eval(&script)
                        .map_err(|e| e.to_string())?;
                }
            }
            "wait" => {
                if let Some(ms) = action.wait_ms {
                    tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
                }
            }
            "navigate" => {
                if let Some(url) = action.url {
                    window.app_handle()
                        .get_webview_window(&window_label)
                        .ok_or("Window not found".to_string())?
                        .navigate(url.parse::<url::Url>().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                }
            }
            "script" => {
                if let Some(script) = action.script {
                    window.app_handle()
                        .get_webview_window(&window_label)
                        .ok_or("Window not found".to_string())?
                        .eval(&script)
                        .map_err(|e| e.to_string())?;
                }
            }
            "screenshot" => {
                // Would need to implement screenshot capture
            }
            _ => {}
        }
    }
    Ok(BrowserResult { success: true, data: Some("Actions completed".to_string()), error: None })
}

#[command]
pub async fn browser_get_content(window: tauri::Window, window_label: String, selector: Option<String>) -> Result<String, String> {
    let webview = window.app_handle()
        .get_webview_window(&window_label)
        .ok_or("Window not found".to_string())?;
    
    let script = if let Some(sel) = selector {
        format!(r#"document.querySelector("{}")?.outerHTML || ""#, sel)
    } else {
        "document.documentElement.outerHTML".to_string()
    };
    
    let _result = webview.eval(&script).map_err(|e| e.to_string())?;
    Ok("Content extraction requires IPC channel".to_string())
}
