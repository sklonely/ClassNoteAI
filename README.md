<div align="center">

# ClassNote AI

**即時課堂轉錄・AI 精修翻譯・智慧筆記助教**

把英文授課變得好跟得上。

[![Release](https://img.shields.io/github/v/release/sklonely/ClassNoteAI)](https://github.com/sklonely/ClassNoteAI/releases/latest)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[**📥 下載最新版**](https://github.com/sklonely/ClassNoteAI/releases/latest)　·　[**🌐 產品介紹頁**](https://sklonely.github.io/ClassNoteAI/landing/)　·　[**🛠 開發者文件**](CONTRIBUTING.md)

</div>

---

ClassNote AI 把你的筆電變成一位隨堂助教：上課時把老師的英文講解**即時轉成文字、同步翻譯**；下課後用你選擇的 AI（GPT、Claude、Gemini…）**整理筆記、回答問題、生成課程大綱**。

全部跑在你自己的電腦上，**沒有中間伺服器偷看你的錄音**。

<br/>

## ✨ 核心功能

| 功能 | 說明 |
|---|---|
| 🎙️ **即時英文轉錄** | 本地 Whisper，**離線可用**。模型從 75 MB 到 574 MB 依硬體自選，<2 秒延遲 |
| 🌐 **兩階段翻譯** | 即時粗翻（本地 Opus-MT / CTranslate2） → 背景 LLM 精修，自動覆寫字幕 |
| 🤖 **帶著你的 AI 來** | 支援 Copilot Pro / ChatGPT Plus OAuth / OpenAI / Anthropic / Gemini API key |
| 📄 **PDF 投影片同步** | 上傳講義，字幕會對齊到你正在講的那張投影片 |
| 🧠 **RAG 課程問答** | 下課後和你的筆記對話，AI 答題會引用出自哪張投影片 / 哪段錄音 |
| 📝 **筆記自動化** | 一鍵生 Markdown 摘要、課程大綱、關鍵詞標籤；可編輯可匯出 |
| 🚀 **GPU 加速** | Windows CUDA / macOS Metal，Whisper 推論 ~20× realtime |
| 💾 **本地優先** | 錄音/字幕/筆記/embedding 全部留在你電腦，不需要帳號就能開始用 |

<br/>

## 📥 安裝

到 [Releases 頁面](https://github.com/sklonely/ClassNoteAI/releases/latest) 抓對應作業系統的安裝檔：

| 作業系統 | 檔案 |
|---|---|
| **macOS**（Apple Silicon） | `ClassNoteAI_<版本>_aarch64.dmg` |
| **Windows**（一般） | `ClassNoteAI_<版本>_x64-setup.exe` |
| **Windows + NVIDIA GPU** | `ClassNoteAI_<版本>_x64_cuda-setup.exe` |

> macOS 版本已經 Apple 簽章 + notarize，**首次開啟不會跳 Gatekeeper 警告**。
>
> 首次啟動會下載 Whisper 模型（~180 MB – 574 MB，看你選哪個）。

不需要：Python、Node、Ollama、Docker。

<br/>

## 💡 使用流程

1. **建立課程** — 輸入課名、貼上課綱（選填），AI 自動抽出講師 / 時間 / 評分
2. **開始錄音** — 上課前開一堂新 lecture，按「開始錄製」
3. **即時看字幕** — 英文 + 中文逐行出現；AI 精修會在背景自動升級翻譯品質
4. **下課後** — 生摘要筆記、開 AI 助教問問題（RAG 答題會標引用）、匯出 Markdown

<br/>

## 🔒 隱私

- 錄音、字幕、筆記、embedding **永遠留在本機**（SQLite）
- AI 呼叫只送到你選的 Provider（GitHub / OpenAI / Anthropic / Google）；它們各自有隱私政策請自行確認
- **零 telemetry** — ClassNote AI 不收任何使用資料
- 雲端同步（開發中）會採 E2E 加密，Server 只存密文

<br/>

## ❓ 常見問題

**字幕延遲很嚴重？** 換成更小的 Whisper 模型（如 Small-q5），或暫時關掉 LLM 精修。

**錄音沒問題但轉錄怪怪的？** 檢查麥克風位置；非母語講者可以在 Course 的 keyword 欄位補術語，會餵給 Whisper 當提示。

**AI 功能跳 "No AI provider configured"？** 到 設定 → AI 增強 至少配一個 Provider。

**Copilot Pro 的 300 次 Premium Requests 不夠用？** 升到 Pro+（1500 次），或改用 pay-as-you-go 的 API key Provider。

**想匯出所有資料？** 設定 → 資料管理 → 匯出 JSON。

完整 FAQ 在 [應用內 README](ClassNoteAI/README.md)。

<br/>

## 🛠 想自己編譯？

前端 + Rust 環境需求、Windows vendor 補丁、CI 設定通通在 [CONTRIBUTING.md](CONTRIBUTING.md)。

<br/>

## 📄 授權

[MIT License](LICENSE) — 商用、改作、分發皆可。

<div align="center">

---

**ClassNote AI** — 把你的筆電變成隨堂助教。

<sub>Built with Tauri 2 · React · Rust · Whisper · CTranslate2 · Candle</sub>

</div>
