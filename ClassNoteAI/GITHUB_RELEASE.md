# ClassNoteAI v0.1.3-alpha (測試版)

> ⚠️ **測試版本** - 此版本為早期開發版本，功能持續開發中

## 可用功能 Features

### ✅ 已實現功能

1. **📄 PDF 閱讀**
   - 支援 PDF 文件上傳和閱讀
   - 多頁瀏覽與縮放

2. **🎙️ 上課即時轉錄**
   - 使用本地 Whisper 模型進行語音轉錄
   - 支援英文語音識別
   - 即時顯示轉錄字幕

3. **🌐 即時翻譯功能**
   - 使用本地 M2M100 翻譯模型
   - 支援英文到中文即時翻譯
   - 無需網路連接

## 系統需求 Requirements

- **macOS**: 12.0 (Monterey) 或更高版本
- **架構**: Apple Silicon (M1/M2/M3) 或 Intel

## 安裝說明 Installation

1. 下載 `ClassNoteAI_0.1.3_aarch64.dmg` (Apple Silicon) 或 `ClassNoteAI_0.1.3_x64.dmg` (Intel)
2. 開啟 DMG 並將應用程式拖曳到「應用程式」資料夾
3. 首次執行需要在「系統偏好設定」>「安全性與隱私權」中允許執行

## 已知問題 Known Issues

- **長句翻譯不完整**：M2M100-418M 模型在處理較長句子時，可能只翻譯部分內容
- **首次啟動較慢**：需要初始化 AI 模型，約需 10-30 秒

## 反饋與問題回報

如有問題或建議，請在 [Issues](https://github.com/sklonely/ClassNoteAI/issues) 頁面提出。

---

*此版本為測試版本，部分功能可能不穩定*
