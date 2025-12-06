# 改進的 ONNX 翻譯模型實現指南

## 📋 問題分析

根據 Python 測試結果，當前實現存在以下問題：

1. **重複生成問題**：
   - "Hello" → "你好你好"（重複）
   - "Hello, how are you?" → "你好,你好吗?"（部分重複）
   - "What is your name?" → "你叫什么名字? 名字吗?"（重複）

2. **翻譯質量問題**：
   - "Hello world" → "喜好世界"（應該是"你好世界"）

## 🔍 根本原因

### 1. Repetition Penalty 不夠強

**當前實現**：
```rust
repetition_penalty: 1.2  // 只降低 20%
```

**問題**：
- 對於 opus-mt-en-zh 模型，1.2 的懲罰可能不夠
- 需要根據模型特性調整

### 2. 缺少 N-gram 重複檢測

**當前實現**：
- 只檢測單個 token 的重複
- 沒有檢測 N-gram（詞組）的重複

**標準做法**（參考 HuggingFace）：
- 使用 `no_repeat_ngram_size` 參數
- 檢測 2-gram 或 3-gram 的重複

### 3. Decoder 輸入方式可能不正確

**當前實現**：
```rust
// 每次傳入整個生成的序列
decoder_input_ids = generated_ids.clone();
```

**可能的問題**：
- opus-mt-en-zh 的 decoder 可能需要不同的輸入格式
- 需要確認是否應該只傳入最後一個 token

## ✅ 改進方案

### 方案 1: 增強 Repetition Penalty

```rust
// 改進前
repetition_penalty: 1.2

// 改進後
repetition_penalty: 1.5  // 降低 33%，更強力
```

**適用場景**：
- 所有翻譯任務
- 特別是短句翻譯

### 方案 2: 實施 N-gram 重複檢測

```rust
fn has_repeated_ngram(generated_ids: &[i64], ngram_size: usize, new_token: i64) -> bool {
    if generated_ids.len() < ngram_size - 1 {
        return false;
    }
    
    // 檢查最後 ngram_size-1 個 tokens + 新 token 是否與之前的序列重複
    let last_ngram: Vec<i64> = generated_ids
        .iter()
        .rev()
        .take(ngram_size - 1)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    
    let mut check_ngram = last_ngram.clone();
    check_ngram.push(new_token);
    
    // 檢查是否在之前的序列中出現過
    for i in 0..=generated_ids.len().saturating_sub(ngram_size) {
        let window = &generated_ids[i..i + ngram_size];
        if window == check_ngram.as_slice() {
            return true;
        }
    }
    
    false
}
```

**使用方式**：
```rust
// 在生成循環中
if has_repeated_ngram(&generated_ids, 2, next_token_id) {
    // 選擇次優 token
    let mut logit_values: Vec<(usize, f32)> = last_logits
        .iter()
        .enumerate()
        .map(|(idx, &val)| (idx, val))
        .collect();
    logit_values.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    // 跳過重複的 token，選擇下一個
    for (idx, _) in logit_values.iter().skip(1) {
        let candidate_token = *idx as i64;
        if !has_repeated_ngram(&generated_ids, 2, candidate_token) {
            next_token_id = candidate_token;
            break;
        }
    }
}
```

### 方案 3: 改進 Decoder 輸入方式

**檢查 HuggingFace 標準實現**：

HuggingFace 的 `MarianMTModel.generate()` 方法：
1. 使用 `past_key_values`（如果支持）來避免重複計算
2. 如果不支持，每次傳入整個序列（與我們當前實現相同）

**結論**：
- 我們的實現方式應該是正確的
- 問題不在 Decoder 輸入方式

### 方案 4: 使用 Top-p 採樣替代純 Greedy

**當前實現**：
```rust
// 短句使用 Top-p，長句使用 Greedy
if text.len() < config.short_sentence_threshold {
    Self::sample_top_p(&last_logits, config.temperature, config.top_p)?
} else {
    max_idx as i64
}
```

**改進**：
```rust
// 所有情況都使用 Top-p，但參數不同
let (temperature, top_p) = if text.len() < 20 {
    (0.7, 0.9)  // 短句：更多樣性
} else {
    (0.3, 0.95) // 長句：更保守
};

Self::sample_top_p(&last_logits, temperature, top_p)?
```

### 方案 5: 增強 Token 8 處理

**當前實現**：
```rust
if max_idx == 8 {
    // 檢查 Token 8 的優勢
    if (token_8_logit - second_logit) > 2.0 {
        second_idx as i64
    } else {
        max_idx as i64
    }
}
```

**改進**：
```rust
if max_idx == 8 {
    // 更激進的處理：如果 Token 8 不是明顯最佳，直接跳過
    let threshold = 1.5;  // 降低閾值
    if (token_8_logit - second_logit) > threshold {
        // 即使優勢明顯，也檢查是否有更好的選擇
        if logit_values.len() > 2 {
            let (third_idx, third_logit) = logit_values[2];
            if (second_logit - third_logit) < 0.5 {
                // 第二和第三很接近，選擇第二
                second_idx as i64
            } else {
                max_idx as i64
            }
        } else {
            second_idx as i64
        }
    } else {
        second_idx as i64
    }
}
```

## 🎯 推薦的完整改進實現

### 1. 更新 GenerationConfig

```rust
struct GenerationConfig {
    max_length: usize,
    temperature: f32,
    top_p: f32,
    repetition_penalty: f32,      // 增加到 1.5
    no_repeat_ngram_size: usize,   // 新增：2 或 3
    short_sentence_threshold: usize,
    repetition_threshold: usize,
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            max_length: 150,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.5,      // 從 1.2 增加到 1.5
            no_repeat_ngram_size: 2,       // 新增
            short_sentence_threshold: 20,
            repetition_threshold: 3,
        }
    }
}
```

### 2. 實施 N-gram 檢測

```rust
fn has_repeated_ngram(generated_ids: &[i64], ngram_size: usize, new_token: i64) -> bool {
    if generated_ids.len() < ngram_size - 1 {
        return false;
    }
    
    let mut check_ngram = Vec::with_capacity(ngram_size);
    for i in (generated_ids.len() + 1).saturating_sub(ngram_size)..generated_ids.len() {
        check_ngram.push(generated_ids[i]);
    }
    check_ngram.push(new_token);
    
    // 檢查是否在之前的序列中出現過
    for i in 0..=generated_ids.len().saturating_sub(ngram_size) {
        let mut matches = true;
        for j in 0..ngram_size {
            if generated_ids[i + j] != check_ngram[j] {
                matches = false;
                break;
            }
        }
        if matches {
            return true;
        }
    }
    
    false
}
```

### 3. 改進生成循環

```rust
// 在生成循環中
let next_token_id = /* 選擇 token */;

// 檢查 N-gram 重複
if has_repeated_ngram(&generated_ids, config.no_repeat_ngram_size, next_token_id) {
    // 選擇次優 token
    let mut logit_values: Vec<(usize, f32)> = last_logits
        .iter()
        .enumerate()
        .map(|(idx, &val)| (idx, val))
        .collect();
    logit_values.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    // 找到第一個不重複的 token
    let mut found = false;
    for (idx, _) in logit_values.iter().skip(1) {
        let candidate_token = *idx as i64;
        if !has_repeated_ngram(&generated_ids, config.no_repeat_ngram_size, candidate_token) {
            next_token_id = candidate_token;
            found = true;
            break;
        }
    }
    
    if !found {
        // 如果所有候選都重複，強制終止
        break;
    }
}
```

## 📊 預期效果

實施這些改進後，預期可以：

1. **消除重複**：
   - "Hello" → "你好"（不再重複）
   - "Hello, how are you?" → "你好，你好嗎？"（不再重複）

2. **提高翻譯質量**：
   - 更準確的翻譯結果
   - 更自然的語言表達

3. **更穩定的生成**：
   - 減少異常終止
   - 更一致的翻譯質量

## 🔄 實施步驟

1. **更新 GenerationConfig**：增加 `repetition_penalty` 和 `no_repeat_ngram_size`
2. **實施 N-gram 檢測函數**：添加 `has_repeated_ngram()` 函數
3. **更新生成循環**：在選擇 token 後檢查 N-gram 重複
4. **測試驗證**：使用 Python 測試腳本驗證改進效果
5. **調整參數**：根據實際效果微調參數

## 📚 參考資料

- [HuggingFace Transformers - Generation Strategies](https://huggingface.co/docs/transformers/generation_strategies)
- [HuggingFace Transformers - MarianMTModel](https://huggingface.co/docs/transformers/model_doc/marian)
- [ONNX Runtime Best Practices](https://onnxruntime.ai/docs/)


