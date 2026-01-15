use tauri::command;
use std::path::Path;
use reqwest::multipart;
use tokio::fs;
use tokio::io::AsyncWriteExt; // For write_all? No, fs::write handles it. 
// For streaming downloading we might need io traits if we implementing streaming but for now allow simple fs::write.

#[command]
pub async fn upload_file(server_url: String, file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    let filename = path.file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    let content = fs::read(&path).await.map_err(|e| e.to_string())?;
    
    // Create multipart form
    let part = multipart::Part::bytes(content)
        .file_name(filename.clone());
        
    let form = multipart::Form::new()
        .part("file", part);

    let client = reqwest::Client::new();
    let res = client.post(format!("{}/api/files/upload", server_url))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Upload failed: {}", res.status()));
    }
    
    Ok(filename)
}

#[command]
pub async fn download_file(url: String, save_path: String) -> Result<(), String> {
    let res = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err(format!("Download failed: {}", res.status()));
    }
    
    let content = res.bytes().await.map_err(|e| e.to_string())?;
    
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&save_path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
    }

    fs::write(save_path, content).await.map_err(|e| e.to_string())?;
    
    Ok(())
}
