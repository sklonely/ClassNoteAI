use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use crate::{AppState, db::Device};
use chrono::Utc;

#[derive(Deserialize)]
pub struct RegisterDeviceRequest {
    pub id: String,
    pub username: String,
    pub name: String,
    pub platform: String,
}

#[derive(Deserialize)]
pub struct GetDevicesQuery {
    pub username: String,
}

pub async fn register_device(
    State(state): State<AppState>,
    Json(req): Json<RegisterDeviceRequest>,
) -> Result<StatusCode, StatusCode> {
    let db = state.db.lock().await;

    // Ensure user exists first (optional but good practice)
    if let Err(e) = db.create_user(&req.username) {
        tracing::error!("Failed to ensure user exists: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let now = Utc::now().to_rfc3339();
    
    let device = Device {
        id: req.id,
        username: req.username,
        name: req.name,
        platform: req.platform,
        last_seen: now.clone(),
        created_at: now, // Simplification: in upsert we might overwrite created_at if we don't fetch first, but for now this refreshes it or we can ignore it in SQL if exists.
        // Actually, my SQL update sets last_seen but not created_at, so this is fine.
    };

    if let Err(e) = db.register_device(&device) {
        tracing::error!("Failed to register device: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}

pub async fn get_devices(
    State(state): State<AppState>,
    Query(query): Query<GetDevicesQuery>,
) -> Result<Json<Vec<Device>>, StatusCode> {
    let db = state.db.lock().await;

    match db.get_devices(&query.username) {
        Ok(devices) => Ok(Json(devices)),
        Err(e) => {
            tracing::error!("Failed to get devices: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_device(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state.db.lock().await;

    if let Err(e) = db.delete_device(&id) {
        tracing::error!("Failed to delete device: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}
