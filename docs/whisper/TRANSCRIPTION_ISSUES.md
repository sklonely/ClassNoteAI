# 轉錄效果問題診斷與解決方案

## 🔍 發現的問題

### ⚠️ 問題 1：語言硬編碼為英文（最嚴重）

**位置**：`src-tauri/src/whisper/transcribe.rs:53`

```rust
let language_str = "en"; // 設置語言為英文
params.set_language(Some(language_str));
```

**影響**：
- 如果用戶說中文或其他語言，強制設置為英文會導致：
  - 準確度大幅下降（可能從 95% 降到 60-70%）
  - 產生大量錯誤識別
  - 無法正確識別非英文單詞

**解決方案**：
1. **自動語言檢測**（推薦）：讓 Whisper 自動檢測語言
   ```rust
   params.set_language(None); // 自動檢測語言
   ```
2. **手動選擇語言**：在設置頁面添加語言選擇功能

### ⚠️ 問題 2：採樣策略過於簡單

**位置**：`src-tauri/src/whisper/transcribe.rs:48`

```rust
let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
```

**影響**：
- `best_of: 1` 意味著只生成一個候選結果，不進行比較
- 準確度可能比 `best_of: 5` 低 2-5%

**解決方案**：
```rust
// 方案 A：提高 best_of 值（平衡速度和準確度）
let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });

// 方案 B：使用 Beam Search（最高準確度，但較慢）
let mut params = FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5 });
```

### ⚠️ 問題 3：音頻重採樣質量

**位置**：`src/utils/audioProcessor.ts:23-63`

**當前實現**：使用簡單的線性插值

**影響**：
- 線性插值可能導致音頻質量損失
- 對於高頻內容（如語音細節）可能不夠準確

**解決方案**：
1. **使用更先進的重採樣算法**（如 Lanczos 或 Sinc 插值）
2. **使用 Web Audio API 的內置重採樣**（質量更好）

### ⚠️ 問題 4：線程數限制

**位置**：`src-tauri/src/whisper/transcribe.rs:51`

```rust
params.set_n_threads((num_cpus::get().min(4)) as i32); // 限制線程數
```

**影響**：
- 在多核 CPU 上可能無法充分利用資源
- 轉錄速度可能較慢

**解決方案**：
```rust
// 根據 CPU 核心數動態調整
let num_threads = num_cpus::get().min(8); // 允許更多線程
params.set_n_threads(num_threads as i32);
```

### ⚠️ 問題 5：音頻切片時長

**位置**：`src/services/transcriptionService.ts:25-26`

```typescript
private minChunkDuration: number = 2000; // 2秒
private maxChunkDuration: number = 10000; // 10秒
```

**影響**：
- 太短的切片可能缺乏上下文
- 太長的切片可能導致延遲增加

**建議**：
- 根據實際測試調整時長
- 考慮使用 VAD 的智能切片（已實現）

### ⚠️ 問題 6：VAD 參數可能不夠靈敏

**位置**：`src/services/transcriptionService.ts:172`

```typescript
energy_threshold: 0.002, // 0.2% 能量閾值
min_speech_duration_ms: 1000, // 1秒
```

**影響**：
- 如果環境噪音較大，可能無法正確檢測語音
- 如果語音較輕，可能被誤判為靜音

**解決方案**：
- 根據實際環境動態調整閾值
- 添加音頻增益控制

## 📊 問題優先級

| 問題 | 嚴重程度 | 影響準確度 | 修復難度 | 優先級 |
|------|---------|-----------|---------|--------|
| 語言硬編碼 | ⭐⭐⭐⭐⭐ | 極高（-30-50%） | 低 | 🔴 最高 |
| 採樣策略 | ⭐⭐⭐ | 中等（-2-5%） | 低 | 🟡 高 |
| 音頻重採樣 | ⭐⭐ | 較低（-1-3%） | 中 | 🟢 中 |
| 線程數限制 | ⭐⭐ | 影響速度 | 低 | 🟢 中 |
| 切片時長 | ⭐ | 較低 | 低 | 🟢 低 |
| VAD 參數 | ⭐⭐ | 中等 | 中 | 🟡 中 |

## 🛠️ 建議的修復順序

1. **立即修復**：語言自動檢測（問題 1）
2. **短期優化**：提高採樣策略準確度（問題 2）
3. **中期優化**：改進音頻重採樣（問題 3）
4. **長期優化**：動態調整 VAD 參數（問題 6）

## 📝 其他可能影響因素

### 環境因素
- **麥克風質量**：低質量麥克風可能導致音頻失真
- **環境噪音**：背景噪音會降低準確度
- **說話距離**：距離麥克風太遠可能導致音量不足

### 使用因素
- **說話速度**：過快或過慢可能影響識別
- **口音**：某些口音可能識別較差
- **專業術語**：未在訓練數據中的術語可能識別錯誤

## 🔗 參考資料

- Whisper 論文：https://arxiv.org/abs/2212.04356
- whisper-rs 文檔：https://docs.rs/whisper-rs/
- 音頻處理最佳實踐：https://github.com/ggerganov/whisper.cpp

