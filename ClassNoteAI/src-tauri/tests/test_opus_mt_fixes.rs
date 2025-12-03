/**
 * opus-mt-en-zh 修復效果測試
 * 專門測試修復後的模型，驗證重複循環檢測、Repetition Penalty 等修復是否有效
 */

use std::path::Path;
use classnoteai_lib::translation::model;

// 重點測試案例（之前有問題的）
const CRITICAL_TEST_CASES: &[&str] = &[
    "Hello",                    // 之前重複輸出
    "Hello world",              // 之前空輸出
    "The quick brown fox jumps over the lazy dog",  // 之前空輸出
    "Machine learning is a subset of artificial intelligence",  // 之前空輸出
];

// 完整測試案例
const ALL_TEST_CASES: &[&str] = &[
    // 基本問候
    "Hello",
    "Hello world",
    "Hello, how are you?",
    "Good morning",
    "Thank you",
    // 短句
    "I am a student",
    "This is a test",
    "Can you help me?",
    // 中等長度
    "The weather is nice today",
    "I love programming",
    "How are you doing today?",
    // 長句（之前失敗的）
    "The quick brown fox jumps over the lazy dog",
    "Machine learning is a subset of artificial intelligence",
    // 長句（計算機科學）
    "Object-oriented programming is a programming paradigm based on the concept of objects",
    "A neural network is a series of algorithms that endeavors to recognize underlying relationships",
    // 課堂常見句子
    "Let's start today's lecture on data structures",
    "Does anyone have any questions about the previous topic?",
    "Please submit your homework before the deadline",
    // 計算機科學術語
    "A binary search tree is a data structure that allows efficient searching",
    "Git is a distributed version control system used for tracking changes",
];

#[tokio::test]
async fn test_opus_mt_fixes() {
    println!("\n{}", "=".repeat(80));
    println!("opus-mt-en-zh 修復效果測試");
    println!("{}", "=".repeat(80));
    
    let model_dir = Path::new("/Users/remote_sklonely/eduTranslate/models/opus-mt-en-zh-onnx");
    let tokenizer_path = Some(Path::new("/Users/remote_sklonely/eduTranslate/models/opus-mt-en-zh-onnx/tokenizer.json"));
    
    if !model_dir.exists() {
        eprintln!("❌ 模型目錄不存在: {:?}", model_dir);
        eprintln!("請先運行轉換腳本轉換模型");
        return;
    }
    
    // 加載模型
    println!("\n1. 加載模型...");
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;
    
    match model.load_model(model_dir, tokenizer_path).await {
        Ok(_) => {
            println!("   ✓ 模型加載成功");
        }
        Err(e) => {
            eprintln!("   ❌ 模型加載失敗: {}", e);
            return;
        }
    }
    
    // 測試重點案例
    println!("\n{}", "=".repeat(80));
    println!("2. 重點測試案例（之前有問題的）");
    println!("{}", "=".repeat(80));
    
    let mut critical_success = 0;
    let mut critical_empty = 0;
    let mut critical_repetitive = 0;
    
    for (idx, text) in CRITICAL_TEST_CASES.iter().enumerate() {
        println!("\n重點測試 {}: \"{}\"", idx + 1, text);
        
        match model.translate(text, "en", "zh").await {
            Ok(translated) => {
                let has_chinese = translated.chars().any(|c| '\u{4e00}' <= c && c <= '\u{9fff}');
                let is_empty = translated.trim().is_empty();
                let words: Vec<&str> = translated.split_whitespace().collect();
                let unique_words: std::collections::HashSet<&str> = words.iter().cloned().collect();
                let is_repetitive = !words.is_empty() && (unique_words.len() as f32 / words.len() as f32) < 0.3;
                
                if has_chinese && !is_empty && !is_repetitive {
                    critical_success += 1;
                }
                if is_empty {
                    critical_empty += 1;
                }
                if is_repetitive {
                    critical_repetitive += 1;
                }
                
                let status = if has_chinese && !is_empty && !is_repetitive {
                    "✓"
                } else if is_empty {
                    "⚠ (空)"
                } else if is_repetitive {
                    "⚠ (重複)"
                } else {
                    "✗"
                };
                
                println!("  {} 結果: \"{}\"", status, translated);
                println!("     包含中文: {}, 為空: {}, 重複: {}", has_chinese, is_empty, is_repetitive);
            }
            Err(e) => {
                eprintln!("  ❌ 翻譯失敗: {}", e);
                critical_empty += 1;
            }
        }
    }
    
    // 測試所有案例
    println!("\n{}", "=".repeat(80));
    println!("3. 完整測試案例");
    println!("{}", "=".repeat(80));
    
    let mut total_success = 0;
    let mut total_chinese = 0;
    let mut total_empty = 0;
    let mut total_repetitive = 0;
    let mut total_count = 0;
    
    for (idx, text) in ALL_TEST_CASES.iter().enumerate() {
        total_count += 1;
        println!("\n測試 {}: \"{}\"", idx + 1, text);
        
        match model.translate(text, "en", "zh").await {
            Ok(translated) => {
                let has_chinese = translated.chars().any(|c| '\u{4e00}' <= c && c <= '\u{9fff}');
                let is_empty = translated.trim().is_empty();
                let words: Vec<&str> = translated.split_whitespace().collect();
                let unique_words: std::collections::HashSet<&str> = words.iter().cloned().collect();
                let is_repetitive = !words.is_empty() && (unique_words.len() as f32 / words.len() as f32) < 0.3;
                
                if has_chinese {
                    total_chinese += 1;
                }
                if has_chinese && !is_empty && !is_repetitive {
                    total_success += 1;
                }
                if is_empty {
                    total_empty += 1;
                }
                if is_repetitive {
                    total_repetitive += 1;
                }
                
                let status = if has_chinese && !is_empty && !is_repetitive {
                    "✓"
                } else if is_empty {
                    "⚠ (空)"
                } else if is_repetitive {
                    "⚠ (重複)"
                } else {
                    "✗"
                };
                
                println!("  {} 結果: \"{}\"", status, translated);
            }
            Err(e) => {
                eprintln!("  ❌ 翻譯失敗: {}", e);
                total_empty += 1;
            }
        }
    }
    
    // 統計結果
    println!("\n{}", "=".repeat(80));
    println!("修復效果統計");
    println!("{}", "=".repeat(80));
    
    println!("\n重點測試案例（之前有問題的）:");
    println!("  成功: {}/{} ({:.1}%)", 
             critical_success, CRITICAL_TEST_CASES.len(), 
             critical_success as f32 / CRITICAL_TEST_CASES.len() as f32 * 100.0);
    println!("  空輸出: {}/{} ({:.1}%)", 
             critical_empty, CRITICAL_TEST_CASES.len(),
             critical_empty as f32 / CRITICAL_TEST_CASES.len() as f32 * 100.0);
    println!("  重複: {}/{} ({:.1}%)", 
             critical_repetitive, CRITICAL_TEST_CASES.len(),
             critical_repetitive as f32 / CRITICAL_TEST_CASES.len() as f32 * 100.0);
    
    println!("\n完整測試案例:");
    println!("  總測試數: {}", total_count);
    println!("  成功翻譯: {}/{} ({:.1}%)", 
             total_success, total_count, total_success as f32 / total_count as f32 * 100.0);
    println!("  包含中文: {}/{} ({:.1}%)", 
             total_chinese, total_count, total_chinese as f32 / total_count as f32 * 100.0);
    println!("  空輸出: {}/{} ({:.1}%)", 
             total_empty, total_count, total_empty as f32 / total_count as f32 * 100.0);
    println!("  重複輸出: {}/{} ({:.1}%)", 
             total_repetitive, total_count, total_repetitive as f32 / total_count as f32 * 100.0);
    
    println!("\n{}", "=".repeat(80));
    
    // 評估修復效果
    println!("\n修復效果評估:");
    if critical_empty == 0 && critical_repetitive == 0 {
        println!("  ✅ 重點問題已完全修復！");
    } else if critical_empty + critical_repetitive < CRITICAL_TEST_CASES.len() / 2 {
        println!("  ⚠ 重點問題部分修復，仍需優化");
    } else {
        println!("  ❌ 重點問題仍然存在，需要進一步調試");
    }
    
    if total_empty < total_count / 10 {
        println!("  ✅ 空輸出問題大幅改善（< 10%）");
    } else {
        println!("  ⚠ 空輸出問題仍需改善");
    }
    
    if total_repetitive < total_count / 10 {
        println!("  ✅ 重複問題大幅改善（< 10%）");
    } else {
        println!("  ⚠ 重複問題仍需改善");
    }
    
    println!("{}", "=".repeat(80));
}

