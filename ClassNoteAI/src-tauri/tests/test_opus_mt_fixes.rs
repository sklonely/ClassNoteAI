use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::collections::HashSet;
use std::path::PathBuf;

const CRITICAL_TEST_CASES: &[&str] = &[
    "Hello",
    "Hello world",
    "The quick brown fox jumps over the lazy dog",
    "Machine learning is a subset of artificial intelligence",
];

fn translation_model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_TRANSLATION_MODEL_DIR").map(PathBuf::from)
}

fn repetitive_ratio(text: &str) -> f32 {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return 1.0;
    }
    let unique: HashSet<&str> = words.iter().copied().collect();
    unique.len() as f32 / words.len() as f32
}

#[test]
#[ignore = "manual regression suite: requires CLASSNOTEAI_TRANSLATION_MODEL_DIR"]
fn test_opus_mt_regressions_do_not_return_empty_or_heavily_repetitive_output() {
    let Some(model_dir) = translation_model_dir_from_env() else {
        eprintln!("skipping regression suite: CLASSNOTEAI_TRANSLATION_MODEL_DIR not set");
        return;
    };

    let mut translator = CT2Translator::new();
    translator
        .load_model(model_dir.to_string_lossy().as_ref())
        .expect("translation model should load");

    for text in CRITICAL_TEST_CASES {
        let translated = translator
            .translate(text)
            .expect("translation should succeed");
        assert!(
            !translated.trim().is_empty(),
            "translation for {:?} should not be empty",
            text
        );
        assert!(
            repetitive_ratio(&translated) >= 0.3,
            "translation for {:?} still looks repetitive: {:?}",
            text,
            translated
        );
    }
}
