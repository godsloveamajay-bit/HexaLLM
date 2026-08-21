use tauri::command;
use std::path::{Path, PathBuf};
use tokio::fs;

#[command]
pub async fn fs_read(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    if !path.is_file() {
        return Err("Path is not a file".to_string());
    }
    fs::read_to_string(path).await.map_err(|e| e.to_string())
}

#[command]
pub async fn fs_write(path: String, content: String) -> Result<(), String> {
    let path = Path::new(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    fs::write(path, content).await.map_err(|e| e.to_string())
}

#[command]
pub async fn fs_append(path: String, content: String) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let path = Path::new(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).await.map_err(|e| e.to_string())
}

#[command]
pub async fn fs_list(path: String) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut entries = Vec::new();
    let mut dir = fs::read_dir(path).await.map_err(|e| e.to_string())?;
    while let Some(entry) = dir.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        let metadata = entry.metadata().await.map_err(|e| e.to_string())?;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()),
        });
    }
    Ok(entries)
}

#[command]
pub async fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).await.map_err(|e| e.to_string())
}

#[command]
pub async fn fs_remove(path: String, recursive: bool) -> Result<(), String> {
    let path = Path::new(&path);
    if recursive {
        fs::remove_dir_all(path).await.map_err(|e| e.to_string())
    } else {
        if path.is_dir() {
            fs::remove_dir(path).await.map_err(|e| e.to_string())
        } else {
            fs::remove_file(path).await.map_err(|e| e.to_string())
        }
    }
}

#[command]
pub async fn fs_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}
