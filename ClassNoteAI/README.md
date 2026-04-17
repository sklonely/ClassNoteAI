# ClassNote AI

> 即時課堂轉錄・AI 精修翻譯・智慧筆記助教
>
> 讓英文授課變得好跟得上。

[![Release](https://img.shields.io/github/v/release/sklonely/ClassNoteAI)](https://github.com/sklonely/ClassNoteAI/releases/latest)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

ClassNote AI 把你的筆電變成一位隨堂助教：上課時即時把老師的英文講解轉成文字、同步翻譯成中文；下課後用你選擇的大型語言模型（GPT、Claude、Gemini 等）整理筆記、回答問題、生成課程大綱。

全部都跑在你自己的電腦 + 你自己的 AI 訂閱上，**沒有中間伺服器偷看你的錄音**。

---

## 主要功能

### 🎙️ 即時英文轉錄

- 本地運行的 Whisper 模型，**離線可用**
- 從 75MB 的 Tiny 模型到 574MB 的 Large-v3 Turbo，依硬體自選
- <2 秒延遲的滾動式字幕顯示
- 長時間授課也不卡

### 🌐 兩階段翻譯

- **即時粗翻**：本地 Opus-MT（CTranslate2）秒回中文字幕
- **LLM 精修**：每 8 句或 20 秒，背景呼叫你的 AI 訂閱補正 ASR 錯字並產出自然流暢中文，自動覆寫到字幕上

### 🤖 多家 AI 模型可選

一鍵接上你現有的訂閱 / API key：

| 接入方式 | 來源 | 模型範例 |
|---|---|---|
| **GitHub Copilot Pro**（訂閱） | Personal Access Token | GPT-5.4 / Claude-4.6-sonnet / Grok / Llama |
| **ChatGPT Plus/Pro**（訂閱，非官方）| OAuth 登入 | GPT-5 / GPT-5 Codex |
| **Anthropic**（API key） | `sk-ant-...` | Claude 全系列 |
| **OpenAI Platform**（API key） | `sk-...` | GPT-5、o3-mini 等 |
| **Google Gemini**（API key） | `AIza...` | Gemini 2.0 Flash / Pro |

每個功能都可以獨立選提供者。沒設就用預設。

### 📄 PDF 投影片同步

上傳講義 PDF，側邊跟著翻頁，轉錄字幕會跟著當前頁面做語意對齊（找你講到哪張投影片）。

### 🧠 RAG 課程問答

下課後和你的筆記對話：

- 投影片 + 錄音轉錄先切塊、產生 embedding（本地 Candle 模型跑）
- 提問時從同一課的內容中找最相關片段，餵給 LLM 生成答案
- 可追溯回答引用了哪張投影片／哪段錄音

### 📝 筆記自動化

一鍵生成：

- **課程總結**（Markdown，含章節、重點、範例）
- **課程大綱（Syllabus）**：從課程描述抽出講師、時間、評分、週次進度
- **關鍵詞標籤**：自動標注術語便於後續搜尋
- 產生後可以繼續編輯，以 Markdown 匯出

### 💾 本地優先

所有錄音、字幕、筆記、embedding 都存在你電腦的 SQLite 裡：

- 離線也能看、能編輯舊筆記
- 不需要帳號就能開始用
- 雲端同步（籌備中）會走 E2E 加密，Server 也看不到

---

## 系統需求

| 平台 | 支援版本 |
|---|---|
| **macOS** | 11 Big Sur 以上（Apple Silicon 或 Intel） |
| **Windows** | Windows 10/11 x64 |
| **儲存空間** | 2 GB 以上（AI 模型） |
| **記憶體** | 8 GB 以上建議 |

不需要：Python、Node、Ollama、Docker、GPU。

---

## 下載安裝

到 [Releases 頁面](https://github.com/sklonely/ClassNoteAI/releases/latest) 抓對應作業系統：

| 作業系統 | 檔案 |
|---|---|
| macOS (Apple Silicon) | `ClassNoteAI_<版本>_aarch64.dmg` |
| Windows | `ClassNoteAI_<版本>_x64-setup.exe`（NSIS 安裝程式） |
| Windows（企業部署） | `ClassNoteAI_<版本>_x64.msi` |

首次啟動會下載 Whisper 模型（~180MB–574MB，看你選哪個）。

---

## 使用流程

1. **建立課程** → 輸入課名、貼上課綱描述（選填），AI 會自動抽出講師/時間/評分等結構化資訊
2. **開始錄音** → 上課前開一堂新 lecture，按下「開始錄製」
3. **即時看字幕** → 英文 + 中文逐行出現，AI 精修會在背景自動把粗翻升級成精翻
4. **下課後**：
    - 產生摘要筆記
    - 開 AI 助教問問題（走 RAG，會引用投影片/錄音）
    - 匯出 Markdown

---

## AI 模型配置

第一次使用 AI 功能前：

1. 開啟 **設定 → AI 增強**
2. 選一個 Provider，貼上對應的 key（或點 ChatGPT 的 Sign in 按鈕走 OAuth）
3. 按 **Test** 驗證連線
4. 選「預設 Provider」，所有 AI 功能都會走它

**推薦路徑**（依成本）：
- **已有 Copilot Pro 訂閱** → 用 GitHub Models（不用另外付費）
- **已有 ChatGPT Plus 訂閱** → 用 ChatGPT OAuth（注意：非官方接入，OpenAI 可能隨時調整 → 會先彈出警告）
- **只想 pay-as-you-go** → 用 OpenAI/Anthropic/Gemini API key

---

## 隱私聲明

- **錄音、字幕、筆記、embeddings 永遠留在本機**（SQLite 資料庫）
- **AI 呼叫**：你的轉錄內容會送到你選擇的 Provider（GitHub/OpenAI/Anthropic/Google）。它們各自有隱私政策，請自行確認
- **雲端同步（開發中）**：未來上線會採 E2E 加密，Server 只存密文，無法解讀內容
- **沒有 telemetry**：ClassNote AI 不收任何使用資料

---

## 疑難排解

**Q: 字幕延遲很嚴重？**
→ 換成更小的 Whisper 模型（如 Small-q5），或關掉 LLM 精修（重錄時）。

**Q: 錄音有錄、但轉出來怪怪的？**
→ 檢查麥克風品質與位置；英語非母語講者可以在 Course 的 keyword 欄位補上術語，會餵給 Whisper 提示。

**Q: AI 功能跳出「No AI provider configured」？**
→ 到 設定 → AI 增強 配置至少一個 Provider。

**Q: 我 Copilot Pro 的 300 次 Premium Requests 配額不夠用？**
→ 升級到 Pro+（1500 次）、或改用 API key 的 Provider（pay-per-token 沒月配額）。

**Q: 想匯出所有資料？**
→ 設定 → 資料管理 → 匯出。產生一個包含所有課程/講座/筆記的 JSON 檔。

---

## 開發者資訊

如果你想自行編譯或貢獻程式碼，請參考 [`CONTRIBUTING.md`](../CONTRIBUTING.md)（Windows 編譯步驟、vendor 補丁、CI 設定都在那邊）。

---

## 授權

MIT License — 商用、改作、分發皆可。
