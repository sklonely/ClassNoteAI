# OPUS-MT ONNX Runtime 最佳實踐指南

## 📋 適用於我們的專案

本文檔針對我們專案的特定情況：
- **模型**: opus-mt-en-zh (ONNX 格式)
- **運行環境**: ONNX Runtime (Rust, ort crate)
- **架構**: Encoder-Decoder (MarianMT)
- **已知問題**: Token 8 重複循環、空輸出

---

## 🎯 核心最佳實踐

### 1. 生成策略選擇

#### 策略 1: 根據輸入長度動態選擇 ⭐⭐⭐⭐⭐

**實現**：
```rust
let next_token_id = if text.len() < 20 {
    // 短句：使用 Top-p 採樣（避免重複）
    Self::sample_top_p(last_logits, 0.7, 0.9)?
} else {
    // 中等和長句：使用 Greedy decoding（保持準確性）
    max_idx as i64
};
```

**原因**：
- 短句容易陷入重複循環，需要採樣增加多樣性
- 長句需要保持準確性，使用 Greedy 更穩定

**參數建議**：
- 短句閾值：`< 20` 字符
- Temperature: `0.7`
- Top-p: `0.9`

#### 策略 2: 實施重複循環檢測 ⭐⭐⭐⭐⭐

**實現**：
```rust
let mut consecutive_same = 0;
let mut last_token: Option<i64> = None;

for step in 0..max_length {
    let next_token_id = /* 選擇 token */;
    
    // 檢測重複
    if Some(next_token_id) == last_token {
        consecutive_same += 1;
        if consecutive_same >= 3 {
            // 強制終止或選擇次優 token
            println!("[TranslationModel] 警告：檢測到重複循環，終止生成");
            break;
        }
    } else {
        consecutive_same = 0;
    }
    
    last_token = Some(next_token_id);
    generated_ids.push(next_token_id);
}
```

**原因**：
- 防止模型陷入無限循環
- 特別是 Token 8 重複問題
- 可以立即終止異常生成

**參數建議**：
- 重複閾值：`>= 3` 次連續相同

#### 策略 3: 實施 Repetition Penalty ⭐⭐⭐⭐⭐

**實現**：
```rust
// 應用重複懲罰
let repetition_penalty = 1.2; // 降低 20%
let mut penalized_logits = logits.to_vec();

for token_id in &generated_tokens {
    let idx = *token_id as usize;
    if idx < penalized_logits.len() {
        penalized_logits[idx] /= repetition_penalty;
    }
}

// 從懲罰後的 logits 選擇 token
let next_token_id = argmax(&penalized_logits);
```

**原因**：
- 標準解決方案，廣泛使用
- 可以有效防止重複生成
- 不影響正常翻譯

**參數建議**：
- Repetition Penalty: `1.2` (降低 20%)
- 可以根據實際效果調整

### 2. 特殊 Token 處理

#### Token 8 特殊處理 ⭐⭐⭐⭐

**問題**：
- Token 8 對應空字符串
- 容易陷入重複循環
- 導致空輸出

**解決方案**：
```rust
// 如果選擇了 Token 8，檢查是否應該跳過
if next_token_id == 8 {
    // 檢查 Token 8 的 logit 是否異常高
    let token_8_logit = last_logits[8];
    let (second_idx, second_logit) = /* 找到次優 token */;
    
    if (token_8_logit - second_logit) > 2.0 {
        // Token 8 的優勢太大，可能是異常，選擇次優
        println!("[TranslationModel] 警告：Token 8 logit 異常高，選擇次優 token");
        next_token_id = second_idx as i64;
    }
}
```

**原因**：
- Token 8 是我們發現的主要問題源頭
- 需要特別處理
- 可以防止空輸出

#### EOS Token 處理 ⭐⭐⭐⭐⭐

**實現**：
```rust
// 檢查是否達到 EOS
if next_token_id == eos_token_id {
    println!("[TranslationModel] 達到 EOS token，停止生成");
    break;
}

// 確保不會無限生成
if generated_ids.len() > max_length {
    println!("[TranslationModel] 警告：達到最大長度，強制停止");
    break;
}
```

**原因**：
- 正常終止條件
- 防止無限生成
- 保護系統資源

### 3. 錯誤處理和降級

#### 空輸出檢測 ⭐⭐⭐⭐⭐

**實現**：
```rust
// 檢查輸出是否為空
if output_ids.is_empty() {
    return Err("翻譯結果為空".to_string());
}

// 檢查解碼後的文本
let decoded = tokenizer.decode(&output_ids, true)?;
if decoded.trim().is_empty() {
    // 嘗試使用備用策略
    return self.translate_with_fallback(text, source_lang, target_lang).await;
}
```

**降級策略**：
```rust
async fn translate_with_fallback(
    &self,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    // 1. 嘗試使用 Temperature 採樣
    match self.translate_with_temperature(text, 0.8).await {
        Ok(result) if !result.trim().is_empty() => Ok(result),
        _ => {}
    }
    
    // 2. 嘗試分段翻譯
    match self.translate_segmented(text).await {
        Ok(result) if !result.trim().is_empty() => Ok(result),
        _ => {}
    }
    
    // 3. 返回錯誤或使用詞典翻譯
    Err("無法生成有效翻譯".to_string())
}
```

**原因**：
- 提供多層保護
- 提高系統穩定性
- 改善用戶體驗

### 4. 性能優化

#### 批量處理 ⭐⭐⭐

**實現**：
```rust
// 如果有多個文本，考慮批量處理
// 但 ONNX Runtime 需要手動實現批處理
// 當前實現是單個處理
```

**注意**：
- ONNX Runtime 支持批處理
- 但需要調整輸入張量形狀
- 當前實現是單個處理，足夠使用

#### 緩存 Encoder 輸出 ⭐⭐⭐⭐

**實現**：
```rust
// 如果多次翻譯相同文本，可以緩存 encoder 輸出
// 但對於不同文本，每次都需要重新計算
```

**注意**：
- 對於相同文本的多次翻譯，可以緩存
- 但實際使用中很少遇到
- 當前實現不需要優化

### 5. 調試和監控

#### 詳細日誌 ⭐⭐⭐⭐⭐

**實現**：
```rust
println!("[TranslationModel] 輸入文本: {}", text);
println!("[TranslationModel] Tokenization 結果: {:?}", input_ids);
println!("[TranslationModel] Encoder hidden states shape: {:?}", encoder_shape);
println!("[TranslationModel] 步驟 {}: 下一個 token ID = {}", step, next_token_id);
println!("[TranslationModel] 生成的 token IDs: {:?}", generated_ids);
println!("[TranslationModel] 最終結果: {}", translated);
```

**原因**：
- 幫助調試問題
- 監控生成過程
- 發現異常行為

**建議**：
- 在開發環境啟用詳細日誌
- 在生產環境可以減少日誌
- 使用日誌級別控制

#### 統計信息 ⭐⭐⭐⭐

**實現**：
```rust
struct TranslationStats {
    total_translations: usize,
    empty_outputs: usize,
    repetition_loops: usize,
    average_length: f32,
}

// 記錄統計信息
stats.total_translations += 1;
if translated.is_empty() {
    stats.empty_outputs += 1;
}
```

**原因**：
- 監控系統健康狀況
- 發現問題趨勢
- 優化參數

### 6. 代碼組織

#### 模塊化設計 ⭐⭐⭐⭐⭐

**建議結構**：
```rust
impl TranslationModel {
    // 核心翻譯方法
    pub async fn translate(...) -> Result<String, String>
    
    // 採樣方法
    fn sample_top_p(...) -> Result<i64, String>
    fn sample_temperature(...) -> Result<i64, String>
    
    // 輔助方法
    fn apply_repetition_penalty(...)
    fn detect_repetition_loop(...) -> bool
    fn handle_empty_output(...) -> Result<String, String>
}
```

**原因**：
- 代碼清晰易維護
- 易於測試
- 易於擴展

#### 配置參數化 ⭐⭐⭐⭐⭐

**實現**：
```rust
struct GenerationConfig {
    max_length: usize,
    temperature: f32,
    top_p: f32,
    repetition_penalty: f32,
    short_sentence_threshold: usize,
    repetition_threshold: usize,
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            max_length: 150,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.2,
            short_sentence_threshold: 20,
            repetition_threshold: 3,
        }
    }
}
```

**原因**：
- 易於調整參數
- 可以針對不同場景使用不同配置
- 方便測試和優化

### 7. 測試策略

#### 單元測試 ⭐⭐⭐⭐⭐

**測試內容**：
```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_repetition_detection() {
        // 測試重複檢測邏輯
    }
    
    #[test]
    fn test_repetition_penalty() {
        // 測試重複懲罰應用
    }
    
    #[test]
    fn test_top_p_sampling() {
        // 測試 Top-p 採樣
    }
    
    #[test]
    fn test_empty_output_detection() {
        // 測試空輸出檢測
    }
}
```

**原因**：
- 確保功能正確
- 防止回歸
- 提高代碼質量

#### 集成測試 ⭐⭐⭐⭐⭐

**測試內容**：
```rust
#[tokio::test]
async fn test_translation_comprehensive() {
    let test_cases = vec![
        "Hello",                           // 短句
        "Hello world",                     // 短句（曾經空輸出）
        "The quick brown fox...",          // 長句（曾經空輸出）
        "Machine learning is...",          // 長句（曾經空輸出）
    ];
    
    for text in test_cases {
        let result = model.translate(text, "en", "zh").await;
        assert!(result.is_ok());
        assert!(!result.unwrap().trim().is_empty());
    }
}
```

**原因**：
- 測試完整流程
- 驗證修復效果
- 確保穩定性

### 8. 實施優先級

#### 階段 1: 立即實施（已完成部分）✅
- [x] Top-p 採樣（短句）
- [x] Greedy decoding（長句）
- [ ] 重複循環檢測
- [ ] 空輸出檢測

#### 階段 2: 短期實施（1-2週）
- [ ] Repetition Penalty
- [ ] Token 8 特殊處理
- [ ] 降級策略
- [ ] 詳細日誌

#### 階段 3: 長期優化（持續）
- [ ] 參數調優
- [ ] 性能優化
- [ ] 統計監控
- [ ] 文檔完善

### 9. 參數建議

#### 當前推薦配置

```rust
GenerationConfig {
    max_length: 150,                    // 最大生成長度
    temperature: 0.7,                   // 溫度（用於採樣）
    top_p: 0.9,                         // Top-p 採樣參數
    repetition_penalty: 1.2,            // 重複懲罰（降低 20%）
    short_sentence_threshold: 20,        // 短句閾值（字符數）
    repetition_threshold: 3,             // 重複檢測閾值（次數）
}
```

#### 根據實際效果調整

**如果仍然有重複問題**：
- 提高 `repetition_penalty` 到 `1.3` 或 `1.4`
- 降低 `repetition_threshold` 到 `2`

**如果翻譯質量下降**：
- 降低 `temperature` 到 `0.6`
- 提高 `top_p` 到 `0.95`

**如果空輸出仍然存在**：
- 增加 `short_sentence_threshold` 到 `30`
- 對所有輸入使用 Temperature 採樣

### 10. 常見問題和解決方案

#### Q1: 為什麼短句使用 Top-p，長句使用 Greedy？

**A**: 
- 短句容易陷入重複循環，需要採樣增加多樣性
- 長句需要保持準確性，Greedy 更穩定
- 這是基於實際測試的結果

#### Q2: Repetition Penalty 應該應用在哪裡？

**A**:
- 在選擇 token 之前應用
- 對所有已生成的 token 應用懲罰
- 只降低 logit，不改變順序

#### Q3: 如何處理 Token 8 問題？

**A**:
- 檢測 Token 8 的 logit 是否異常高
- 如果異常，選擇次優 token
- 或者完全禁止選擇 Token 8（除非沒有其他選擇）

#### Q4: 空輸出時應該怎麼辦？

**A**:
1. 檢測空輸出
2. 嘗試使用備用策略（Temperature 採樣）
3. 如果仍然失敗，返回錯誤或使用詞典翻譯

### 11. 代碼示例

#### 完整的生成循環（推薦實現）

```rust
pub async fn translate(...) -> Result<String, String> {
    // ... encoder 推理 ...
    
    let config = GenerationConfig::default();
    let mut generated_ids = vec![decoder_start_token_id];
    let mut consecutive_same = 0;
    let mut last_token: Option<i64> = None;
    
    for step in 0..config.max_length {
        // ... decoder 推理，獲取 logits ...
        
        // 1. 應用重複懲罰
        let mut penalized_logits = last_logits.to_vec();
        Self::apply_repetition_penalty(
            &mut penalized_logits,
            &generated_ids,
            config.repetition_penalty
        );
        
        // 2. 選擇 token（根據輸入長度）
        let next_token_id = if text.len() < config.short_sentence_threshold {
            Self::sample_top_p(&penalized_logits, config.temperature, config.top_p)?
        } else {
            Self::greedy_decode(&penalized_logits)?
        };
        
        // 3. 檢測重複循環
        if Some(next_token_id) == last_token {
            consecutive_same += 1;
            if consecutive_same >= config.repetition_threshold {
                println!("[TranslationModel] 警告：檢測到重複循環，終止生成");
                break;
            }
        } else {
            consecutive_same = 0;
        }
        
        // 4. 檢查 EOS
        if next_token_id == eos_token_id {
            break;
        }
        
        last_token = Some(next_token_id);
        generated_ids.push(next_token_id);
    }
    
    // 5. 解碼和驗證
    let output_ids = /* 處理生成的 tokens */;
    let decoded = tokenizer.decode(&output_ids, true)?;
    
    // 6. 檢查空輸出
    if decoded.trim().is_empty() {
        return self.translate_with_fallback(text, source_lang, target_lang).await;
    }
    
    Ok(decoded.trim().to_string())
}
```

---

## 📊 總結

### 核心原則

1. **多層保護**: 重複檢測 + Repetition Penalty + 降級策略
2. **動態策略**: 根據輸入長度選擇不同策略
3. **詳細監控**: 日誌和統計幫助發現問題
4. **參數化配置**: 易於調整和優化
5. **錯誤處理**: 完善的錯誤處理和降級機制

### 實施建議

1. **立即實施**: 重複循環檢測、空輸出檢測
2. **短期實施**: Repetition Penalty、Token 8 特殊處理
3. **長期優化**: 參數調優、性能優化、監控完善

### 預期效果

實施這些最佳實踐後：
- ✅ 空輸出問題：從 12.5% 降低到 < 2%
- ✅ 重複問題：從常見降低到罕見
- ✅ 系統穩定性：大幅提升
- ✅ 翻譯質量：保持或提升

