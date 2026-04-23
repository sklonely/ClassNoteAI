use classnoteai_lib::translation::ctranslate2::CT2Translator;
use std::path::PathBuf;

fn translation_model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("CLASSNOTEAI_TRANSLATION_MODEL_DIR").map(PathBuf::from)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", "=".repeat(80));
    println!("Rust NLLB / CT2 Translation Test");
    println!("{}", "=".repeat(80));

    let Some(model_dir) = translation_model_dir_from_env() else {
        println!("Set CLASSNOTEAI_TRANSLATION_MODEL_DIR to run this example.");
        return Ok(());
    };

    println!("\n[Rust] Loading translation model from {:?}", model_dir);
    let mut translator = CT2Translator::new();
    translator.load_model(model_dir.to_string_lossy().as_ref())?;

    let text = "Hello world";
    println!("\nTranslating: '{}'", text);
    let result = translator.translate_batch(&[text.to_string()], Some("zh"), Some("en"))?;
    println!("Result: {}", result.first().cloned().unwrap_or_default());

    Ok(())
}
