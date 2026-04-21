use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

fn validate_channel(channel: &str) -> Result<(), String> {
    match channel {
        "stable" | "beta" | "alpha" => Ok(()),
        _ => Err(format!("invalid update channel: {}", channel)),
    }
}

fn updater_target() -> Option<String> {
    match crate::gpu::get_build_variant() {
        "cuda" => Some("windows-x86_64-cuda".to_string()),
        "vulkan" => Some("windows-x86_64-vulkan".to_string()),
        _ => None,
    }
}

fn build_updater(app: &AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    validate_channel(channel)?;

    let mut builder = app.updater_builder();
    if let Some(target) = updater_target() {
        builder = builder.target(target);
    }

    let endpoint = format!(
        "https://sklonely.github.io/ClassNoteAI/updater/{}/latest.json",
        channel
    )
    .parse()
    .map_err(|e| format!("{}", e))?;

    builder
        .endpoints(vec![endpoint])
        .map_err(|e| format!("{}", e))?
        .build()
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
pub async fn check_update_for_channel(
    app: AppHandle,
    channel: String,
) -> Result<UpdateCheckResult, String> {
    let updater = build_updater(&app, &channel)?;
    let update = updater.check().await.map_err(|e| format!("{}", e))?;

    Ok(match update {
        Some(update) => UpdateCheckResult {
            available: true,
            version: Some(update.version),
            notes: update.body,
            date: update.date.map(|date| date.to_string()),
        },
        None => UpdateCheckResult {
            available: false,
            version: None,
            notes: None,
            date: None,
        },
    })
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    channel: String,
) -> Result<(), String> {
    let updater = build_updater(&app, &channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("{}", e))?
        .ok_or_else(|| "No update available.".to_string())?;

    update
        .download_and_install(
            |chunk_length, content_length| {
                let _ = app.emit(
                    "update-progress",
                    json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length,
                    }),
                );
            },
            || {
                let _ = app.emit("update-finished", json!({}));
            },
        )
        .await
        .map_err(|e| format!("{}", e))?;

    app.restart();
}
