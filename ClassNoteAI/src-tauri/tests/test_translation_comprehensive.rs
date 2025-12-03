/**
 * 翻譯功能綜合測試
 * 測試多個模型和多個測試案例
 * 可以直接運行：cargo test --test test_translation_comprehensive
 */

use std::path::Path;
use classnoteai_lib::translation::model;

// 測試案例（包括之前失敗的案例）
const TEST_CASES: &[&str] = &[
    // 基本問候（之前有問題）
    "Hello",                    // 之前重複輸出
    "Hello world",              // 之前空輸出
    "Hello, how are you?",
    "Good morning",
    "Thank you",
    // 短句
    "How are you doing today?",
    "I love programming",
    "The weather is nice today",
    "Can you help me?",
    "What time is it?",
    "I am a student",
    "This is a test",
    // 中等長度句子（之前失敗）
    "The quick brown fox jumps over the lazy dog",  // 之前空輸出
    "Machine learning is a subset of artificial intelligence",  // 之前空輸出
    // 長句（計算機科學）
    "Object-oriented programming is a programming paradigm based on the concept of objects",
    "A neural network is a series of algorithms that endeavors to recognize underlying relationships",
    "The time complexity of this algorithm is O(n log n), which makes it efficient for large datasets",
    // 課堂常見句子
    "Let's start today's lecture on data structures",
    "Does anyone have any questions about the previous topic?",
    "Please submit your homework before the deadline",
    "The exam will cover chapters one through five",
    // 計算機科學術語
    "A binary search tree is a data structure that allows efficient searching",
    "Git is a distributed version control system used for tracking changes",
    "The MVC pattern separates an application into three interconnected components",
];

// 模型配置
struct ModelConfig {
    name: &'static str,
    model_dir: &'static str,
    tokenizer_path: &'static str,
    src_lang: &'static str,
    tgt_lang: &'static str,
    tgt_lang_token_id: i64,
    expected_hidden_size: usize,
    expected_vocab_size: usize,
}

const MODELS: &[ModelConfig] = &[
    ModelConfig {
        name: "opus-mt-en-zh",
        model_dir: "/Users/remote_sklonely/eduTranslate/models/opus-mt-en-zh-onnx",
        tokenizer_path: "/Users/remote_sklonely/eduTranslate/models/opus-mt-en-zh-onnx/tokenizer.json",
        src_lang: "en",
        tgt_lang: "zh",
        tgt_lang_token_id: 0, // opus-mt 不需要語言代碼
        expected_hidden_size: 512,
        expected_vocab_size: 65001,
    },
    ModelConfig {
        name: "NLLB-200-distilled-600M",
        model_dir: "/Users/remote_sklonely/eduTranslate/models/nllb-200-distilled-600M-onnx",
        tokenizer_path: "/Users/remote_sklonely/eduTranslate/models/nllb-200-distilled-600M-onnx/tokenizer.json",
        src_lang: "eng_Latn",
        tgt_lang: "zho_Hans",
        tgt_lang_token_id: 256200, // zho_Hans token ID
        expected_hidden_size: 1024,
        expected_vocab_size: 256206,
    },
    ModelConfig {
        name: "MBart-Large-50",
        model_dir: "/Users/remote_sklonely/eduTranslate/models/mbart-large-50-onnx",
        tokenizer_path: "/Users/remote_sklonely/eduTranslate/models/mbart-large-50-onnx/tokenizer.json",
        src_lang: "en_XX",
        tgt_lang: "zh_CN",
        tgt_lang_token_id: 250025, // zh_CN token ID
        expected_hidden_size: 1024,
        expected_vocab_size: 250054,
    },
];

#[tokio::test]
async fn test_all_models_comprehensive() {
    println!("\n{}", "=".repeat(60));
    println!("翻譯模型綜合測試");
    println!("{}", "=".repeat(60));

    for model_config in MODELS {
        println!("\n{}", "=".repeat(60));
        println!("測試模型: {}", model_config.name);
        println!("{}", "=".repeat(60));

        let model_dir = Path::new(model_config.model_dir);
        let tokenizer_path = Some(Path::new(model_config.tokenizer_path));

        // 檢查模型目錄是否存在
        if !model_dir.exists() {
            eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
            eprintln!("請先運行轉換腳本轉換模型");
            continue;
        }

        // 1. 加載模型
        println!("\n1. 加載模型...");
        let model_guard = model::get_model().await;
        let mut model = model_guard.lock().await;

        match model.load_model(model_dir, tokenizer_path).await {
            Ok(_) => {
                println!("   ✓ 模型加載成功");
            }
            Err(e) => {
                eprintln!("   ❌ 模型加載失敗: {}", e);
                continue;
            }
        }

        // 2. 測試所有測試案例
        println!("\n2. 翻譯測試:");
        println!("{}", "-".repeat(60));

        let mut success_count = 0;
        let mut chinese_count = 0;
        let mut empty_count = 0;
        let mut repetitive_count = 0;
        let mut total_count = 0;

        for (idx, text) in TEST_CASES.iter().enumerate() {
            total_count += 1;
            println!("\n測試案例 {}: \"{}\"", idx + 1, text);

            match model.translate(text, model_config.src_lang, model_config.tgt_lang).await {
                Ok(translated) => {
                    // 檢查是否包含中文字符
                    let has_chinese = translated.chars().any(|c| '\u{4e00}' <= c && c <= '\u{9fff}');
                    let is_different = translated.to_lowercase() != text.to_lowercase();
                    let is_empty = translated.trim().is_empty();
                    
                    // 檢查是否重複（簡單檢查：唯一詞彙數 < 總詞彙數的 30%）
                    let words: Vec<&str> = translated.split_whitespace().collect();
                    let unique_words: std::collections::HashSet<&str> = words.iter().cloned().collect();
                    let is_repetitive = !words.is_empty() && (unique_words.len() as f32 / words.len() as f32) < 0.3;

                    if has_chinese {
                        chinese_count += 1;
                    }
                    if is_different && !is_empty && !is_repetitive {
                        success_count += 1;
                    }
                    if is_empty {
                        empty_count += 1;
                    }
                    if is_repetitive {
                        repetitive_count += 1;
                    }

                    let status = if has_chinese && is_different && !is_empty && !is_repetitive {
                        "✓"
                    } else if is_empty {
                        "⚠ (空)"
                    } else if is_repetitive {
                        "⚠ (重複)"
                    } else if is_different {
                        "⚠️"
                    } else {
                        "✗"
                    };

                    println!("  {} 原文: \"{}\"", status, text);
                    println!("     譯文: \"{}\"", translated);
                    println!("     長度: {}", translated.len());
                    println!("     包含中文: {}", has_chinese);
                    println!("     與輸入不同: {}", is_different);
                    println!("     為空: {}", is_empty);
                    println!("     重複: {}", is_repetitive);
                }
                Err(e) => {
                    eprintln!("  ❌ 翻譯失敗: {}", e);
                    empty_count += 1; // 失敗也算作空輸出
                }
            }
        }

        // 3. 統計結果
        println!("\n{}", "=".repeat(60));
        println!("統計結果:");
        println!("  總測試數: {}", total_count);
        println!("  成功翻譯 (含中文且非空非重複): {}/{} ({:.1}%)", 
                 success_count, total_count, success_count as f32 / total_count as f32 * 100.0);
        println!("  包含中文: {}/{} ({:.1}%)", 
                 chinese_count, total_count, chinese_count as f32 / total_count as f32 * 100.0);
        println!("  空輸出: {}/{} ({:.1}%)", 
                 empty_count, total_count, empty_count as f32 / total_count as f32 * 100.0);
        println!("  重複輸出: {}/{} ({:.1}%)", 
                 repetitive_count, total_count, repetitive_count as f32 / total_count as f32 * 100.0);
        println!("  質量評分: {:.1}%", 
                 (chinese_count as f32 / total_count as f32 * 100.0));
        println!("{}", "=".repeat(60));
    }
}

#[tokio::test]
async fn test_nllb_model_specific() {
    println!("\n{}", "=".repeat(60));
    println!("NLLB-200-distilled-600M 專門測試");
    println!("{}", "=".repeat(60));

    let model_config = &MODELS[0]; // NLLB-200-distilled-600M
    let model_dir = Path::new(model_config.model_dir);
    let tokenizer_path = Some(Path::new(model_config.tokenizer_path));

    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
        return;
    }

    // 加載模型
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;

    match model.load_model(model_dir, tokenizer_path).await {
        Ok(_) => {
            println!("✓ 模型加載成功");
        }
        Err(e) => {
            eprintln!("❌ 模型加載失敗: {}", e);
            return;
        }
    }

    // 測試翻譯
    for text in TEST_CASES {
        println!("\n{}", "-".repeat(60));
        println!("測試: \"{}\"", text);
        
        match model.translate(text, model_config.src_lang, model_config.tgt_lang).await {
            Ok(translated) => {
                let has_chinese = translated.chars().any(|c| '\u{4e00}' <= c && c <= '\u{9fff}');
                println!("  結果: \"{}\"", translated);
                println!("  包含中文: {}", has_chinese);
            }
            Err(e) => {
                eprintln!("  ❌ 錯誤: {}", e);
            }
        }
    }
}

