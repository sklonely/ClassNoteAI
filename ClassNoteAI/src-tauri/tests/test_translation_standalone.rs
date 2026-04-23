use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::path::PathBuf;

fn translation_model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_TRANSLATION_MODEL_DIR").map(PathBuf::from)
}

#[test]
fn test_ct2_translator_starts_unloaded() {
    let translator = CT2Translator::new();
    assert!(!translator.is_loaded());
}

#[test]
fn test_ct2_missing_model_path_returns_error() {
    let mut translator = CT2Translator::new();
    let missing = format!("/tmp/classnoteai-missing-model-{}", uuid::Uuid::new_v4());

    let error = translator.load_model(&missing).unwrap_err();
    assert!(error.contains("Model path does not exist"));
}

#[test]
#[ignore = "manual smoke test: requires CLASSNOTEAI_TRANSLATION_MODEL_DIR"]
fn test_translation_model_manual_smoke() {
    let Some(model_dir) = translation_model_dir_from_env() else {
        eprintln!("skipping smoke test: CLASSNOTEAI_TRANSLATION_MODEL_DIR not set");
        return;
    };

    let mut translator = CT2Translator::new();
    translator
        .load_model(model_dir.to_string_lossy().as_ref())
        .expect("translation model should load");

    let translated = translator
        .translate("Hello world")
        .expect("translation should succeed");
    assert!(!translated.trim().is_empty());
}
