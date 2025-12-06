/**
 * Rust ONNX 翻譯測試腳本
 * 用於與 Python 腳本比較翻譯結果
 * 
 * 使用方法：
 * cargo run --bin test_translation_rust -- --model-dir <模型目錄> --text "Hello world"
 */

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use clap::Parser;

// 導入翻譯模型模塊（需要從 src-tauri/src/translation/model.rs 複製相關代碼）
// 或者直接使用 Tauri 命令

#[derive(Parser, Debug)]
#[command(name = "test_translation_rust")]
#[command(about = "測試 Rust ONNX 翻譯實現")]
struct Args {
    /// 模型目錄路徑
    #[arg(long, default_value = "models/opus-mt-en-zh-onnx")]
    model_dir: String,
    
    /// 要翻譯的文本
    #[arg(long)]
    text: String,
    
    /// 測試多個文本（JSON 數組格式）
    #[arg(long)]
    texts: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    
    println!("=".repeat(80));
    println!("Rust ONNX 翻譯測試");
    println!("=".repeat(80));
    
    let model_dir = PathBuf::from(&args.model_dir);
    
    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
        return Err("模型目錄不存在".into());
    }
    
    // 測試文本列表
    let test_texts: Vec<String> = if let Some(texts_json) = args.texts {
        serde_json::from_str(&texts_json)?
    } else if !args.text.is_empty() {
        vec![args.text]
    } else {
        vec![
            "Hello".to_string(),
            "Hello world".to_string(),
            "Hello, how are you?".to_string(),
            "Good morning".to_string(),
            "Thank you".to_string(),
        ]
    };
    
    // 注意：這裡需要實際的翻譯模型實現
    // 由於翻譯模型代碼在 src-tauri/src/translation/model.rs 中
    // 我們需要通過 Tauri 命令來調用，或者將相關代碼提取到這裡
    
    println!("\n注意：此腳本需要實際的翻譯模型實現");
    println!("建議：通過 Tauri 命令調用翻譯功能，或將 model.rs 中的代碼提取到這裡");
    
    // 示例：如何調用翻譯（需要實際實現）
    /*
    use translation::model;
    
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;
    
    // 加載模型
    model.load_model(&model_dir, None).await?;
    
    // 翻譯每個文本
    for text in test_texts {
        println!("\n翻譯文本: '{}'", text);
        match model.translate(&text, "en", "zh").await {
            Ok(translated) => {
                let has_chinese = translated.chars().any(|c| '\u{4e00}' <= c && c <= '\u{9fff}');
                println!("  結果: '{}' {}", translated, if has_chinese { "(含中文)" } else { "(無中文)" });
            }
            Err(e) => {
                println!("  錯誤: {}", e);
            }
        }
    }
    */
    
    Ok(())
}


