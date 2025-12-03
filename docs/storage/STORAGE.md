# 數據存儲功能文檔

**更新日期**: 2024年12月

## 📋 概述

本文檔描述 ClassNote AI 的數據存儲功能實現，包括 SQLite 數據庫集成、數據模型定義、CRUD 操作和前端集成。

## 🎯 功能特性

### 已實現功能 ✅

- ✅ SQLite 數據庫集成（使用 rusqlite）
- ✅ 數據庫自動初始化（應用啟動時）
- ✅ 課程數據存儲（Lecture）
- ✅ 字幕數據存儲（Subtitle）
- ✅ 筆記數據存儲（Note）
- ✅ 設置數據存儲（Setting）
- ✅ 完整的 CRUD 操作
- ✅ 級聯刪除支持
- ✅ 前端服務封裝（storageService.ts）
- ✅ 設置頁面集成

## 📊 數據庫結構

### 表結構

#### lectures 表
```sql
CREATE TABLE lectures (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    duration INTEGER NOT NULL,
    pdf_path TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

#### subtitles 表
```sql
CREATE TABLE subtitles (
    id TEXT PRIMARY KEY,
    lecture_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    text_en TEXT NOT NULL,
    text_zh TEXT,
    type TEXT NOT NULL,
    confidence REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
);

CREATE INDEX idx_subtitles_lecture_id ON subtitles(lecture_id);
CREATE INDEX idx_subtitles_timestamp ON subtitles(lecture_id, timestamp);
```

#### notes 表
```sql
CREATE TABLE notes (
    lecture_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
);
```

#### settings 表
```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

## 🔧 技術實現

### Rust 後端

#### 模塊結構
```
src-tauri/src/storage/
├── mod.rs           # 模塊導出和數據庫管理器
├── database.rs      # 數據庫連接和 CRUD 操作
└── models.rs        # 數據模型定義
```

#### 核心組件

1. **DatabaseManager**
   - 管理數據庫路徑
   - 初始化數據庫連接
   - 線程安全的數據庫訪問

2. **Database**
   - 封裝 SQLite 連接
   - 實現所有 CRUD 操作
   - 處理數據庫事務

3. **數據模型**
   - `Lecture`: 課程數據模型
   - `Subtitle`: 字幕數據模型
   - `Note`: 筆記數據模型
   - `Setting`: 設置數據模型

#### Tauri Commands

所有數據庫操作都通過 Tauri Commands 暴露給前端：

- `save_lecture` - 保存課程
- `get_lecture` - 獲取課程
- `list_lectures` - 列出所有課程
- `delete_lecture` - 刪除課程
- `update_lecture_status` - 更新課程狀態
- `save_subtitle` - 保存字幕
- `save_subtitles` - 批量保存字幕
- `get_subtitles` - 獲取課程的所有字幕
- `save_setting` - 保存設置
- `get_setting` - 獲取設置
- `get_all_settings` - 獲取所有設置

### 前端集成

#### storageService.ts

封裝所有數據庫操作的 TypeScript 服務：

```typescript
import { storageService } from '../services/storageService';

// 保存課程
await storageService.saveLecture(lecture);

// 獲取課程
const lecture = await storageService.getLecture(id);

// 保存設置
await storageService.saveAppSettings(settings);

// 獲取設置
const settings = await storageService.getAppSettings();
```

#### SettingsView 組件

設置頁面已集成數據庫功能：
- 應用啟動時自動加載設置
- 保存設置到數據庫
- 顯示保存狀態反饋

## 📝 使用示例

### 保存課程

```typescript
const lecture: Lecture = {
  id: uuid(),
  title: "機器學習基礎",
  date: new Date().toISOString(),
  duration: 3600,
  pdf_path: "/path/to/lecture.pdf",
  status: "recording",
  subtitles: [],
};

await storageService.saveLecture(lecture);
```

### 保存字幕

```typescript
const subtitle: Subtitle = {
  id: uuid(),
  lecture_id: lecture.id,
  timestamp: 10.5,
  text_en: "Hello world",
  text_zh: "你好世界",
  type: "rough",
  confidence: 0.95,
};

await storageService.saveSubtitle(subtitle);
```

### 批量保存字幕

```typescript
const subtitles: Subtitle[] = [
  { /* subtitle 1 */ },
  { /* subtitle 2 */ },
  { /* subtitle 3 */ },
];

await storageService.saveSubtitles(subtitles);
```

### 保存設置

```typescript
const settings: AppSettings = {
  server: { url: "http://localhost", port: 8080, enabled: false },
  audio: { sample_rate: 16000, chunk_duration: 2 },
  subtitle: { font_size: 18, font_color: "#FFFFFF", background_opacity: 0.8, position: "bottom", display_mode: "both" },
  theme: "light",
};

await storageService.saveAppSettings(settings);
```

## 🧪 測試

### 測試覆蓋

所有核心功能都有對應的單元測試：

- ✅ 數據庫初始化測試
- ✅ 課程 CRUD 測試
- ✅ 字幕 CRUD 測試
- ✅ 筆記 CRUD 測試
- ✅ 設置 CRUD 測試
- ✅ 級聯刪除測試
- ✅ 批量操作測試

### 運行測試

```bash
cd src-tauri
cargo test --test test_storage
```

### 測試結果

```
running 11 tests
test test_database_initialization ... ok
test test_save_and_get_lecture ... ok
test test_list_lectures ... ok
test test_delete_lecture ... ok
test test_update_lecture_status ... ok
test test_save_and_get_subtitle ... ok
test test_save_multiple_subtitles ... ok
test test_save_and_get_note ... ok
test test_cascade_delete ... ok
test test_save_and_get_setting ... ok
test test_get_nonexistent_setting ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured
```

## 📍 數據庫位置

數據庫文件存儲在應用數據目錄：

- **macOS**: `~/Library/Application Support/com.classnoteai.app/classnoteai.db`
- **Windows**: `%APPDATA%\com.classnoteai.app\classnoteai.db`
- **Linux**: `~/.local/share/com.classnoteai.app/classnoteai.db`

## 🔒 數據安全

- 所有數據存儲在本地 SQLite 數據庫
- 支持級聯刪除，確保數據一致性
- 使用外鍵約束保證數據完整性
- 時間戳記錄創建和更新時間

## 🚀 後續計劃

### 短期計劃

- [ ] 添加數據導出功能（JSON/CSV）
- [ ] 添加數據導入功能
- [ ] 實現數據備份和恢復
- [ ] 添加數據遷移支持

### 中期計劃

- [ ] 性能優化（連接池、批量操作優化）
- [ ] 添加全文搜索支持
- [ ] 實現數據統計和分析功能
- [ ] 添加數據壓縮和清理功能

## 📚 相關文檔

- `../development/DEVELOPMENT.md` - 開發計劃文檔
- `../ARCHITECTURE.md` - 項目架構文檔

---

**最後更新**: 2024年12月

