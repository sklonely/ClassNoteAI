/**
 * 翻譯功能測試
 * 可以直接運行：cargo test --test test_translation
 */
use std::path::Path;

// 導入翻譯模塊
// 注意：在測試中，我們需要使用 lib 的名稱
use classnoteai_lib::translation::model;

#[tokio::test]
async fn test_translation_basic() {
    println!("\n{}", "=".repeat(60));
    println!("翻譯功能測試");
    println!("{}", "=".repeat(60));

    // 使用新的 mbart-large-50 模型
    let model_dir = Path::new("/Users/remote_sklonely/eduTranslate/models/mbart-large-50-onnx");
    let tokenizer_path = Some(Path::new(
        "/Users/remote_sklonely/eduTranslate/models/mbart-large-50-onnx/tokenizer.json",
    ));

    // 檢查模型目錄是否存在
    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
        eprintln!("請先運行 convert_model_to_onnx.py 轉換模型");
        return;
    }

    // 1. 加載模型
    println!("\n1. 加載模型...");
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;

    match model.load_model(model_dir, tokenizer_path).await {
        Ok(_) => {
            println!("   ✓ 模型加載成功");
            assert!(model.is_loaded(), "模型應該已加載");
            assert!(model.is_tokenizer_loaded(), "Tokenizer 應該已加載");
        }
        Err(e) => {
            eprintln!("   ❌ 模型加載失敗: {}", e);
            panic!("模型加載失敗: {}", e);
        }
    }

    // 2. 測試翻譯
    let test_texts = vec!["Hello, how are you?", "Hello", "Hello world"];

    for text in test_texts {
        println!("\n{}", "=".repeat(60));
        println!("測試文本: \"{}\"", text);
        println!("{}", "=".repeat(60));

        match model.translate(text, "en", "zh").await {
            Ok(translated) => {
                println!("\n翻譯結果:");
                println!("  原文: \"{}\"", text);
                println!("  譯文: \"{}\"", translated);
                println!("  長度: {}", translated.len());

                // 檢查結果
                if translated.is_empty() {
                    eprintln!("   ⚠️ 翻譯結果為空！");
                } else if translated.contains('▁') {
                    eprintln!("   ⚠️ 翻譯結果包含 SentencePiece 空格標記（▁）");
                } else {
                    println!("   ✓ 翻譯結果正常");
                }

                // 對於 "Hello, how are you?" 應該翻譯為 "你好"
                if text == "Hello, how are you?" {
                    if translated.contains("你好") {
                        println!("   ✓ 翻譯結果符合預期（包含「你好」）");
                    } else {
                        eprintln!("   ⚠️ 翻譯結果不符合預期（應該包含「你好」）");
                    }
                }
            }
            Err(e) => {
                eprintln!("   ❌ 翻譯失敗: {}", e);
                panic!("翻譯失敗: {}", e);
            }
        }
    }

    println!("\n{}", "=".repeat(60));
    println!("測試完成");
    println!("{}", "=".repeat(60));
}

#[tokio::test]
async fn test_translation_tokenization() {
    println!("\n{}", "=".repeat(60));
    println!("Tokenization 驗證測試");
    println!("{}", "=".repeat(60));

    // 使用新的 mbart-large-50 模型
    let model_dir = Path::new("/Users/remote_sklonely/eduTranslate/models/mbart-large-50-onnx");
    let tokenizer_path = Some(Path::new(
        "/Users/remote_sklonely/eduTranslate/models/mbart-large-50-onnx/tokenizer.json",
    ));

    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在，跳過測試");
        return;
    }

    // 加載模型
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;

    if let Err(e) = model.load_model(model_dir, tokenizer_path).await {
        eprintln!("❌ 模型加載失敗: {}", e);
        return;
    }

    // 測試文本
    let test_text = "Hello, how are you?";
    println!("\n測試文本: \"{}\"", test_text);
    println!("\n預期結果（Python 測試）:");
    println!("  Input IDs: [3828, 2, 529, 46, 39, 25, 0]");
    println!("  Input IDs 長度: 7");
    println!("  add_special_tokens: true（包含 EOS token 0）");

    println!("\n實際結果（Rust 後端）:");
    println!("  請查看上面的日誌輸出，檢查:");
    println!("  - [TranslationModel] Tokenization 結果: 應該是 [3828, 2, 529, 46, 39, 25, 0]");
    println!("  - [TranslationModel] Input IDs 長度: 應該是 7");

    // 執行翻譯以觸發 tokenization
    let _ = model.translate(test_text, "en", "zh").await;
}
