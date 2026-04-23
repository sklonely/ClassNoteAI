use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::path::PathBuf;

const TEST_CASES: &[&str] = &[
    "Hello",
    "Hello world",
    "Hello, how are you?",
    "Good morning",
    "Thank you",
    "How are you doing today?",
    "I love programming",
    "The weather is nice today",
    "Can you help me?",
    "What time is it?",
    "I am a student",
    "This is a test",
    "The quick brown fox jumps over the lazy dog",
    "Machine learning is a subset of artificial intelligence",
];

fn translation_model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_TRANSLATION_MODEL_DIR").map(PathBuf::from)
}

#[test]
#[ignore = "manual comprehensive suite: requires CLASSNOTEAI_TRANSLATION_MODEL_DIR"]
fn test_translation_model_comprehensive_suite() {
    let Some(model_dir) = translation_model_dir_from_env() else {
        eprintln!("skipping comprehensive suite: CLASSNOTEAI_TRANSLATION_MODEL_DIR not set");
        return;
    };

    let mut translator = CT2Translator::new();
    translator
        .load_model(model_dir.to_string_lossy().as_ref())
        .expect("translation model should load");

    for text in TEST_CASES {
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
