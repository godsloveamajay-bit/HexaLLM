use tauri::command;
use enigo::{Enigo, Keyboard, Mouse, Settings, Key, Button, Coordinate, Axis, Direction};

#[command]
pub async fn input_type_text(text: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn input_key(key: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let k = match key.to_lowercase().as_str() {
        "enter" => Key::Return,
        "tab" => Key::Tab,
        "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "space" => Key::Space,
        other => {
            if other.len() == 1 {
                Key::Unicode(other.chars().next().unwrap())
            } else {
                return Err(format!("Unknown key: {}", key));
            }
        }
    };
    enigo.key(k, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn mouse_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn mouse_click(button: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let btn = match button.to_lowercase().as_str() {
        "left" => Button::Left,
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => return Err(format!("Unknown button: {}", button)),
    };
    enigo.button(btn, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn mouse_scroll(delta: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.scroll(delta, Axis::Vertical).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn devices_list() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("lsusb")
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("system_profiler")
            .args(&["SPUSBDataType"])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&["-Command", "Get-PnpDevice -Class USB | Select-Object FriendlyName,Status | Format-Table -AutoSize"])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Ok("Unsupported platform".to_string())
    }
}
