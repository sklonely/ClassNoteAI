# ClassNote AI - Tauri 版本產品需求文檔 (PRD)

**版本**: v1.1
**日期**: 2025-12-03
**技術棧**: Tauri (Rust + React) - 純 Rust 本地實現
**狀態**: 開發中

---

## ⚠️ 實現狀態 (v0.1.3)

> 本章節標示 PRD 需求與實際程式碼的對應狀態

### ✅ 已實現
- 本地 Whisper ASR (whisper-rs)
- 本地翻譯 (CTranslate2 + M2M100)
- PDF 查看器 (PDF.js)
- 音頻錄製 (Web Audio API)
- SQLite 數據存儲
- 筆記導出 (Markdown)
- 深色/淺色主題

### ❌ 未實現
- **AI 助教對話** - PRD 第 86 行，需 LLM 整合
- **精翻譯 (Fine)** - PRD 第 193 行，需 LLM 優化

### ⚠️ 需修復
- **PDF 自動對齊** - Embedding 功能有 Bug
- **環境精靈** - 流程待完整測試

### 📝 PRD 過時內容
- 第 249-376 行描述的 Python/FastAPI 架構已棄用，現為純 Rust 架構

---

## 📋 目錄

- [1. 產品概述](#1-產品概述)
- [2. 目標用戶](#2-目標用戶)
- [3. 產品目標與非目標](#3-產品目標與非目標)
- [4. 系統架構](#4-系統架構)
- [5. 核心功能需求](#5-核心功能需求)
- [6. 用戶流程](#6-用戶流程)
- [7. 技術規格](#7-技術規格)
- [8. UI/UX 設計](#8-uiux-設計)
- [9. 數據存儲](#9-數據存儲)
- [10. 性能要求](#10-性能要求)
- [11. 安全性與隱私](#11-安全性與隱私)
- [12. MVP 範圍](#12-mvp-範圍)
- [13. 未來增強功能](#13-未來增強功能)

---

## 1. 產品概述

### 1.1 產品定位

ClassNote AI 是一款基於 Tauri 框架開發的跨平台桌面應用程式，專為需要克服語言障礙的學生設計。提供即時語音識別、智能翻譯、AI 問答和自動筆記生成功能。

### 1.2 核心價值

- **即時理解**：提供低延遲的雙語字幕，幫助學生即時理解課堂內容
- **智能輔助**：AI 助教隨時解答疑問，解釋概念
- **自動整理**：課後自動生成結構化筆記，節省整理時間
- **本地優先**：支持完全本地模式（Whisper + Local Translation），保護隱私，無需網絡
- **輕量高效**：應用體積小，啟動快速，資源占用低

### 1.3 技術優勢（Tauri 版本）

- **輕量級**：應用體積小（前端 < 10MB），啟動快速
- **現代化 UI**：使用 React + Tailwind CSS，UI 靈活豐富
- **高性能**：Rust 後端提供高性能計算，WebView 渲染流暢
- **跨平台**：支持 macOS、Windows、Linux
- **安全性**：Tauri 提供精細的權限控制和安全機制
- **純 Rust 架構**：移除 Python 依賴，簡化部署與分發

---

## 2. 目標用戶

### 2.1 主要用戶群體

- **國際學生**：在非母語環境中學習的學生
- **語言學習者**：需要快速理解英文授課內容的學習者
- **筆記需求者**：需要自動整理課堂筆記的學生
- **聽力困難者**：需要視覺輔助理解語音的用戶

### 2.2 使用場景

- 大學課堂：英文授課的專業課程
- 在線課程：遠程授課的實時字幕
- 會議記錄：需要即時翻譯的學術會議
- 自學場景：觀看英文教學視頻

---

## 3. 產品目標與非目標

### 3.1 產品目標（Goals）

#### 核心目標
1. **低延遲字幕**：提供 < 1 秒的即時字幕響應（Rolling Buffer + Greedy Decoding）
2. **高準確度**：ASR 準確度 > 90%，翻譯品質 > 85%
3. **穩定可靠**：支持離線降級模式，確保課堂不中斷
4. **用戶友好**：直觀的 UI/UX，無需複雜設置即可使用
5. **輕量高效**：應用體積 < 50MB（不含模型），啟動時間 < 1 秒

#### 功能目標
- 即時語音識別（Whisper-rs）
- 中英雙語字幕實時顯示（Local/Remote Translation）
- PDF/PPT 課程材料瀏覽
- AI 助教即時問答（可選遠程 LLM）
- 課後自動生成結構化筆記
- 筆記導出（Markdown / PDF）

### 3.2 非目標（Non-Goals）

- ❌ 不提供屏幕錄影功能
- ❌ 不提供課程管理平台（LMS-like）
- ❌ 不作為教學作弊工具
- ❌ 不支持實時多人協作
- ❌ 不提供雲端同步（MVP 階段）

---

## 4. 系統架構

### 4.1 整體架構

產品採用**純 Rust 架構**，所有核心功能在 Tauri 應用內實現：

```
┌─────────────────────────────────────────────────────────┐
│         Tauri 前端 (React + TypeScript)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   UI 層       │  │  前端邏輯     │  │  音頻採集    │  │
│  │  (React)     │  │  (Services)  │  │ (Web Audio)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                  │                  │          │
│         │         Tauri Commands (IPC)        │          │
│         │                  │                  │          │
│         └──────────────────┴──────────────────┘          │
│                            │                            │
└────────────────────────────┼────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────┐
│         Tauri 後端 (Rust) - 高性能核心                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Whisper ASR │  │  翻譯服務    │  │  系統服務    │  │
│  │ (whisper-rs) │  │ (ort/Remote) │  │ (FS/System)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ⭐ 本地推理：whisper-rs (C++ Core)                    │
│  ⭐ 本地翻譯：ort (ONNX Runtime)                        │
│  ⭐ 數據存儲：SQLite (rusqlite)                         │
└─────────────────────────────────────────────────────────┘
```

**架構特點**：
- **前端驅動**：前端負責音頻採集、VAD 判斷、滾動緩衝區管理。
- **後端計算**：Rust 負責重型計算（ASR 推理、本地翻譯）。
- **零依賴**：無需安裝 Python 或其他運行時，單一可執行文件。

### 4.2 前端架構（React）

#### 4.2.1 核心模塊
- **AudioRecorder**: Web Audio API 錄音，Worklet 處理音頻流。
- **TranscriptionService**: 管理 Rolling Buffer，調用後端 ASR。
- **SubtitleService**: 管理字幕狀態、穩定性（Local Agreement）。
- **LectureView**: 主界面，集成 PDF Viewer 和字幕顯示。

### 4.3 Rust 後端架構

#### 4.3.1 核心模塊
- **whisper**: 封裝 `whisper-rs`，管理模型加載與推理上下文。
- **translation**: 封裝 `ort` 進行本地神經機器翻譯，或調用遠程 API。
- **commands**: 暴露給前端的 Tauri 命令接口。
- **storage**: SQLite 數據庫管理。

#### 4.3.2 性能優化
- **Whisper**: 使用 `whisper.cpp` 綁定，支持 CoreML/AVX2 加速。
- **Decoding**: 實時模式使用 Greedy Decoding (`best_of: 1`)。
- **Model**: 支持 Quantized Models (q5_0, q8_0) 和 Distil-Whisper。

---

## 5. 核心功能需求

### 5.1 語音輸入與即時字幕

#### 功能描述
實現低延遲、高準確度的實時語音轉錄。

#### 詳細需求

**音頻錄製（前端）**
- ✅ 使用 Web Audio API 錄製
- ✅ 格式：16kHz, 16-bit, Mono
- ✅ 前端 VAD：檢測靜音以觸發 Commit

**ASR 服務（Rust）**
- ✅ **引擎**：`whisper-rs` (基於 whisper.cpp)
- ✅ **模型**：支持 Base, Small, Distil-Small, Distil-Medium
- ✅ **延遲**：< 1 秒（Rolling Buffer 機制）
- ✅ **策略**：
    - **Streaming**: 前端維護 10s 緩衝區，每 800ms 請求一次轉錄。
    - **Stabilization**: 基於 VAD 和文本重疊算法確定 "Stable" 文本。

### 5.2 中英雙語字幕

#### 功能描述
實時顯示英文原文和中文翻譯。

#### 詳細需求
- ✅ **粗翻譯 (Rough)**：
    - 本地：使用 `ort` 運行量化 NMT 模型（如 Opus-MT）。
    - 遠程：Google Translate (Unofficial) 或其他 API。
- ✅ **精翻譯 (Fine)**：
    - 課後或段落結束後，調用 LLM 進行優化（可選）。
- ✅ **顯示**：雙行顯示，支持自定義樣式。

### 5.3 課程材料與筆記

#### 功能描述
集成 PDF 閱讀與自動筆記。

#### 詳細需求
- ✅ **PDF Viewer**: 基於 PDF.js，支持翻頁、縮放。
- ✅ **筆記生成**: 課後將 Transcript 整理為 Markdown 筆記。
- ✅ **導出**: 支持導出為 Markdown 或 PDF。

---

## 6. 技術規格

### 6.1 前端技術棧
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: React Context / Hooks
- **Audio**: Web Audio API (AudioWorklet)

### 6.2 後端技術棧
- **Core**: Rust (Tauri v2)
- **ASR**: `whisper-rs` (v0.11+)
- **Translation**: `ort` (ONNX Runtime)
- **Database**: `rusqlite`
- **HTTP**: `reqwest`

### 6.3 模型規格
- **ASR 模型**:
    - 格式: GGML / GGUF
    - 推薦: `distil-whisper-small.en` (速度快，準度高)
    - 備選: `base.en`, `small.en`
- **翻譯模型**:
    - 格式: ONNX (Quantized)
    - 模型: Helsinki-NLP/opus-mt-en-zh (Int8)

---

## 7. 性能要求

1.  **啟動時間**: < 1 秒
2.  **ASR 延遲**: < 1 秒 (從說話結束到字幕上屏)
3.  **內存佔用**: < 500MB (加載 Small 模型時)
4.  **CPU 佔用**: < 30% (M1/M2 Mac)

---

## 8. 未來增強功能

- **向量檢索 (RAG)**: 基於本地筆記庫的問答。
- **多語言支持**: 支持更多源語言和目標語言。
- **雲端同步**: 可選的雲端備份功能。
│   ├── public/            # 靜態資源
│   ├── package.json
│   └── vite.config.ts
│
├── src-tauri/             # Tauri 後端（Rust）
│   ├── src/
│   │   ├── main.rs        # 主入口（自動啟動 Python 服務）
│   │   ├── commands.rs    # Tauri 命令
│   │   └── lib.rs
│   ├── resources/         # 資源文件（打包時包含）
│   │   └── backend-service  # Python 服務可執行檔（PyInstaller 打包）
│   └── Cargo.toml
│
├── backend/               # Python 後端服務（源代碼）
│   ├── main.py            # FastAPI 應用
│   ├── services/
│   │   ├── whisper_service.py
│   │   ├── audio_service.py
│   │   └── storage_service.py
│   ├── api/
│   │   ├── transcription.py
│   │   └── storage.py
│   ├── models/
│   ├── requirements.txt
│   └── build.py           # PyInstaller 打包腳本
│
├── config/                # 配置文件
│   ├── default.yaml
│   └── user.yaml
│
└── data/                  # 數據目錄
    ├── models/            # Whisper 模型緩存
    ├── lectures/          # 課程數據
    └── notes/             # 筆記文件
```

### 7.5 打包和分發

#### 7.5.1 打包流程

**第一步：打包 Python 後端服務**
```bash
# 使用 PyInstaller 打包 Python 服務
cd backend
pyinstaller --onefile --name backend-service main.py

# 生成的可執行檔：
# macOS/Linux: backend-service
# Windows: backend-service.exe
```

**第二步：將 Python 服務複製到 Tauri 資源目錄**
```bash
# 複製打包後的 Python 服務到 Tauri 資源目錄
cp backend/dist/backend-service src-tauri/resources/
```

**第三步：配置 Tauri 打包**
```toml
# src-tauri/tauri.conf.json
{
  "build": {
    "resources": [
      "resources/backend-service"  # 包含 Python 服務可執行檔
    ]
  }
}
```

**第四步：打包 Tauri 應用**
```bash
# 打包應用
npm run tauri build

# 生成的可執行檔：
# macOS: ClassNote AI.app
# Windows: ClassNote AI.exe
# Linux: ClassNote AI (AppImage 或 .deb)
```

#### 7.5.2 最終分發結構

**macOS**:
```
ClassNote AI.app/
├── Contents/
│   ├── MacOS/
│   │   └── ClassNote AI      # Tauri 主程序
│   ├── Resources/
│   │   └── backend-service   # Python 服務可執行檔
│   └── Info.plist
```

**Windows**:
```
ClassNote AI/
├── ClassNote AI.exe          # Tauri 主程序
└── resources/
    └── backend-service.exe  # Python 服務可執行檔
```

**Linux**:
```
ClassNote AI/
├── ClassNote AI              # Tauri 主程序
└── resources/
    └── backend-service       # Python 服務可執行檔
```

#### 7.5.3 用戶體驗

**用戶操作**：
1. 下載 `ClassNote AI.app`（macOS）或 `ClassNote AI.exe`（Windows）
2. 雙擊應用圖標
3. **應用自動啟動，無需任何額外操作**

**應用啟動流程**：
1. Tauri 主程序啟動（< 1 秒）
2. Tauri 自動啟動 Python 後端服務（子進程，< 2 秒）
3. 應用就緒，用戶可以使用
4. 關閉應用時，Tauri 自動關閉 Python 後端服務

**關鍵優勢**：
- ✅ **單一可執行檔**：用戶只需一個文件
- ✅ **無需安裝 Python**：Python 運行時已打包
- ✅ **無需手動啟動服務**：完全自動化
- ✅ **跨平台**：macOS、Windows、Linux 都支持

---

## 8. UI/UX 設計

### 8.1 設計原則

- **現代化設計**：採用現代 UI 設計語言，簡潔優雅
- **簡潔明了**：界面簡潔，重點突出，減少視覺噪音
- **響應迅速**：操作反饋及時
- **易於使用**：符合用戶習慣，學習成本低
- **視覺舒適**：支持深色/淺色主題

### 8.2 設計系統

#### 8.2.1 技術棧

- **樣式框架**：Tailwind CSS
- **圖標**：Lucide React
- **路由**：React Router v7

#### 8.2.2 應用架構

```
App.tsx
├── SetupWizard          # 首次啟動環境精靈
└── MainWindow           # 主框架（導航欄 + 狀態列）
    ├── CourseListView   # 首頁：課程列表
    ├── CourseDetailView # 課程：講座列表
    ├── NotesView        # 筆記：PDF + 字幕 + 錄音
    └── SettingsView     # 設置頁面
```

#### 8.2.3 頁面流程

```
[首次啟動] → SetupWizard → 下載模型 → 完成
                                        ↓
[正常啟動] → CourseListView ─────────────┘
                    │ 選擇課程
                    ↓
             CourseDetailView
                    │ 選擇講座
                    ↓
               NotesView
            ┌─────────────────────────────────────┐
            │  ┌──────────┐  ┌─────────────────┐ │
            │  │   PDF    │  │    字幕顯示     │ │
            │  │  查看器  │  │  ─────────────  │ │
            │  │          │  │  (待實現)       │ │
            │  │          │  │  AI 助教面板    │ │
            │  └──────────┘  └─────────────────┘ │
            │  [⏺ 錄音] [⏸ 暫停] [📊 音量]       │
            └─────────────────────────────────────┘
```

### 8.3 核心組件

| 組件 | 檔案 | 說明 |
|-----|-----|-----|
| MainWindow | MainWindow.tsx | 導航欄、狀態列、主題切換 |
| SetupWizard | SetupWizard.tsx | 環境精靈、模型下載 |
| CourseListView | CourseListView.tsx | 課程卡片列表 |
| CourseDetailView | CourseDetailView.tsx | 講座列表、新增講座 |
| NotesView | NotesView.tsx | PDF + 字幕 + 錄音 + 筆記 |
| SettingsView | SettingsView.tsx | 模型管理、主題設置 |
| PDFViewer | PDFViewer.tsx | PDF.js 封裝 |
| SubtitleDisplay | SubtitleDisplay.tsx | 雙語字幕顯示 |

### 8.4 待實現功能

> ⚠️ 以下功能在 UI 中預留位置，待後續實現

- **AI 助教面板**：在 NotesView 右側，提供即時問答
- **PDF 自動對齊**：根據字幕內容自動翻頁（需修復 Bug）


### 8.5 顏色方案

#### 8.5.1 淺色主題（Light Mode）

**主色調**
- 主色（Primary）：`#3B82F6`（現代藍色）
- 主色變體：`#2563EB`（深藍）、`#60A5FA`（淺藍）
- 背景：`#FFFFFF`（純白）
- 表面：`#F9FAFB`（淺灰）
- 卡片：`#FFFFFF`（白色，帶陰影）

**文字**
- 主要文字：`#111827`（深灰黑）
- 次要文字：`#6B7280`（中灰）
- 禁用文字：`#9CA3AF`（淺灰）
- 反轉文字：`#FFFFFF`（白色）

**語義顏色**
- 成功：`#10B981`（綠色）
- 警告：`#F59E0B`（琥珀色）
- 錯誤：`#EF4444`（紅色）
- 信息：`#3B82F6`（藍色）

**邊框和分割線**
- 邊框：`#E5E7EB`（淺灰）
- 分割線：`#F3F4F6`（極淺灰）

#### 8.5.2 深色主題（Dark Mode）

**主色調**
- 主色（Primary）：`#60A5FA`（淺藍）
- 主色變體：`#3B82F6`（中藍）、`#2563EB`（深藍）
- 背景：`#0F172A`（深藍黑）
- 表面：`#1E293B`（深灰藍）
- 卡片：`#1E293B`（深灰藍，帶陰影）

**文字**
- 主要文字：`#F1F5F9`（淺灰白）
- 次要文字：`#94A3B8`（中灰）
- 禁用文字：`#64748B`（深灰）
- 反轉文字：`#0F172A`（深色）

**語義顏色**
- 成功：`#34D399`（淺綠）
- 警告：`#FBBF24`（淺琥珀）
- 錯誤：`#F87171`（淺紅）
- 信息：`#60A5FA`（淺藍）

**邊框和分割線**
- 邊框：`#334155`（深灰藍）
- 分割線：`#1E293B`（深灰藍）

#### 8.5.3 漸變和陰影

**漸變**
- 主漸變：`linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- 成功漸變：`linear-gradient(135deg, #10B981 0%, #059669 100%)`
- 背景漸變：`linear-gradient(180deg, #F9FAFB 0%, #FFFFFF 100%)`

**陰影系統**
- 小陰影：`0 1px 2px 0 rgba(0, 0, 0, 0.05)`
- 中陰影：`0 4px 6px -1px rgba(0, 0, 0, 0.1)`
- 大陰影：`0 10px 15px -3px rgba(0, 0, 0, 0.1)`
- 深色模式：使用發光效果替代陰影

### 8.6 字體系統

#### 8.6.1 字體族

**界面字體**（系統字體棧）
- macOS：`-apple-system, BlinkMacSystemFont, "SF Pro Display"`
- Windows：`"Segoe UI", system-ui`
- Linux：`"Inter", "Noto Sans", system-ui`
- 回退：`sans-serif`

**字幕字體**（等寬字體）
- macOS：`"SF Mono", Monaco`
- Windows：`"Cascadia Code", Consolas`
- Linux：`"Fira Code", "JetBrains Mono"`
- 回退：`monospace`

**標題字體**（可選）
- 使用 `Inter` 或 `SF Pro Display` 的 Medium/Bold 字重

#### 8.6.2 字體大小系統

採用 **4px 基準**的字體大小系統：

- **標題 1**：`32px` (2rem) - 主標題
- **標題 2**：`24px` (1.5rem) - 次標題
- **標題 3**：`20px` (1.25rem) - 小標題
- **正文**：`16px` (1rem) - 默認文字
- **小文字**：`14px` (0.875rem) - 輔助文字
- **極小文字**：`12px` (0.75rem) - 標籤、時間戳
- **字幕**：`18px - 24px`（可配置）

#### 8.6.3 字體字重

- **Light**：300 - 大標題
- **Regular**：400 - 正文
- **Medium**：500 - 按鈕、標籤
- **Semibold**：600 - 小標題
- **Bold**：700 - 強調文字

### 8.7 組件設計

#### 8.7.1 按鈕（Button）

**主要按鈕**
- 背景：主色漸變
- 文字：白色，Medium 字重
- 圓角：`8px`
- 內邊距：`12px 24px`
- 陰影：中陰影
- 懸停：提升陰影，輕微放大（scale 1.02）
- 點擊：縮小（scale 0.98）

**次要按鈕**
- 背景：透明，邊框主色
- 文字：主色
- 懸停：背景主色，文字白色

**圖標按鈕**
- 圓形，`40px × 40px`
- 背景：表面色
- 懸停：背景主色，圖標白色

#### 8.7.2 輸入框（Input）

- 背景：表面色
- 邊框：`1px solid` 邊框色
- 圓角：`8px`
- 內邊距：`12px 16px`
- 聚焦：邊框主色，外發光效果
- 錯誤：邊框錯誤色，紅色提示文字

#### 8.7.3 卡片（Card）

- 背景：卡片色
- 圓角：`12px`
- 陰影：中陰影
- 內邊距：`24px`
- 懸停：提升陰影（可選）

#### 8.7.4 標籤（Badge）

- 背景：主色（10% 透明度）
- 文字：主色
- 圓角：`6px`
- 內邊距：`4px 8px`
- 字體：極小文字，Medium 字重

#### 8.7.5 進度條（Progress）

- 背景：表面色
- 進度：主色漸變
- 圓角：`4px`
- 高度：`8px`
- 動畫：流暢的過渡動畫

#### 8.7.6 開關（Switch）

- 現代化滑動開關
- 背景：禁用時淺灰，啟用時主色
- 滑塊：白色圓形
- 動畫：流暢的滑動動畫

### 8.8 動畫和過渡

#### 8.8.1 過渡動畫

- **淡入淡出**：`opacity 0.2s ease-in-out`
- **滑動**：`transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- **縮放**：`transform 0.2s ease-in-out`
- **顏色變化**：`color 0.2s ease-in-out`

#### 8.8.2 微交互

- **按鈕懸停**：輕微提升（translateY -2px）
- **按鈕點擊**：輕微縮小（scale 0.95）
- **卡片懸停**：提升陰影
- **輸入框聚焦**：外發光效果
- **頁面切換**：淡入淡出 + 滑動

#### 8.8.3 加載動畫

- **骨架屏**：內容加載時顯示骨架屏
- **旋轉加載**：使用現代化的旋轉動畫
- **進度指示**：流暢的進度條動畫

### 8.9 響應式設計

#### 8.9.1 斷點系統

- **小屏幕**：`< 1280px` - 單列布局
- **中屏幕**：`1280px - 1920px` - 雙列布局
- **大屏幕**：`> 1920px` - 三列布局

#### 8.9.2 自適應布局

- 窗口可調整大小
- 組件自動適應窗口大小
- 最小窗口尺寸：`1200px × 700px`
- 支持全屏模式
- 響應式字體大小（可選）

### 8.10 UI 組件庫（參考）

#### 8.10.1 推薦組件庫

**shadcn/ui**（推薦）
- 基於 Radix UI + Tailwind CSS
- 現代化、可定制
- 無需安裝，直接複製代碼
- 支持深色模式

**其他選項**
- **Mantine**：功能豐富的 React 組件庫
- **Chakra UI**：簡潔現代的組件庫
- **Material-UI (MUI)**：Material Design 實現

#### 8.10.2 圖標庫

**Lucide React**（推薦）
- 現代化線條圖標
- 輕量級
- 豐富的圖標集

**其他選項**
- **Heroicons**：Tailwind 官方圖標
- **React Icons**：多個圖標庫集合

### 8.11 視覺層次

#### 8.11.1 間距系統

採用 **4px 基準**的間距系統：

- **xs**：`4px` (0.25rem)
- **sm**：`8px` (0.5rem)
- **md**：`16px` (1rem)
- **lg**：`24px` (1.5rem)
- **xl**：`32px` (2rem)
- **2xl**：`48px` (3rem)

#### 8.11.2 層級系統

- **Level 1**：背景層（z-index: 0）
- **Level 2**：內容層（z-index: 1）
- **Level 3**：卡片層（z-index: 10）
- **Level 4**：浮動元素（z-index: 100）
- **Level 5**：模態框（z-index: 1000）
- **Level 6**：通知（z-index: 2000）

### 8.12 可訪問性

- **鍵盤導航**：所有交互元素支持鍵盤操作
- **焦點指示**：清晰的焦點指示器
- **對比度**：文字與背景對比度 ≥ 4.5:1
- **ARIA 標籤**：正確的 ARIA 屬性
- **屏幕閱讀器**：支持屏幕閱讀器
- **動畫控制**：支持減少動畫選項（prefers-reduced-motion）

### 8.13 設計工具和資源

#### 8.13.1 設計工具

- **Figma**：UI 設計和原型
- **Tailwind CSS**：樣式框架
- **Framer Motion**：動畫庫

#### 8.13.2 設計資源

- **設計系統文檔**：內部設計系統文檔
- **組件庫文檔**：shadcn/ui 文檔
- **顏色工具**：Tailwind 顏色生成器

---

## 9. 數據存儲

### 9.1 本地存儲結構

```
用戶數據目錄/
├── config/
│   ├── settings.json      # 應用設置
│   └── server_config.json # 服務器配置
├── models/
│   └── whisper/           # Whisper 模型緩存
├── lectures/
│   ├── lecture_001/
│   │   ├── metadata.json  # 課程元數據
│   │   ├── audio/         # 音頻文件（可選）
│   │   └── subtitles.json # 字幕記錄
│   └── ...
└── notes/
    ├── lecture_001.md     # Markdown 筆記
    └── ...
```

### 9.2 數據模型

**課程（Lecture）**
```typescript
interface Lecture {
  id: string;
  title: string;
  date: string;  // ISO 8601
  duration: number;  // 秒
  pdf_path?: string;
  status: "recording" | "completed";
  subtitles: Subtitle[];
  notes?: Note;
}
```

**字幕（Subtitle）**
```typescript
interface Subtitle {
  id: string;
  timestamp: number;  // 秒
  text_en: string;
  text_zh?: string;
  type: "rough" | "fine";
  confidence?: number;
}
```

**筆記（Note）**
```typescript
interface Note {
  lecture_id: string;
  title: string;
  sections: Section[];
  qa_records: QARecord[];
  generated_at: string;  // ISO 8601
}
```

### 9.3 數據備份與恢復

- ✅ 支持導出所有數據（JSON 格式）
- ✅ 支持導入數據
- ✅ 數據清除功能（隱私保護）

---

## 10. 性能要求

### 10.1 響應時間

| 操作 | 目標響應時間 | 最大可接受時間 |
|------|------------|--------------|
| 應用啟動 | < 1 秒 | < 2 秒 |
| Python 服務啟動 | < 2 秒 | < 5 秒 |
| 粗字幕顯示 | < 2 秒 | < 5 秒 |
| HTTP 通信延遲 | < 100ms | < 200ms |
| 精字幕更新 | < 5 秒 | < 10 秒 |
| PDF 頁面切換 | < 0.3 秒 | < 0.5 秒 |
| AI 回答生成 | < 10 秒 | < 30 秒 |
| 筆記生成 | < 60 秒 | < 120 秒 |

### 10.2 資源使用

- **應用體積**：前端 3-10MB + Python 運行時（可選打包）
- **CPU 使用率**：< 30%（空閒時），< 70%（錄音+ASR時）
- **內存使用**：前端 < 100MB，Python 服務 < 500MB（基礎），< 2GB（含模型）
- **磁盤空間**：模型緩存約 500MB - 3GB（取決於模型大小）

### 10.3 準確度要求

- **ASR 準確度**：> 90%（Whisper Large）
- **翻譯品質**：> 85%（主觀評估）
- **LLM 回答相關性**：> 80%

---

## 11. 安全性與隱私

### 11.1 隱私保護

- ✅ **本地優先**：支持完全本地模式，數據不上傳
- ✅ **明確提示**：清楚顯示「錄音中」狀態
- ✅ **數據控制**：用戶可隨時清除所有數據
- ✅ **權限管理**：明確請求麥克風和文件訪問權限
- ✅ **Tauri 安全**：精細的 API 權限控制

### 11.2 數據安全

- ✅ **傳輸加密**：本地 HTTP 通信（可選 TLS）
- ✅ **遠程加密**：使用 HTTPS/WSS（如連接遠程服務器）
- ✅ **本地加密**：敏感數據可選加密存儲
- ✅ **不自動上傳**：用戶明確選擇才上傳數據

### 11.3 權限要求

**macOS**
- 麥克風訪問權限
- 文件訪問權限（讀取 PDF，保存筆記）

**Windows**
- 麥克風訪問權限
- 文件訪問權限

**Linux**
- 音頻設備訪問（ALSA/PulseAudio）
- 文件訪問權限

---

## 12. MVP 範圍

### 12.1 必須實現（MVP）

#### 核心功能
- ✅ Tauri 前端框架（React/Vue）
- ✅ Python 後端服務（FastAPI）
- ✅ HTTP REST API 通信
- ✅ **本地 Python 服務 Whisper ASR（Tiny/Base）** - ⭐ 必須實現，完全本地
- ✅ **即時粗字幕顯示** - ⭐ 必須實現，完全本地，無需遠程服務端
- ✅ PDF 查看器（PDF.js）
- ✅ 音頻錄製（Web Audio API）
- ⚠️ 遠程服務端 Whisper Large ASR（可選，用於精字幕）
- ⚠️ 中英翻譯顯示（可選，需要遠程服務端）
- ⚠️ WebSocket 實時通信（可選，需要遠程服務端）
- ⚠️ AI 助教對話窗口（可選，需要遠程服務端）
- ⚠️ 課後筆記生成（可選，需要遠程服務端）
- ✅ 筆記導出（Markdown）- 本地功能

**MVP 核心原則**：
- **粗字幕功能必須完全本地**，不依賴遠程服務端
- **Python 後端服務必須本地運行**，提供核心功能
- **遠程服務端功能為可選增強**，提升體驗但不影響基本使用

#### UI 功能
- ✅ 主窗口和基本布局
- ✅ 上課視圖
- ✅ 筆記視圖
- ✅ 設置視圖
- ✅ 基本的主題支持

#### 技術要求
- ✅ 跨平台支持（macOS / Windows / Linux）
- ✅ 本地模式支持
- ✅ 基本錯誤處理
- ✅ 日誌記錄
- ✅ **Whisper 性能測試通過**（< 2 秒延遲）

### 12.2 可以延後（非 MVP）

- ⏸️ PPT 原生支持（先轉 PDF）
- ⏸️ PDF 高亮和註記
- ⏸️ 向量索引和 RAG
- ⏸️ 完整的主題系統
- ⏸️ 自動更新功能
- ⏸️ 雲端同步
- ⏸️ 多語言支持（除中英文外）

---

## 13. 未來增強功能

### 13.1 短期增強（v1.1 - v1.3）

- **PPT 原生支持**：直接打開和顯示 PPT 文件
- **PDF 註記**：高亮、筆記、書籤功能
- **主題系統**：完整的深色/淺色主題，自定義顏色
- **快捷鍵系統**：完整的鍵盤快捷鍵支持
- **多窗口支持**：PDF 和字幕可分離窗口
- **WebSocket 優化**：實時流式轉錄

### 13.2 中期增強（v1.4 - v2.0）

- **向量索引**：課程內容向量化，支持語義搜索
- **RAG 增強**：基於向量索引的增強問答
- **多語言支持**：日語、韓語等
- **課程管理**：課程分類、標籤、搜索
- **統計分析**：學習時長、詞彙統計等

### 13.3 長期願景（v2.0+）

- **協作功能**：多人共享筆記
- **LMS 集成**：與學校系統集成
- **移動端應用**：iOS/Android 配套應用
- **AI 個性化**：根據用戶習慣優化回答
- **學習路徑**：基於課程內容推薦學習資源

---

## 14. 成功指標

### 14.1 技術指標

- ✅ 應用啟動時間 < 1 秒
- ✅ HTTP 通信延遲 < 100ms
- ✅ 字幕延遲 < 2 秒（粗字幕）
- ✅ ASR 準確度 > 90%
- ✅ 翻譯品質 > 85%
- ✅ 崩潰率 < 0.1%
- ✅ 應用體積 < 30MB（不含 Python 運行時）

### 14.2 用戶指標

- ✅ 用戶連續使用 > 4 堂課
- ✅ AI 問答成功率 > 80%
- ✅ 用戶滿意度 > 4.0/5.0
- ✅ 筆記使用率 > 60%

### 14.3 業務指標

- ✅ 日活躍用戶增長
- ✅ 用戶留存率（7天/30天）
- ✅ 功能使用率統計

---

## 15. 遷移計劃

### 15.1 開發階段

#### 階段一：架構設計和原型（2 週）
- [ ] 設計整體架構
- [ ] 設計 API 接口
- [ ] 實現最小原型（前端 + 後端）
- [ ] **關鍵測試：IPC 延遲測試**
- [ ] 確認延遲 < 100ms

#### 階段二：後端服務開發（2-3 週）
- [ ] Python FastAPI 服務框架
- [ ] Whisper ASR 服務集成
- [ ] 音頻處理服務
- [ ] 數據存儲服務
- [ ] API 文檔和測試
- [ ] **PyInstaller 打包配置**
- [ ] **單一可執行檔測試**

#### 階段三：前端 UI 開發（3-4 週）
- [ ] Tauri 項目初始化
- [ ] React/Vue 組件開發
- [ ] 主窗口和導航
- [ ] 上課視圖
- [ ] 筆記視圖
- [ ] 設置視圖
- [ ] **Tauri 後端命令開發**（啟動/停止 Python 服務）
- [ ] **應用打包配置**（Tauri Builder）

#### 階段四：核心功能集成（2-3 週）
- [ ] 音頻錄製（前端 Web Audio API + Rust cpal）
- [ ] Tauri Commands 通信
- [ ] Whisper 轉錄集成（whisper-rs）
- [ ] PDF 查看器（PDF.js）
- [ ] 字幕顯示
- [ ] 數據存儲集成（SQLite）

#### 階段五：測試和優化（2-3 週）
- [ ] 功能測試
- [ ] 性能測試（延遲、內存、CPU）
- [ ] **Whisper 性能測試**（確認 < 2 秒延遲）
- [ ] 跨平台測試
- [ ] **打包測試**（單一可執行檔）
- [ ] **應用體積優化**
- [ ] 錯誤處理和日誌
- [ ] 文檔完善

**總開發時間**：**11-15 週（2.5-3.5 個月）**

### 15.2 關鍵里程碑

**里程碑 1：原型驗證（第 2 週）**
- ✅ 最小原型完成
- ✅ IPC 延遲測試通過（< 100ms）
- ✅ 轉錄功能測試通過（< 2 秒）

**里程碑 2：後端完成（第 5 週）**
- ✅ Python 服務完整實現
- ✅ 所有 API 端點完成
- ✅ 單元測試通過

**里程碑 3：前端完成（第 9 週）**
- ✅ 所有 UI 組件完成
- ✅ 前端功能完整
- ✅ 集成測試通過

**里程碑 4：MVP 完成（第 13 週）**
- ✅ 所有核心功能完成
- ✅ 性能測試通過
- ✅ 文檔完成

### 15.3 風險緩解

**風險 1：Whisper Rust 實現性能不足**
- **緩解**：先實現原型，測試 whisper-rs 性能
- **測試**：對比 whisper-rs 與 faster-whisper 的性能
- **決策點**：如果延遲 > 2 秒，考慮使用 whisper.cpp (FFI)
- **備選**：如性能不足，考慮使用 whisper.cpp 的 C++ 實現

**風險 2：Rust 音頻處理複雜度**
- **緩解**：使用成熟的 cpal 庫
- **測試**：在不同平台測試音頻錄製
- **備選**：如不可行，前端使用 Web Audio API

**風險 3：前端音頻錄製**
- **緩解**：使用成熟的 Web Audio API
- **備選**：如不可行，使用 Rust 後端錄音

**風險 4：Whisper Rust 實現性能**
- **緩解**：先實現原型，測試 whisper-rs 性能
- **測試**：對比 whisper-rs 與 faster-whisper 的性能
- **決策點**：如果延遲 > 2 秒，考慮使用 whisper.cpp (FFI)
- **備選**：如性能不足，考慮使用 whisper.cpp 的 C++ 實現

**風險 5：打包和分發**
- **緩解**：使用 Tauri 標準打包流程
- **測試**：在不同平台測試打包結果
- **體積**：優化打包體積（移除未使用的依賴）

---

## 16. 打包和分發

### 16.1 架構說明

**重要澄清**：
- ✅ **Tauri 的前後端是應用內部的架構**，不是需要用戶額外啟動的服務
- ✅ **Python 後端服務作為子進程**，由 Tauri 應用自動啟動和管理
- ✅ **最終打包成單一可執行檔**，用戶只需雙擊應用圖標

### 16.2 打包架構

```
用戶視角：
┌─────────────────────────────┐
│   ClassNote AI.app          │  ← 用戶只需這個文件
│   (或 ClassNote AI.exe)     │
│   純 Rust 實現，無需 Python  │
└─────────────────────────────┘
         │
         │ 雙擊啟動
         ▼
┌─────────────────────────────┐
│   Tauri 應用啟動            │
│   └─> Rust 後端就緒         │  ← 同進程，零啟動時間
│   └─> 應用就緒             │
└─────────────────────────────┘
```

### 16.3 技術實現

#### 16.3.1 Rust 後端實現

所有功能在 Rust 中實現，無需額外打包：

```rust
// src-tauri/src/main.rs
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            start_recording,
            stop_recording,
            save_lecture,
            load_lecture,
        ])
        .run(tauri::generate_context!())
        .expect("運行 Tauri 應用失敗");
}

// src-tauri/src/commands.rs
#[tauri::command]
async fn transcribe_audio(
    audio_data: Vec<u8>,
    sample_rate: u32,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    // 直接調用 Rust Whisper 服務
    whisper::transcribe(audio_data, sample_rate, language)
        .await
        .map_err(|e| e.to_string())
}
```

#### 16.3.2 Tauri 打包

使用標準 Tauri 打包流程：

```bash
# 打包應用
npm run tauri build

# 生成的可執行檔：
# macOS: ClassNote AI.app
# Windows: ClassNote AI.exe
# Linux: ClassNote AI (AppImage 或 .deb)
```

**優勢**：
- ✅ **無需額外打包工具**：Tauri 自動處理
- ✅ **單一可執行檔**：所有依賴已打包
- ✅ **無需 Python 運行時**：純 Rust 實現

### 16.4 最終用戶體驗

**用戶操作流程**：
1. 下載 `ClassNote AI.app`（macOS）或 `ClassNote AI.exe`（Windows）
2. 雙擊應用圖標
3. **應用自動啟動，無需任何額外操作**
4. 應用就緒，可以立即使用

**用戶不需要**：
- ❌ 安裝 Python
- ❌ 手動啟動任何服務
- ❌ 配置任何環境變量
- ❌ 打開終端或命令行

**應用自動處理**：
- ✅ 啟動 Python 後端服務
- ✅ 管理服務生命週期
- ✅ 處理服務崩潰和重啟
- ✅ 關閉時清理資源

### 16.5 打包體積

**預估體積**：
- Tauri 前端：3-10MB
- Rust 後端（編譯後）：10-20MB（包含所有依賴）
- Whisper 模型：500MB - 3GB（首次下載，可選）
- **總計**：約 15-30MB（不含模型）

**優勢**：
- ✅ **體積更小**：無需 Python 運行時（節省 50-100MB）
- ✅ **啟動更快**：無需啟動子進程
- ✅ **性能更好**：原生 Rust 性能

**優化方案**：
- 使用 `strip` 移除調試符號（可減少 20-30%）
- 使用 LTO（Link Time Optimization）優化
- 模型按需下載（不包含在應用中）

### 16.6 分發方式

**macOS**：
- `.app` 文件（可直接運行）
- `.dmg` 磁盤映像（推薦分發方式）

**Windows**：
- `.exe` 文件（可直接運行）
- `.msi` 安裝程序（推薦分發方式）

**Linux**：
- AppImage（可直接運行）
- `.deb` 包（Debian/Ubuntu）
- `.rpm` 包（Fedora/RHEL）

---

## 附錄

### A. 術語表

- **ASR**: Automatic Speech Recognition，自動語音識別
- **VAD**: Voice Activity Detection，語音活動檢測
- **LLM**: Large Language Model，大語言模型
- **RAG**: Retrieval-Augmented Generation，檢索增強生成
- **MVP**: Minimum Viable Product，最小可行產品
- **IPC**: Inter-Process Communication，進程間通信

### B. 參考資源

- [Tauri 官方文檔](https://tauri.app/)
- [React 官方文檔](https://react.dev/)
- [FastAPI 文檔](https://fastapi.tiangolo.com/)
- [Whisper 論文](https://cdn.openai.com/papers/whisper.pdf)
- [PDF.js 文檔](https://mozilla.github.io/pdf.js/)

### C. 版本歷史

| 版本 | 日期 | 變更說明 |
|------|------|----------|
| v1.0 | 2025-12-01 | Tauri 版本 PRD 初稿 |

---

**文檔維護者**: ClassNote AI Team  
**最後更新**: 2025-12-01

