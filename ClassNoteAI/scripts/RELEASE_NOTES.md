# M2M100-418M CTranslate2 Model Release

## 模型資訊 Model Information

| 項目 | 值 |
|------|-----|
| 模型名稱 | M2M100-418M (Meta Multilingual Translation) |
| 來源 | facebook/m2m100_418M |
| 格式 | CTranslate2 |
| 量化 | **int8** |
| 大小 | **440 MB** (壓縮後) |
| 支援語言 | 100+ 種 |

## 翻譯品質 (English → Chinese)

| 英文 | 中文 |
|------|------|
| Hello, world! | 你好,世界! |
| This is a test. | 这是一个测试。 |
| How are you today? | 你今天怎么样? |
| Machine learning is changing the world. | 机器学习正在改变世界。 |
| Please translate this sentence to Chinese. | 请将这句话翻译成中文。 |

## 安裝 Installation

1. 下載 `m2m100-418M-ct2-int8.zip`
2. 解壓到 `~/Library/Application Support/com.classnoteai/models/translation/`
3. 重啟應用

```bash
cd ~/Library/Application\ Support/com.classnoteai/models/translation/
unzip ~/Downloads/m2m100-418M-ct2-int8.zip
```

## 技術細節

- **原始大小**: 1,858 MB (float32)
- **量化後**: 476 MB → 440 MB 壓縮
- **減少比例**: 73%
- **品質損失**: 無明顯損失

## 支援的語言對

M2M100 是多對多翻譯模型，支援 100+ 種語言之間的互譯。常用語言代碼：

| 語言 | 代碼 |
|------|------|
| English | en |
| Chinese | zh |
| Japanese | ja |
| Korean | ko |
| Spanish | es |
| French | fr |
| German | de |
| Russian | ru |

## 已知問題 Known Issues

### 本地翻譯模型限制

- **長句翻譯不完整**：M2M100-418M 模型在處理較長或複雜的英文句子時，可能只翻譯部分內容，其餘保留英文。
  - 例：`"The problem is why the English is anytime in Mayan. Thank you."` → `"The problem is why the English is anytime in Mayan. 谢谢。"`
  - **建議解決方案**：
    1. 使用更大的翻譯模型（如 m2m100-1.2B）
    2. 切換到 Google 翻譯（需要網路連接）
    3. 將長句分割為短句後翻譯
