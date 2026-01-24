use tauri::State;
use crate::parakeet::ParakeetService;
use std::sync::Arc;

#[tauri::command]
pub async fn load_parakeet_model(
    model_path: String,
    tokenizer_path: String,
    service: State<'_, Arc<ParakeetService>>
) -> Result<String, String> {
    service
        .load_model(&model_path, &tokenizer_path)
        .await
        .map_err(|e| e.to_string())?;
        
    Ok("Parakeet model loaded successfully".to_string())
}

#[tauri::command]
pub async fn transcribe_parakeet(
    audio_data: Vec<i16>,
    service: State<'_, Arc<ParakeetService>>
) -> Result<String, String> {
    service
        .transcribe(&audio_data)
        .await
        .map_err(|e| e.to_string())
}
