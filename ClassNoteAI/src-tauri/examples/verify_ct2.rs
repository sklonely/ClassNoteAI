use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Rust CT2 Verification");
    println!("=====================");

    let model_dir = "../src-tauri/models/m2m100-418M-ct2-int8";
    let abs_model_dir = std::fs::canonicalize(model_dir)?;
    println!("Model Path: {:?}", abs_model_dir);

    // Initialize Translator
    let mut translator = CT2Translator::new();
    
    // Load Model
    println!("Loading model...");
    translator.load_model(abs_model_dir.to_str().unwrap())?;
    println!("Model loaded successfully!");

    // Test sentences
    let texts = vec![
        "Hello world",
        "This is a test sentence.",
        "Machine learning is fascinating.",
        "How are you doing today?"
    ];

    println!("\nTranslating {} sentences...", texts.len());

    // Translate
    let results = translator.translate_batch(&texts.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;

    for (i, (text, translation)) in texts.iter().zip(results.iter()).enumerate() {
        println!("\nTest {}:", i + 1);
        println!("Source: {}", text);
        println!("Target: {}", translation);
    }

    Ok(())
}
