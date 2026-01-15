use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Deserialize)]
pub struct AuthRequest {
    pub username: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub message: String,
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let db = state.db.lock().await;

    // Check if user exists
    if let Ok(Some(_)) = db.get_user(&req.username) {
        return Ok(Json(AuthResponse {
            success: false,
            message: "Username already exists".to_string(),
        }));
    }

    // Create user
    match db.create_user(&req.username) {
        Ok(_) => Ok(Json(AuthResponse {
            success: true,
            message: "User registered successfully".to_string(),
        })),
        Err(e) => {
            tracing::error!("Failed to register user: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let db = state.db.lock().await;

    // Check if user exists
    match db.get_user(&req.username) {
        Ok(Some(_)) => Ok(Json(AuthResponse {
            success: true,
            message: "Login successful".to_string(),
        })),
        Ok(None) => Ok(Json(AuthResponse {
            success: false,
            message: "User not found".to_string(),
        })),
        Err(e) => {
            tracing::error!("Failed to login check: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
