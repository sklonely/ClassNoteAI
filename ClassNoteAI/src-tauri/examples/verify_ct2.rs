use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::path::PathBuf;

fn translation_model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_TRANSLATION_MODEL_DIR").map(PathBuf::from)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Rust CT2 Verification");
    println!("=====================");

    let Some(model_dir) = translation_model_dir_from_env() else {
        println!("Set CLASSNOTEAI_TRANSLATION_MODEL_DIR to run this example.");
        return Ok(());
    };

    println!("Model Path: {:?}", model_dir);

    let mut translator = CT2Translator::new();
    println!("Loading model...");
    translator.load_model(model_dir.to_string_lossy().as_ref())?;
    println!("Model loaded successfully!");

    let texts = vec![
        "Hello world".to_string(),
        "This is a test sentence.".to_string(),
        "Machine learning is fascinating.".to_string(),
        "How are you doing today?".to_string(),
    ];

    println!("\nTranslating {} sentences...", texts.len());
    let results = translator.translate_batch(&texts, None, None)?;

    for (i, (text, translation)) in texts.iter().zip(results.iter()).enumerate() {
        println!("\nTest {}:", i + 1);
        println!("Source: {}", text);
        println!("Target: {}", translation);
    }

    Ok(())
}
