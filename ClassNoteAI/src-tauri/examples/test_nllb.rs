/**
 * NLLB 模型測試
 *
 * 測試 NLLB-200-distilled-600M 的加載和推理
 */
use std::path::PathBuf;

// 直接導入翻譯模型模塊
#[path = "../src/translation/mod.rs"]
mod translation;

use translation::model;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", "=".repeat(80));
    println!("Rust NLLB 翻譯測試");
    println!("{}", "=".repeat(80));

    // 模型目錄
    let model_dir = PathBuf::from("../../models/nllb-200-distilled-600M-onnx-quantized");

    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
        return Err("模型目錄不存在".into());
    }

    println!("\n[Rust] 加載翻譯模型...");
    let model_guard = model::get_model().await;
    let mut model_instance = model_guard.lock().await;

    match model_instance.load_model(&model_dir, None).await {
        Ok(_) => {
            println!("[Rust] ✓ 模型加載成功");
        }
        Err(e) => {
            eprintln!("[Rust] ❌ 模型加載失敗: {}", e);
            return Err(e.into());
        }
    }

    // 測試文本
    let text = "Hello world";

    println!("\n翻譯: '{}'", text);
    // NLLB 需要指定語言代碼：eng_Latn -> zho_Hans
    match model_instance.translate(text, "eng_Latn", "zho_Hans").await {
        Ok(result) => println!("結果: {}", result),
        Err(e) => eprintln!("錯誤: {}", e),
    }

    Ok(())
}
