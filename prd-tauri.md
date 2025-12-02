# ClassNote AI - Tauri 版本產品需求文檔 (PRD)

**版本**: v1.0  
**日期**: 2025-12-01  
**技術棧**: Tauri (Rust + Web) - 純 Rust 實現  
**狀態**: 規劃階段

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
- [14. 成功指標](#14-成功指標)
- [15. 遷移計劃](#15-遷移計劃)

---

## 1. 產品概述

### 1.1 產品定位

ClassNote AI 是一款基於 Tauri 框架開發的跨平台桌面應用程式，專為需要克服語言障礙的學生設計。提供即時語音識別、智能翻譯、AI 問答和自動筆記生成功能。

### 1.2 核心價值

- **即時理解**：提供低延遲的雙語字幕，幫助學生即時理解課堂內容
- **智能輔助**：AI 助教隨時解答疑問，解釋概念
- **自動整理**：課後自動生成結構化筆記，節省整理時間
- **本地優先**：支持本地模式，保護隱私，減少網絡依賴
- **輕量高效**：應用體積小，啟動快速，資源占用低

### 1.3 技術優勢（Tauri 版本）

- **輕量級**：應用體積小（前端 3-10MB），啟動快速
- **現代化 UI**：使用 Web 技術（React/Vue），UI 靈活豐富
- **高性能**：Rust 後端提供高性能，WebView 渲染流暢
- **跨平台**：支持 macOS、Windows、Linux
- **安全性**：Tauri 提供精細的權限控制和安全機制
- **Python 生態**：後端服務繼續使用 Python，充分利用 AI/ML 庫

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
1. **低延遲字幕**：提供 < 2 秒的即時字幕響應（粗字幕）
2. **高準確度**：ASR 準確度 > 90%，翻譯品質 > 85%
3. **穩定可靠**：支持離線降級模式，確保課堂不中斷
4. **用戶友好**：直觀的 UI/UX，無需複雜設置即可使用
5. **輕量高效**：應用體積 < 30MB，啟動時間 < 1 秒

#### 功能目標
- 即時語音識別（雙層 ASR：粗 → 精）
- 中英雙語字幕實時顯示
- PDF/PPT 課程材料瀏覽
- AI 助教即時問答
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

產品採用**純 Rust 架構**，所有功能在 Tauri 應用內實現，無需 Python：

```
┌─────────────────────────────────────────────────────────┐
│         Tauri 前端 (Rust + Web) - 輕量級 UI             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   UI 層       │  │  前端邏輯     │  │  系統 API    │  │
│  │  (React/Vue) │  │  (TypeScript) │  │  (Rust)      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                  │                  │          │
│         │                  │                  │          │
│         │         Web Audio API (音頻錄製)               │
│         │                                              │
│         └──────────────────┴──────────────────┘          │
│                          │                              │
│              HTTP REST API / WebSocket                  │
│                          │                              │
└──────────────────────────┼──────────────────────────────┘
                           │
                           │  (本地通信)
                           │
┌──────────────────────────┼──────────────────────────────┐
│                          │  Python 後端服務 (FastAPI)   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Whisper     │  │  音頻處理    │  │  其他服務    │  │
│  │  ASR 服務    │  │  服務        │  │  (PDF/存儲)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ⭐ faster-whisper (完全本地處理，無需網絡)            │
│  ⭐ 實時音頻轉錄，延遲 < 2 秒                           │
└─────────────────────────────────────────────────────────┘
                           │
                           │  (可選連接)
                           │
┌──────────────────────────┼──────────────────────────────┐
│                          │  Server (FastAPI) - 可選增強   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  API 層      │  │  AI 服務層    │  │  數據層      │  │
│  │  (FastAPI)   │  │  (Whisper/   │  │  (SQLite/    │  │
│  │              │  │   LLM/翻譯)  │  │  向量DB)     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ⚠️ 提供：精字幕、翻譯、AI問答、筆記生成（可選）         │
└─────────────────────────────────────────────────────────┘

關鍵說明：
⭐ = 必須功能（完全本地）
⚠️ = 可選功能（需要服務端）
```

**架構特點**：
- **前端輕量級**：Tauri 前端體積小（3-10MB），啟動快速
- **後端 Python 服務**：繼續使用 faster-whisper，保持性能
- **前後端分離**：通過 HTTP/WebSocket 通信
- **離線優先**：Python 後端服務本地運行，無需網絡

### 4.2 前端架構（Tauri）

#### 4.2.1 模塊劃分

```
Frontend/
├── src/                    # 前端源代碼
│   ├── components/        # React/Vue 組件
│   │   ├── MainWindow.tsx
│   │   ├── LectureView.tsx
│   │   ├── NotesView.tsx
│   │   ├── SettingsView.tsx
│   │   ├── PDFViewer.tsx
│   │   ├── SubtitleWidget.tsx
│   │   └── AIChatWidget.tsx
│   ├── services/          # 前端服務
│   │   ├── api.ts         # API 調用
│   │   ├── audio.ts       # 音頻錄製（Web Audio API）
│   │   └── storage.ts     # 本地存儲（IndexedDB）
│   ├── hooks/             # React Hooks（如使用 React）
│   ├── utils/             # 工具函數
│   └── types/             # TypeScript 類型定義
│
├── src-tauri/             # Tauri 後端（Rust）
│   ├── src/
│   │   ├── main.rs        # 主入口
│   │   ├── commands.rs    # Tauri 命令
│   │   ├── audio.rs       # 音頻處理（如需要）
│   │   └── system.rs      # 系統 API 調用
│   └── Cargo.toml         # Rust 依賴
│
├── public/                # 靜態資源
└── package.json          # Node.js 依賴
```

#### 4.2.2 核心組件

**主窗口（MainWindow）**
- 使用 React/Vue 組件
- 包含導航欄、內容區域
- 管理多個視圖（上課、筆記、設置）

**上課視圖（LectureView）**
- PDF 查看器區域（PDF.js）
- 字幕顯示區域
- 控制面板（開始/停止錄音、連接狀態）
- AI 助教面板

**筆記視圖（NotesView）**
- 課程列表側邊欄
- 筆記內容顯示區
- 導出功能按鈕

**設置視圖（SettingsView）**
- 服務器連接設置
- 音頻設備選擇
- 模型選擇（Whisper 大小）
- 字幕顯示設置
- 隱私設置

### 4.3 Rust 後端架構（純 Rust 實現）

**重要說明**：
- **所有功能在 Rust 中實現**，無需 Python
- **同進程調用**：前端通過 Tauri Commands 直接調用 Rust 後端
- **零 IPC 開銷**：無需 HTTP/WebSocket 通信
- **用戶體驗**：用戶只需雙擊應用圖標，應用完全自動化

#### 4.3.1 Rust 服務模塊

```
src-tauri/src/
├── main.rs                 # Tauri 應用入口
├── commands.rs            # Tauri Commands（API 接口）
├── whisper/               # Whisper ASR 服務
│   ├── mod.rs
│   ├── model.rs           # 模型管理
│   └── transcribe.rs      # 轉錄邏輯
├── audio/                 # 音頻處理
│   ├── mod.rs
│   ├── recorder.rs        # 音頻錄製（cpal）
│   ├── processor.rs       # 音頻處理
│   └── vad.rs             # 語音活動檢測
├── storage/               # 數據存儲
│   ├── mod.rs
│   ├── database.rs        # SQLite 數據庫
│   └── models.rs          # 數據模型
├── pdf/                   # PDF 處理（可選）
│   ├── mod.rs
│   └── viewer.rs          # PDF 解析
└── utils/                 # 工具函數
    ├── config.rs          # 配置管理
    └── error.rs           # 錯誤處理
```

#### 4.3.2 Tauri Commands API

**直接調用，無 HTTP 開銷**：

```rust
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

#[tauri::command]
async fn start_recording(device_id: Option<u32>) -> Result<(), String> {
    audio::recorder::start(device_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_recording() -> Result<Vec<u8>, String> {
    audio::recorder::stop()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_lecture(lecture: Lecture) -> Result<(), String> {
    storage::save_lecture(lecture)
        .map_err(|e| e.to_string())
}
```

**前端調用示例**：
```typescript
// 前端直接調用，無 HTTP 開銷
import { invoke } from '@tauri-apps/api/tauri';

const result = await invoke('transcribe_audio', {
  audioData: audioBuffer,
  sampleRate: 16000,
  language: 'en'
});
```

#### 4.3.3 核心 Rust 庫

**Whisper ASR**：
- `whisper-rs`：Rust 綁定的 Whisper
- 或 `whisper.cpp`：C++ 實現，通過 Rust FFI 調用

**音頻處理**：
- `cpal`：跨平台音頻錄製
- `webrtc-vad-rs`：語音活動檢測
- `rubato`：音頻重採樣

**數據存儲**：
- `rusqlite`：SQLite 數據庫
- `serde`：序列化/反序列化

**PDF 處理**（可選）：
- `pdf` 或 `lopdf`：PDF 解析
- 或使用前端 PDF.js（推薦）

### 4.4 遠程服務端（可選增強）

**重要說明**：遠程服務端為可選增強功能，用於提供高品質的精字幕和翻譯。本地 Rust 服務提供粗字幕，完全獨立運行。

遠程服務端可以使用任何技術棧（FastAPI + Python 或其他），提供：
- Whisper Large ASR（精字幕，可選）
- 翻譯服務（中英翻譯，可選）
- LLM 問答（AI 助教，可選）
- 課後筆記生成（可選）
- 向量索引（未來）

**離線模式**：
- 本地 Rust 服務無遠程服務端連接時，仍可正常使用
- 僅顯示粗字幕（英文），無翻譯
- AI 助教功能不可用（如需要）
- 課後筆記生成功能不可用（如需要）

### 4.4 遠程服務端（可選增強）

**重要說明**：遠程服務端為可選增強功能，用於提供高品質的精字幕和翻譯。本地 Python 服務提供粗字幕，完全獨立運行。

遠程服務端繼續使用 FastAPI + Python，提供：
- Whisper Large ASR（精字幕，可選）
- 翻譯服務（中英翻譯，可選）
- LLM 問答（AI 助教，可選）
- 課後筆記生成（可選）
- 向量索引（未來）

**離線模式**：
- 本地 Python 服務無遠程服務端連接時，仍可正常使用
- 僅顯示粗字幕（英文），無翻譯
- AI 助教功能不可用（如需要）
- 課後筆記生成功能不可用（如需要）

---

## 5. 核心功能需求

### 5.1 課程材料瀏覽（PDF Viewer）

#### 功能描述
提供課程材料的瀏覽功能，支持 PDF。

#### 詳細需求

**PDF 查看器**
- ✅ 支持 PDF 文件打開和顯示（PDF.js）
- ✅ 頁面導航（上一頁/下一頁/跳轉）
- ✅ 縮放功能（放大/縮小/適應窗口）
- ✅ 文本選擇和複製
- ✅ 當前頁面文本提取（供 LLM 上下文使用）
- ⏸️ 高亮和註記（未來版本）

**PPT 支持**
- ✅ 自動轉換 PPT 為 PDF（後端處理）
- ✅ 轉換後按 PDF 方式顯示

**UI 要求**
- 清晰的頁面指示器（當前頁/總頁數）
- 快捷鍵支持（方向鍵翻頁、Ctrl+滾輪縮放）
- 響應式布局，適應窗口大小

### 5.2 語音輸入與即時字幕

#### 功能描述
實現雙層 ASR 系統：**本地 Rust 服務快速識別（粗字幕）** + **遠程服務端精細識別（精字幕）**。

**重要說明**：粗字幕完全在本地 Rust 服務處理，不依賴遠程服務端。遠程服務端僅用於生成高品質的精字幕和翻譯。

#### 詳細需求

**音頻錄製（前端）**
- ✅ 使用 Web Audio API 錄製麥克風
- ✅ 麥克風設備選擇
- ✅ 音頻格式：16kHz, 16-bit, Mono（Whisper 標準）
- ✅ 實時音頻流處理
- ✅ 音量監控和可視化

**語音活動檢測（VAD）**
- ✅ 前端或後端自動檢測語音活動
- ✅ 過濾靜音片段，避免發送空白音頻
- ✅ 可配置靈敏度

**本地 Rust 服務 ASR（粗字幕）** ⭐ **完全本地處理**
- ✅ 使用 whisper-rs 或 whisper.cpp（Rust 實現）
- ✅ 音頻切片（2-4 秒）
- ✅ **在本地 Rust 服務實時轉錄，延遲 < 2 秒**
- ✅ **粗字幕立即顯示，不等待遠程服務端**
- ✅ 字幕緩存（最近 2-5 分鐘）
- ✅ **支持完全離線模式**（無遠程服務端連接時仍可工作）

**通信方式**
- ✅ Tauri Commands（直接調用，零 IPC 開銷）
- ✅ 同進程調用，無需 HTTP/WebSocket

**延遲優勢**
- ✅ **零 IPC 開銷**：直接函數調用
- ✅ **總延遲僅為處理時間**：< 2 秒（無通信延遲）

**遠程服務端 ASR（精字幕）** - 可選增強功能
- ✅ 將音頻切片**並行**發送到遠程服務端（不阻塞粗字幕顯示）
- ✅ 遠程服務端使用 Whisper Large 模型處理
- ✅ 接收精細 transcript 和中文翻譯
- ✅ 自動替換粗字幕為精字幕（當遠程服務端響應到達時）
- ⚠️ **網絡異常時不影響粗字幕顯示**（自動降級到純本地模式）
- ⚠️ **遠程服務端為可選**：無遠程服務端時，應用仍可正常使用（僅顯示粗字幕）

**字幕顯示**
- ✅ 實時更新字幕內容
- ✅ 粗字幕 → 精字幕自動覆蓋
- ✅ 時間戳顯示
- ✅ 字幕歷史記錄（可滾動查看）

**網絡處理**
- ✅ 自動重連機制（僅影響精字幕和翻譯功能）
- ✅ 網絡異常時顯示提示，但不影響粗字幕顯示
- ✅ **完全支持離線模式**：無遠程服務端連接時，僅顯示粗字幕（英文），仍可正常使用
- ✅ 遠程服務端連接恢復後，自動恢復精字幕和翻譯功能

### 5.3 中英雙語字幕

#### 功能描述
顯示中英文對照字幕，幫助用戶理解內容。

#### 詳細需求

**字幕格式**
- ✅ 英文原文（上方）
- ✅ 中文翻譯（下方）
- ✅ 可切換顯示模式：
  - 僅英文
  - 僅中文
  - 中英對照（默認）

**字幕樣式**
- ✅ 字體大小可調（12pt - 24pt）
- ✅ 字體顏色可自定義
- ✅ 背景透明度可調
- ✅ 字幕位置可調整（底部/頂部/浮動）

**字幕功能**
- ✅ 每句字幕帶時間戳
- ✅ 字幕歷史記錄（可查看完整記錄）
- ✅ 字幕搜索功能
- ✅ 字幕導出（文本文件）

### 5.4 AI 助教（LLM Floating Assistant）

#### 功能描述
提供對話面板，用戶可以隨時提問，AI 基於上下文回答。

#### 詳細需求

**對話窗口**
- ✅ 固定面板（可調整大小）
- ✅ 對話歷史顯示
- ✅ 輸入框和發送按鈕
- ✅ 加載狀態指示

**提問類型**
- ✅ 解釋剛剛那句字幕
- ✅ 總結最近 1-5 分鐘內容
- ✅ 解釋 PDF 當前頁面內容
- ✅ 自由提問（基於課堂上下文）

**上下文提供**
- ✅ 最近 N 秒字幕（可配置）
- ✅ 當前 PDF 頁面文本
- ✅ 課程主題和元數據

**回答顯示**
- ✅ Markdown 格式支持
- ✅ 代碼高亮（如適用）
- ✅ 複製回答功能
- ✅ 導出對話記錄

### 5.5 課後筆記生成

#### 功能描述
課程結束後，自動生成結構化的課堂筆記。

#### 詳細需求

**筆記內容**
- ✅ 全堂課 transcript（中英對照）
- ✅ 主題分段與摘要
- ✅ 關鍵詞表（含解釋）
- ✅ 所有 LLM Q&A 記錄
- ✅ 課程元數據（日期、時長、PDF 文件名）

**筆記格式**
- ✅ Markdown 格式
- ✅ 結構化章節
- ✅ 時間軸標記
- ✅ 關鍵詞高亮

**筆記管理**
- ✅ 課程列表顯示
- ✅ 筆記預覽
- ✅ 筆記搜索
- ✅ 筆記導出（Markdown / PDF）

**生成流程**
- ✅ 課程結束後自動觸發
- ✅ 生成進度顯示
- ✅ 生成完成通知
- ✅ 支持手動重新生成

### 5.6 設置與配置

#### 功能描述
提供完整的應用設置界面。

#### 詳細需求

**服務器設置**
- ✅ 遠程服務器 URL 和端口配置
- ✅ 連接測試功能
- ✅ 本地模式開關
- ✅ 自動重連設置

**音頻設置**
- ✅ 麥克風設備選擇
- ✅ 採樣率設置
- ✅ 音頻切片時長
- ✅ VAD 靈敏度

**模型設置**
- ✅ Whisper 模型選擇（Tiny/Base/Small）
- ✅ 語言選擇（自動/英文/中文）
- ✅ 模型下載和管理

**字幕設置**
- ✅ 字體大小和顏色
- ✅ 顯示模式（僅英文/僅中文/對照）
- ✅ 字幕位置
- ✅ 背景透明度

**隱私設置**
- ✅ 本地模式開關
- ✅ 數據清除功能
- ✅ 錄音權限管理

---

## 6. 用戶流程

### 6.1 首次啟動流程

1. **啟動應用**
   - 用戶雙擊應用圖標（`ClassNote AI.app` / `ClassNote AI.exe`）
   - Tauri 應用啟動（< 1 秒）
   - Rust 後端就緒（同進程，零啟動時間）
   - 檢查系統權限（麥克風、文件訪問）
   - 顯示主窗口
   - **用戶無需任何額外操作**，應用完全自動化

2. **初始設置**
   - 選擇麥克風設備
   - 配置遠程服務器連接（或選擇本地模式）
   - 下載 Whisper 模型（如需要）
   - 完成設置嚮導

### 6.2 上課流程（Live Lecture Flow）

1. **準備階段**
   - 打開應用
   - 載入 PDF/PPT 課程材料
   - 檢查 Whisper 模型是否就緒
   - 檢查遠程服務器連接（如使用）

2. **開始上課**
   - 點擊「開始上課」按鈕
   - 輸入課程信息（課程名、日期等）
   - 點擊「開始錄音」

3. **實時處理**
   - 前端開始錄音（Web Audio API）
   - 音頻數據通過 Tauri Commands 發送到 Rust 後端（直接調用）
   - **本地 Rust 服務 Whisper 立即處理音頻，生成粗字幕（< 2 秒延遲）**
   - **粗字幕立即顯示在界面上（完全本地，無需等待遠程服務端）**
   - **同時**，音頻切片並行發送到遠程服務端（不阻塞粗字幕顯示）
   - 遠程服務端處理後返回精字幕和中文翻譯
   - 當遠程服務端響應到達時，精字幕自動替換粗字幕
   - ⚠️ **即使遠程服務端無響應，粗字幕仍持續顯示**（離線模式）

4. **互動功能**
   - 用戶可隨時打開 AI 助教面板
   - 提問關於當前內容的問題
   - 查看 PDF 當前頁面
   - 調整字幕顯示設置

5. **結束課程**
   - 點擊「停止錄音」
   - 點擊「結束課程」
   - 確認後觸發筆記生成

### 6.3 課後流程（Post-Lecture Flow）

1. **筆記生成**
   - 系統自動開始生成筆記
   - 顯示生成進度
   - 生成完成後通知用戶

2. **查看筆記**
   - 切換到「筆記」視圖
   - 選擇課程
   - 查看完整筆記內容

3. **導出筆記**
   - 點擊「導出 Markdown」
   - 或點擊「導出 PDF」
   - 選擇保存位置
   - 完成導出

### 6.4 設置流程

1. **打開設置**
   - 從導航欄打開設置
   - 或使用快捷鍵（Ctrl+,）

2. **修改設置**
   - 在各個分類中修改設置
   - 實時預覽效果（如字幕樣式）

3. **保存設置**
   - 點擊「保存」按鈕
   - 設置立即生效
   - 部分設置需要重啟應用

---

## 7. 技術規格

### 7.1 前端技術棧（Tauri）

#### 核心框架
- **UI 框架**: React 18+ / Vue 3+ / Svelte（推薦 React）
- **語言**: TypeScript
- **樣式**: Tailwind CSS / CSS Modules
- **狀態管理**: Zustand / Pinia（如使用 Vue）
- **路由**: React Router / Vue Router
- **PDF 渲染**: PDF.js
- **音頻錄製**: Web Audio API

#### 依賴庫
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-fs": "^2.0.0",
    "pdfjs-dist": "^4.0.0",
    "tailwindcss": "^3.4.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

#### Rust 後端（Tauri）
```toml
[dependencies]
tauri = { version = "2.0", features = ["shell-open"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1.35", features = ["full"] }
```

### 7.2 後端技術棧（Python FastAPI）

#### 核心框架
- **Web 框架**: FastAPI
- **Python 版本**: Python 3.12+
- **ASR**: faster-whisper
- **音頻處理**: sounddevice, numpy
- **PDF 處理**: PyMuPDF（可選）

#### 依賴庫
```python
# Web 框架
fastapi>=0.104.0
uvicorn>=0.24.0

# 音頻
sounddevice>=0.4.6
webrtcvad>=2.0.10
numpy>=2.3.5

# AI/ML
faster-whisper>=1.0.0

# PDF（可選）
PyMuPDF>=1.23.0

# 工具
pydantic>=2.5.0
python-dotenv>=1.0.0
```

### 7.3 通信方式（Tauri Commands）

**無需 HTTP/WebSocket**：前端直接調用 Rust 後端，零 IPC 開銷

#### Tauri Commands API

**轉錄音頻**:
```typescript
// 前端調用
const result = await invoke('transcribe_audio', {
  audioData: Array.from(audioBuffer),  // Vec<u8>
  sampleRate: 16000,
  language: 'en'  // 可選
});

// Rust 實現
#[tauri::command]
async fn transcribe_audio(
    audio_data: Vec<u8>,
    sample_rate: u32,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    whisper::transcribe(audio_data, sample_rate, language).await
}
```

**音頻錄製**:
```typescript
// 前端調用
await invoke('start_recording', { deviceId: null });
const audioData = await invoke('stop_recording');

// Rust 實現
#[tauri::command]
async fn start_recording(device_id: Option<u32>) -> Result<(), String> {
    audio::recorder::start(device_id)
}
```

**數據存儲**:
```typescript
// 前端調用
await invoke('save_lecture', { lecture: lectureData });
const lecture = await invoke('load_lecture', { id: 'lecture_001' });

// Rust 實現
#[tauri::command]
async fn save_lecture(lecture: Lecture) -> Result<(), String> {
    storage::save_lecture(lecture)
}
```

**優勢**：
- ✅ **零 IPC 開銷**：直接函數調用
- ✅ **類型安全**：TypeScript ↔ Rust 類型對應
- ✅ **異步支持**：支持 async/await
- ✅ **錯誤處理**：統一的錯誤處理機制

### 7.4 項目結構

```
classnote-ai-tauri/
├── frontend/               # Tauri 前端
│   ├── src/
│   │   ├── components/    # React/Vue 組件
│   │   ├── services/      # API 服務
│   │   ├── hooks/         # React Hooks
│   │   ├── utils/         # 工具函數
│   │   └── types/         # TypeScript 類型
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
- **響應迅速**：操作反饋及時，流暢的動畫過渡
- **易於使用**：符合用戶習慣，學習成本低
- **視覺舒適**：支持深色/淺色主題，護眼設計
- **一致性**：統一的設計語言和交互模式
- **可訪問性**：支持鍵盤導航，符合無障礙標準

### 8.2 設計系統

#### 8.2.1 設計語言

採用 **Material Design 3** 或 **shadcn/ui** 設計系統：

- **組件庫**：shadcn/ui（基於 Radix UI + Tailwind CSS）
- **設計風格**：現代化、扁平化、微擬物化
- **動畫**：流暢的過渡動畫（Framer Motion）
- **圖標**：Lucide React / Heroicons（現代化線條圖標）

#### 8.2.2 主窗口布局（現代化設計）

```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ClassNote AI                    [🔍] [⚙️] [🌙] [●] [─] [×] │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  [📚 上課]  [📝 筆記]  [⚙️ 設置]     [已連接] [模型就緒]    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌──────────────────────┐  ┌─────────────────────────────┐ │  │
│  │  │                      │  │                             │ │  │
│  │  │                      │  │    ┌─────────────────────┐ │ │  │
│  │  │   PDF 查看器         │  │    │   即時字幕           │ │ │  │
│  │  │                      │  │    │                     │ │ │  │
│  │  │   [📄 第 1/10 頁]    │  │    │   English Text       │ │ │  │
│  │  │                      │  │    │   中文翻譯           │ │ │  │
│  │  │   [◀] [▶] [🔍] [📏]  │  │    │                     │ │ │  │
│  │  │                      │  │    │   ───────────────── │ │ │  │
│  │  │                      │  │    │   字幕歷史           │ │ │  │
│  │  │                      │  │    │   • 00:15 Hello...  │ │ │  │
│  │  │                      │  │    │   • 00:20 World...  │ │ │  │
│  │  └──────────────────────┘  │    └─────────────────────┘ │ │  │
│  │                             │                             │ │  │
│  │                             │    ┌─────────────────────┐ │ │  │
│  │                             │    │   AI 助教           │ │ │  │
│  │                             │    │   ┌───────────────┐ │ │  │
│  │                             │    │   │ 對話歷史       │ │ │  │
│  │                             │    │   └───────────────┘ │ │  │
│  │                             │    │   [💬 輸入問題...]  │ │ │  │
│  │                             │    │   [📤 發送]        │ │ │  │
│  │                             │    └─────────────────────┘ │ │  │
│  │                             └─────────────────────────────┘ │  │
│  │                                                               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  [⏺️ 開始錄音]  [⏸️ 暫停]  [⏹️ 停止]  [📊 音量: ████░░] │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.3 現代化顏色方案

#### 8.3.1 淺色主題（Light Mode）

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

#### 8.3.2 深色主題（Dark Mode）

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

#### 8.3.3 漸變和陰影

**漸變**
- 主漸變：`linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- 成功漸變：`linear-gradient(135deg, #10B981 0%, #059669 100%)`
- 背景漸變：`linear-gradient(180deg, #F9FAFB 0%, #FFFFFF 100%)`

**陰影系統**
- 小陰影：`0 1px 2px 0 rgba(0, 0, 0, 0.05)`
- 中陰影：`0 4px 6px -1px rgba(0, 0, 0, 0.1)`
- 大陰影：`0 10px 15px -3px rgba(0, 0, 0, 0.1)`
- 深色模式：使用發光效果替代陰影

### 8.4 現代化字體系統

#### 8.4.1 字體族

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

#### 8.4.2 字體大小系統

採用 **4px 基準**的字體大小系統：

- **標題 1**：`32px` (2rem) - 主標題
- **標題 2**：`24px` (1.5rem) - 次標題
- **標題 3**：`20px` (1.25rem) - 小標題
- **正文**：`16px` (1rem) - 默認文字
- **小文字**：`14px` (0.875rem) - 輔助文字
- **極小文字**：`12px` (0.75rem) - 標籤、時間戳
- **字幕**：`18px - 24px`（可配置）

#### 8.4.3 字體字重

- **Light**：300 - 大標題
- **Regular**：400 - 正文
- **Medium**：500 - 按鈕、標籤
- **Semibold**：600 - 小標題
- **Bold**：700 - 強調文字

### 8.5 現代化組件設計

#### 8.5.1 按鈕（Button）

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

#### 8.5.2 輸入框（Input）

- 背景：表面色
- 邊框：`1px solid` 邊框色
- 圓角：`8px`
- 內邊距：`12px 16px`
- 聚焦：邊框主色，外發光效果
- 錯誤：邊框錯誤色，紅色提示文字

#### 8.5.3 卡片（Card）

- 背景：卡片色
- 圓角：`12px`
- 陰影：中陰影
- 內邊距：`24px`
- 懸停：提升陰影（可選）

#### 8.5.4 標籤（Badge）

- 背景：主色（10% 透明度）
- 文字：主色
- 圓角：`6px`
- 內邊距：`4px 8px`
- 字體：極小文字，Medium 字重

#### 8.5.5 進度條（Progress）

- 背景：表面色
- 進度：主色漸變
- 圓角：`4px`
- 高度：`8px`
- 動畫：流暢的過渡動畫

#### 8.5.6 開關（Switch）

- 現代化滑動開關
- 背景：禁用時淺灰，啟用時主色
- 滑塊：白色圓形
- 動畫：流暢的滑動動畫

### 8.6 動畫和過渡

#### 8.6.1 過渡動畫

- **淡入淡出**：`opacity 0.2s ease-in-out`
- **滑動**：`transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- **縮放**：`transform 0.2s ease-in-out`
- **顏色變化**：`color 0.2s ease-in-out`

#### 8.6.2 微交互

- **按鈕懸停**：輕微提升（translateY -2px）
- **按鈕點擊**：輕微縮小（scale 0.95）
- **卡片懸停**：提升陰影
- **輸入框聚焦**：外發光效果
- **頁面切換**：淡入淡出 + 滑動

#### 8.6.3 加載動畫

- **骨架屏**：內容加載時顯示骨架屏
- **旋轉加載**：使用現代化的旋轉動畫
- **進度指示**：流暢的進度條動畫

### 8.7 響應式設計

#### 8.7.1 斷點系統

- **小屏幕**：`< 1280px` - 單列布局
- **中屏幕**：`1280px - 1920px` - 雙列布局
- **大屏幕**：`> 1920px` - 三列布局

#### 8.7.2 自適應布局

- 窗口可調整大小
- 組件自動適應窗口大小
- 最小窗口尺寸：`1200px × 700px`
- 支持全屏模式
- 響應式字體大小（可選）

### 8.8 現代化 UI 組件庫

#### 8.8.1 推薦組件庫

**shadcn/ui**（推薦）
- 基於 Radix UI + Tailwind CSS
- 現代化、可定制
- 無需安裝，直接複製代碼
- 支持深色模式

**其他選項**
- **Mantine**：功能豐富的 React 組件庫
- **Chakra UI**：簡潔現代的組件庫
- **Material-UI (MUI)**：Material Design 實現

#### 8.8.2 圖標庫

**Lucide React**（推薦）
- 現代化線條圖標
- 輕量級
- 豐富的圖標集

**其他選項**
- **Heroicons**：Tailwind 官方圖標
- **React Icons**：多個圖標庫集合

### 8.9 視覺層次

#### 8.9.1 間距系統

採用 **4px 基準**的間距系統：

- **xs**：`4px` (0.25rem)
- **sm**：`8px` (0.5rem)
- **md**：`16px` (1rem)
- **lg**：`24px` (1.5rem)
- **xl**：`32px` (2rem)
- **2xl**：`48px` (3rem)

#### 8.9.2 層級系統

- **Level 1**：背景層（z-index: 0）
- **Level 2**：內容層（z-index: 1）
- **Level 3**：卡片層（z-index: 10）
- **Level 4**：浮動元素（z-index: 100）
- **Level 5**：模態框（z-index: 1000）
- **Level 6**：通知（z-index: 2000）

### 8.10 可訪問性（Accessibility）

- **鍵盤導航**：所有交互元素支持鍵盤操作
- **焦點指示**：清晰的焦點指示器
- **對比度**：文字與背景對比度 ≥ 4.5:1
- **ARIA 標籤**：正確的 ARIA 屬性
- **屏幕閱讀器**：支持屏幕閱讀器
- **動畫控制**：支持減少動畫選項（prefers-reduced-motion）

### 8.11 設計工具和資源

#### 8.11.1 設計工具

- **Figma**：UI 設計和原型
- **Tailwind CSS**：樣式框架
- **Framer Motion**：動畫庫

#### 8.11.2 設計資源

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

