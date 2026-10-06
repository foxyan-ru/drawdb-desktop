use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagramFile {
    pub path: String,
    pub name: String,
    pub modified: String,
}

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn list_diagrams(app: tauri::AppHandle) -> Result<Vec<DiagramFile>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("diagrams");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("ddb") {
            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
            let modified = metadata
                .modified()
                .map(|t| {
                    let datetime: chrono::DateTime<chrono::Local> = t.into();
                    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                })
                .unwrap_or_default();

            files.push(DiagramFile {
                path: path.to_string_lossy().to_string(),
                name: path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
                modified,
            });
        }
    }

    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

#[tauri::command]
fn save_diagram(app: tauri::AppHandle, name: &str, data: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("diagrams");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(format!("{}.ddb", name));
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_diagram(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_diagram(path: &str) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_to_path(path: &str, data: &str) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, data).map_err(|e| e.to_string())
}

/// Binary counterpart to `save_to_path`, used for PNG/PDF diagram exports.
/// Custom commands like this bypass the fs plugin's ACL scope system entirely
/// (only the fs plugin's own JS-exposed commands are scope-checked), so this
/// works for any user-chosen save path — including ones outside the
/// appdata/document/home/desktop roots the fs plugin capabilities are scoped to.
#[tauri::command]
fn write_binary_to_path(path: &str, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_from_path(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recent_files(app: tauri::AppHandle) -> Result<Vec<DiagramFile>, String> {
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recent.json");

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_recent_file(app: tauri::AppHandle, file: DiagramFile) -> Result<(), String> {
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recent.json");

    let mut files: Vec<DiagramFile> = if config_path.exists() {
        let data = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    };

    files.retain(|f| f.path != file.path);
    files.insert(0, file);
    files.truncate(10);

    let data = serde_json::to_string_pretty(&files).map_err(|e| e.to_string())?;
    fs::write(&config_path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, data: &str) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");

    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            get_app_data_dir,
            list_diagrams,
            save_diagram,
            load_diagram,
            delete_diagram,
            save_to_path,
            write_binary_to_path,
            read_from_path,
            get_recent_files,
            add_recent_file,
            save_settings,
            load_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DrawDB");
}
