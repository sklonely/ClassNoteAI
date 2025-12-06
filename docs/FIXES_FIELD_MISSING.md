# 字段缺失錯誤修復記錄

**修復日期**: 2025-01-XX  
**問題**: `missing field 'created_at'` 等字段缺失錯誤

---

## 🔍 問題分析

### 錯誤信息
```
[LectureView] 創建課程失敗:"invalid args `lecture` for command `save_lecture`: missing field `created_at`"
```

### 根本原因
前端 TypeScript 類型定義與後端 Rust 結構體不匹配：
- 後端 `Lecture` 結構體需要 `created_at` 和 `updated_at` 字段（必需）
- 前端 `Lecture` 接口缺少這些字段
- 創建課程時沒有設置這些字段

---

## ✅ 已修復的問題

### 1. 前端類型定義更新

**文件**: `src/types/index.ts`

**修復前**:
```typescript
export interface Lecture {
  id: string;
  title: string;
  date: string;
  duration: number;
  pdf_path?: string;
  status: "recording" | "completed";
  subtitles: Subtitle[];
  notes?: Note;
}
```

**修復後**:
```typescript
export interface Lecture {
  id: string;
  title: string;
  date: string;
  duration: number;
  pdf_path?: string;
  status: "recording" | "completed";
  created_at: string; // ISO 8601 - 必需字段 ✅
  updated_at: string; // ISO 8601 - 必需字段 ✅
  subtitles?: Subtitle[]; // 可選，用於前端顯示
  notes?: Note;
}
```

### 2. 字幕類型定義更新

**文件**: `src/types/index.ts`

**修復前**:
```typescript
export interface Subtitle {
  id: string;
  timestamp: number;
  text_en: string;
  text_zh?: string;
  type: "rough" | "fine";
  confidence?: number;
}
```

**修復後**:
```typescript
export interface Subtitle {
  id: string;
  lecture_id: string; // 必需字段 ✅
  timestamp: number;
  text_en: string;
  text_zh?: string;
  type: "rough" | "fine";
  confidence?: number;
  created_at: string; // ISO 8601 - 必需字段 ✅
}
```

### 3. 課程創建修復

**文件**: `src/components/LectureView.tsx`

**修復前**:
```typescript
const lecture: Lecture = {
  id: crypto.randomUUID(),
  title,
  date: new Date().toISOString(),
  duration: 0,
  pdf_path: pdfPath || undefined,
  status: "recording",
  subtitles: [],
};
```

**修復後**:
```typescript
const now = new Date().toISOString();
const lecture: Lecture = {
  id: crypto.randomUUID(),
  title,
  date: now,
  duration: 0,
  pdf_path: pdfPath || undefined,
  status: "recording",
  created_at: now, // ✅ 添加
  updated_at: now, // ✅ 添加
  subtitles: [],
};
```

### 4. 課程保存修復

**文件**: `src/components/LectureView.tsx`

**修復**:
- 更新課程時自動更新 `updated_at` 字段
- 確保所有必需字段都存在

```typescript
const updatedLecture: Lecture = {
  ...currentLecture,
  duration,
  status: recordingStatus === "recording" ? "recording" : "completed",
  pdf_path: pdfPath || currentLecture.pdf_path,
  updated_at: new Date().toISOString(), // ✅ 更新時間戳
};
```

### 5. 字幕保存修復

**文件**: `src/services/transcriptionService.ts` 和 `src/components/LectureView.tsx`

**修復**:
- 保存字幕時添加 `created_at` 字段
- 確保所有必需字段都存在

```typescript
const now = new Date().toISOString();
const subtitles = segments.map(seg => ({
  id: seg.id,
  lecture_id: currentLecture.id,
  timestamp: seg.startTime / 1000,
  text_en: seg.displayText || seg.roughText || '',
  text_zh: seg.displayTranslation || seg.roughTranslation || undefined,
  type: (seg.source === 'fine' ? 'fine' : 'rough') as 'rough' | 'fine',
  confidence: undefined,
  created_at: now, // ✅ 添加創建時間
}));
```

### 6. 導入數據修復

**文件**: `src/services/storageService.ts`

**修復**:
- 導入數據時確保所有必需字段都存在
- 如果缺少字段，使用默認值

```typescript
const now = new Date().toISOString();
const lectureToSave: Lecture = {
  id: lecture.id || crypto.randomUUID(),
  title: lecture.title || '未命名課程',
  date: lecture.date || now,
  duration: lecture.duration || 0,
  pdf_path: lecture.pdf_path,
  status: lecture.status || 'completed',
  created_at: lecture.created_at || now, // ✅ 確保存在
  updated_at: lecture.updated_at || now, // ✅ 確保存在
};
```

### 7. 後端字段名映射

**文件**: `src-tauri/src/storage/models.rs`

**修復**:
- 添加 `#[serde(rename = "type")]` 來映射字段名
- 前端使用 `type`，後端使用 `subtitle_type`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    pub id: String,
    pub lecture_id: String,
    pub timestamp: f64,
    pub text_en: String,
    pub text_zh: Option<String>,
    #[serde(rename = "type")] // ✅ 映射字段名
    pub subtitle_type: String,
    pub confidence: Option<f64>,
    pub created_at: String,
}
```

---

## 📋 檢查清單

### 前端類型定義
- [x] `Lecture` 接口包含 `created_at` 和 `updated_at`
- [x] `Subtitle` 接口包含 `lecture_id` 和 `created_at`
- [x] 所有字段類型與後端匹配

### 數據創建
- [x] `handleCreateCourse` 設置所有必需字段
- [x] `handleSaveCourse` 更新 `updated_at`
- [x] 字幕保存時設置 `created_at`

### 數據導入
- [x] 導入數據時確保所有必需字段存在
- [x] 缺少字段時使用合理的默認值

### 後端序列化
- [x] 字段名映射正確（`subtitle_type` ↔ `type`）
- [x] 所有必需字段在後端結構體中定義

---

## 🎯 驗證方法

1. **創建新課程**
   - 應該成功創建，無錯誤
   - 檢查數據庫中 `created_at` 和 `updated_at` 是否正確設置

2. **保存課程**
   - 應該成功保存
   - 檢查 `updated_at` 是否更新

3. **保存字幕**
   - 應該成功保存
   - 檢查 `created_at` 是否正確設置

4. **導入數據**
   - 應該成功導入
   - 檢查所有字段是否正確

---

## 📝 注意事項

1. **時間戳格式**: 所有時間戳使用 ISO 8601 格式（`new Date().toISOString()`）
2. **字段必需性**: `created_at` 和 `updated_at` 是必需字段，不能為空
3. **字段名映射**: 後端 `subtitle_type` 序列化為前端的 `type`
4. **數據庫兼容性**: 確保數據庫表結構與類型定義匹配

---

## ✅ 修復完成

所有字段缺失錯誤已修復，應用現在應該可以正常創建和保存課程。


