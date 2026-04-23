use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::path::PathBuf;

fn translation_model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_TRANSLATION_MODEL_DIR").map(PathBuf::from)
}

#[test]
fn test_translation_api_rejects_unloaded_translator() {
    let translator = CT2Translator::new();
    let error = translator.translate("Hello").unwrap_err();
    assert!(error.contains("Translator not loaded"));
}

#[test]
#[ignore = "manual smoke test: requires CLASSNOTEAI_TRANSLATION_MODEL_DIR"]
fn test_translation_basic() {
    let Some(model_dir) = translation_model_dir_from_env() else {
        eprintln!("skipping translation smoke test: CLASSNOTEAI_TRANSLATION_MODEL_DIR not set");
        return;
    };

    let mut translator = CT2Translator::new();
    translator
        .load_model(model_dir.to_string_lossy().as_ref())
        .expect("translation model should load");

    for text in ["Hello, how are you?", "Hello", "Hello world"] {
        let translated = translator
            .translate(text)
            .expect("translation should succeed");
        assert!(
            !translated.trim().is_empty(),
            "translation for {:?} should not be empty",
            text
        );
    }
}
