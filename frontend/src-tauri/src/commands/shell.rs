use tauri::{command, Window};
use std::process::Command;
use tokio::process::Command as TokioCommand;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::process::Stdio;

#[command]
pub async fn shell_exec(cmd: String, args: Vec<String>) -> Result<String, String> {
    let output = Command::new(&cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Command failed (exit code: {:?}): {}", output.status.code(), stderr))
    }
}

#[command]
pub async fn shell_exec_stream(window: tauri::Window, cmd: String, args: Vec<String>) -> Result<(), String> {
    use tauri::Emitter;
    use tokio::process::Command as TokioCommand;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use std::process::Stdio;

    let mut child = TokioCommand::new(&cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    if let Some(stdout) = child.stdout.take() {
        let window_clone = window.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window_clone.emit("shell://stdout", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let window_clone = window.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window_clone.emit("shell://stderr", line);
            }
        });
    }

    let status = child.wait().await.map_err(|e| format!("Failed to wait: {}", e))?;
    window.emit("shell://exit", status.code()).ok();
    Ok(())
}
