use axum::{
    extract::Multipart,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use std::path::PathBuf;
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;

const UPLOAD_DIR: &str = "uploads";

pub async fn upload_file(mut multipart: Multipart) -> Result<impl IntoResponse, StatusCode> {
    // Ensure upload dir exists
    if !fs::try_exists(UPLOAD_DIR).await.unwrap_or(false) {
        fs::create_dir_all(UPLOAD_DIR).await.map_err(|e| {
            tracing::error!("Failed to create upload dir: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Failed to read multipart field: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        let name = field.name().unwrap_or("").to_string();
        
        if name == "file" {
            let file_name = field.file_name().unwrap_or("unknown_file").to_string();
            // Sanitize filename to prevent directory traversal
            let file_name = std::path::Path::new(&file_name)
                .file_name()
                .ok_or(StatusCode::BAD_REQUEST)?
                .to_string_lossy()
                .to_string();

            let data = field.bytes().await.map_err(|e| {
                tracing::error!("Failed to read file bytes: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            
            let file_path = PathBuf::from(UPLOAD_DIR).join(&file_name);
            let mut file = File::create(&file_path).await.map_err(|e| {
                tracing::error!("Failed to create file {}: {}", file_path.display(), e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            file.write_all(&data).await.map_err(|e| {
                tracing::error!("Failed to write to file {}: {}", file_path.display(), e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            
            tracing::info!("File uploaded successfully: {}", file_name);
            return Ok(Json(json!({ "filename": file_name, "status": "ok" })));
        }
    }

    Err(StatusCode::BAD_REQUEST)
}
