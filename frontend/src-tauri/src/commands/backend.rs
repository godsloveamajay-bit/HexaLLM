use tauri::{command, AppHandle, Manager, Emitter};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::sleep;
use reqwest::Client;

static BACKEND_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);
static BACKEND_PORT: Mutex<Option<u16>> = Mutex::new(None);

async fn check_backend_health(port: u16) -> bool {
    let client = Client::new();
    let url = format!("http://127.0.0.1:{}/api/v1/health", port);
    match client.get(&url).timeout(Duration::from_secs(2)).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

async fn find_free_port() -> Result<u16, String> {
    for port in 8080..9000 {
        if tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await.is_ok() {
            return Ok(port);
        }
    }
    Err("No free port found".to_string())
}

fn take_backend_process() -> Option<std::process::Child> {
    let mut guard = BACKEND_PROCESS.lock().unwrap();
    guard.take()
}

fn get_backend_port() -> Option<u16> {
    *BACKEND_PORT.lock().unwrap()
}

fn set_backend_port(port: u16) {
    *BACKEND_PORT.lock().unwrap() = Some(port);
}

fn clear_backend_port() {
    *BACKEND_PORT.lock().unwrap() = None;
}

async fn stop_backend_internal() -> Result<(), String> {
    if let Some(mut child) = take_backend_process() {
        child.kill().map_err(|e| e.to_string())?;
    }
    clear_backend_port();
    Ok(())
}

#[command]
pub async fn backend_start(app_handle: tauri::AppHandle) -> Result<u16, String> {
    if let Some(port) = get_backend_port() {
        if check_backend_health(port).await {
            return Ok(port);
        }
    }

    let port = find_free_port().await?;

    let child = Command::new("python3")
        .args(&["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", &port.to_string()])
        .current_dir("/root/HexaLLM/backend")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start backend: {}", e))?;

    {
        let mut guard = BACKEND_PROCESS.lock().unwrap();
        *guard = Some(child);
    }

    let mut retries = 30;
    while retries > 0 {
        if check_backend_health(port).await {
            set_backend_port(port);
            let _ = app_handle.emit("backend:ready", port);
            return Ok(port);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        retries -= 1;
    }

    stop_backend_internal().await;
    Err("Backend failed to start within timeout".to_string())
}

#[command]
pub async fn backend_stop() -> Result<(), String> {
    stop_backend_internal().await;
    Ok(())
}

#[command]
pub async fn backend_status() -> Result<BackendStatus, String> {
    if let Some(port) = get_backend_port() {
        let healthy = check_backend_health(port).await;
        Ok(BackendStatus {
            running: healthy,
            port: Some(port),
            url: if healthy { Some(format!("http://127.0.0.1:{}", port)) } else { None },
        })
    } else {
        Ok(BackendStatus {
            running: false,
            port: None,
            url: None,
        })
    }
}

#[command]
pub async fn backend_health(port: u16) -> Result<bool, String> {
    Ok(check_backend_health(port).await)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct BackendStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub url: Option<String>,
}
