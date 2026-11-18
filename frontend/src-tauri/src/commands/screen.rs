use tauri::command;
use xcap::Monitor;
use image::ImageEncoder;
use base64::{Engine as _, engine::general_purpose};
use std::io::Cursor;

#[command]
pub async fn screen_capture() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    let mut buffer = Cursor::new(Vec::new());
    image.write_to(&mut buffer, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(buffer.into_inner());
    Ok(format!("data:image/png;base64,{}", b64))
}
