use classnoteai_lib::{transcribe, WhisperModel};
use std::path::PathBuf;

fn whisper_model_path_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_WHISPER_MODEL_PATH").map(PathBuf::from)
}

#[tokio::test]
async fn test_missing_whisper_model_returns_error() {
    let missing = format!(
        "/tmp/classnoteai-missing-whisper-model-{}.bin",
        uuid::Uuid::new_v4()
    );
    let error = match WhisperModel::load(&missing).await {
        Ok(_) => panic!("missing model path should not load successfully"),
        Err(error) => error,
    };
    assert!(error.to_string().contains("模型文件不存在"));
}

#[tokio::test]
#[ignore = "manual smoke test: requires CLASSNOTEAI_WHISPER_MODEL_PATH"]
async fn test_model_loading() {
    let Some(model_path) = whisper_model_path_from_env() else {
        eprintln!("skipping whisper smoke test: CLASSNOTEAI_WHISPER_MODEL_PATH not set");
        return;
    };

    let model = WhisperModel::load(model_path.to_string_lossy().as_ref())
        .await
        .expect("whisper model should load");
    assert_eq!(model.get_model_path(), model_path.to_string_lossy());
}

#[tokio::test]
#[ignore = "manual smoke test: requires CLASSNOTEAI_WHISPER_MODEL_PATH"]
async fn test_transcription_with_silence() {
    let Some(model_path) = whisper_model_path_from_env() else {
        eprintln!(
            "skipping whisper transcription smoke test: CLASSNOTEAI_WHISPER_MODEL_PATH not set"
        );
        return;
    };

    let model = WhisperModel::load(model_path.to_string_lossy().as_ref())
        .await
        .expect("whisper model should load");

    let sample_rate = 16_000u32;
    let duration_seconds = 2u32;
    let audio_data: Vec<i16> = vec![0i16; (sample_rate * duration_seconds) as usize];

    let transcription =
        transcribe::transcribe_audio(&model, &audio_data, sample_rate, None, None, None)
            .await
            .expect("transcription should succeed");

    assert!(transcription.text.trim().is_empty() || transcription.text.len() < 10);
}

#[tokio::test]
#[ignore = "manual smoke test: requires CLASSNOTEAI_WHISPER_MODEL_PATH"]
async fn test_transcription_with_initial_prompt() {
    let Some(model_path) = whisper_model_path_from_env() else {
        eprintln!("skipping whisper prompt smoke test: CLASSNOTEAI_WHISPER_MODEL_PATH not set");
        return;
    };

    let model = WhisperModel::load(model_path.to_string_lossy().as_ref())
        .await
        .expect("whisper model should load");
    let sample_rate = 16_000u32;
    let duration_seconds = 2u32;
    let audio_data: Vec<i16> = vec![0i16; (sample_rate * duration_seconds) as usize];
    let initial_prompt = Some("ClassNote AI, Tauri, React, TypeScript, transcription, lecture");

    let _transcription =
        transcribe::transcribe_audio(&model, &audio_data, sample_rate, initial_prompt, None, None)
            .await
            .expect("transcription with initial prompt should succeed");
}
