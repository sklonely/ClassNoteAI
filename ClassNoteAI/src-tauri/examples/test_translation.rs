/**
 * 獨立的 Rust 翻譯測試程序
 * 可以直接運行：cargo run --example test_translation
 * 
 * 使用方法：
 * cd ClassNoteAI/src-tauri
 * cargo run --example test_translation
 */

use std::path::PathBuf;

// 直接導入翻譯模型模塊
#[path = "../src/translation/mod.rs"]
mod translation;

use translation::model;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", "=".repeat(80));
    println!("Rust ONNX 翻譯測試");
    println!("{}", "=".repeat(80));
    
    // 模型目錄
    let model_dir = PathBuf::from("../../models/opus-mt-en-zh-onnx");
    
    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
        eprintln!("請確保模型已下載到: {:?}", model_dir);
        return Err("模型目錄不存在".into());
    }
    
    println!("\n[Rust] 模型目錄: {:?}", model_dir);
    
    // 測試文本
    let test_texts = vec![
        "Hello",
        "Hello world",
        "Hello, how are you?",
        "Good morning",
        "Thank you",
        "I love you",
        "What is your name?",
        "How are you doing today?",
        "The weather is nice today.",
        "This is a test sentence for translation comparison.",
    ];
    
    // 加載模型
    println!("\n[Rust] 加載翻譯模型...");
    let model_guard = model::get_model().await;
    let mut model_instance = model_guard.lock().await;
    
    // 自動查找 tokenizer
    let tokenizer_path = model_dir.join("tokenizer.json");
    let tokenizer_path_opt = if tokenizer_path.exists() {
        Some(tokenizer_path.as_path())
    } else {
        None
    };
    
    match model_instance.load_model(&model_dir, tokenizer_path_opt).await {
        Ok(_) => {
            println!("[Rust] ✓ 模型加載成功");
            if !model_instance.is_tokenizer_loaded() {
                println!("[Rust] ⚠ 警告：Tokenizer 未加載");
            }
        }
        Err(e) => {
            eprintln!("[Rust] ❌ 模型加載失敗: {}", e);
            return Err(e.into());
        }
    }
    
    // 測試翻譯
    println!("\n{}", "=".repeat(80));
    println!("開始翻譯測試");
    println!("{}", "=".repeat(80));
    
    let mut results = Vec::new();
    
    for (i, text) in test_texts.iter().enumerate() {
        println!("\n{}", "=".repeat(80));
        println!("測試 {}: '{}'", i + 1, text);
        println!("{}", "=".repeat(80));
        
        match model_instance.translate(text, "en", "zh").await {
            Ok(translated) => {
                let has_chinese = translated.chars().any(|c| '\u{4e00}' <= c && c <= '\u{9fff}');
                let success = !translated.trim().is_empty();
                
                println!("[Rust] 翻譯結果: '{}'", translated);
                println!("[Rust] 狀態: {} {}", 
                    if success { "✓" } else { "✗" },
                    if has_chinese { "(含中文)" } else { "(無中文)" }
                );
                
                results.push(serde_json::json!({
                    "text": text,
                    "result": translated,
                    "success": success,
                    "has_chinese": has_chinese,
                }));
            }
            Err(e) => {
                eprintln!("[Rust] ❌ 翻譯失敗: {}", e);
                results.push(serde_json::json!({
                    "text": text,
                    "result": null,
                    "success": false,
                    "has_chinese": false,
                    "error": e.to_string(),
                }));
            }
        }
    }
    
    // 打印總結
    println!("\n{}", "=".repeat(80));
    println!("測試總結");
    println!("{}", "=".repeat(80));
    
    let success_count = results.iter().filter(|r| r["success"].as_bool().unwrap_or(false)).count();
    let chinese_count = results.iter().filter(|r| r["has_chinese"].as_bool().unwrap_or(false)).count();
    
    println!("成功翻譯: {}/{}", success_count, results.len());
    println!("含中文: {}/{}", chinese_count, results.len());
    
    println!("\n詳細結果:");
    for (i, r) in results.iter().enumerate() {
        let text = r["text"].as_str().unwrap_or("");
        let result = r["result"].as_str().unwrap_or("(無結果)");
        let success = r["success"].as_bool().unwrap_or(false);
        let has_chinese = r["has_chinese"].as_bool().unwrap_or(false);
        
        let status = if success { "✓" } else { "✗" };
        let chinese_mark = if has_chinese { "(含中文)" } else { "(無中文)" };
        println!("{}. '{}' → '{}' {} {}", i + 1, text, result, status, chinese_mark);
    }
    
    // 保存結果
    let output_file = PathBuf::from("../../scripts/rust_translation_results.json");
    if let Ok(json_str) = serde_json::to_string_pretty(&results) {
        if let Err(e) = std::fs::write(&output_file, json_str) {
            eprintln!("[Rust] ⚠ 保存結果失敗: {}", e);
        } else {
            println!("\n[Rust] 結果已保存到: {:?}", output_file);
        }
    }
    
    Ok(())
}

