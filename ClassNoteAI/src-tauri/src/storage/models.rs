use chrono::Utc;
use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// 科目數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub keywords: Option<String>,                 // 全域關鍵詞
    pub syllabus_info: Option<serde_json::Value>, // 結構化課程大綱
    /// v0.7.x: Canvas LMS course id (per-user pairing result).
    /// String of digits like `"2042524"` (no `course_` prefix).
    /// `None` when the course hasn't been paired with a Canvas course.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas_course_id: Option<String>,
    pub is_deleted: bool,                         // Soft Delete
    pub created_at: String,
    pub updated_at: String,
}

impl Course {
    pub fn new(
        user_id: String,
        title: String,
        description: Option<String>,
        keywords: Option<String>,
        syllabus_info: Option<serde_json::Value>,
    ) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            user_id,
            title,
            description,
            keywords,
            syllabus_info,
            canvas_course_id: None,
            is_deleted: false,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

impl TryFrom<&Row<'_>> for Course {
    type Error = rusqlite::Error;

    fn try_from(row: &Row<'_>) -> Result<Self, Self::Error> {
        let syllabus_str: Option<String> = row.get(5)?; // Shifted index if needed, check query order!
                                                        // Wait, I will ensure the query in database.rs matches this order.
                                                        // Let's adopt a standard order: standard fields, then is_deleted, then timestamps?
                                                        // Or append is_deleted at the end?
                                                        // Current database.rs query: id, user_id, title, description, keywords, syllabus_info, created_at, updated_at
                                                        // I will append is_deleted at the end of the query in database.rs.

        let syllabus_info = syllabus_str.and_then(|s| serde_json::from_str(&s).ok());

        Ok(Course {
            id: row.get(0)?,
            user_id: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            keywords: row.get(4)?,
            syllabus_info,
            // Assuming is_deleted will be at index 6 (Wait, syllabus_info was 5? No)
            // Original: id(0), user_id(1), title(2), description(3), keywords(4), syllabus_info(5), created_at(6), updated_at(7)
            // New: ..., created_at(6), updated_at(7), is_deleted(8)
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            is_deleted: row.get(8).unwrap_or(false), // Handle case where it might be missing during migration? No, query will fail if column count mismatch.
                                                     // But strict index is safer.
            // v0.7.x: canvas_course_id (index 9). Defensive default to None
            // for SELECT queries that don't include the column or for rows
            // pre-dating the migration.
            canvas_course_id: row.get::<_, Option<String>>(9).unwrap_or(None),
        })
    }
}

/// 課程數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lecture {
    pub id: String,
    pub course_id: String,
    pub title: String,
    pub date: String,
    pub duration: i64,
    pub pdf_path: Option<String>,
    pub audio_path: Option<String>,
    /// v0.6.0+: imported video file path. Staged under
    /// `{app_data}/videos/{lecture_id}.{ext}` by
    /// `import_video_for_lecture`. When populated, Notes Review mode
    /// renders a `<video>` player in place of the audio scrubber and
    /// the subtitles/RAG index are derived from the video's audio
    /// track.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_path: Option<String>,
    pub status: String,
    pub is_deleted: bool, // Soft Delete
    pub created_at: String,
    pub updated_at: String,
}

impl Lecture {
    pub fn new(course_id: String, title: String, pdf_path: Option<String>) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            course_id,
            title,
            date: now.clone(),
            duration: 0,
            pdf_path,
            audio_path: None,
            video_path: None,
            status: "recording".to_string(),
            is_deleted: false,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

impl TryFrom<&Row<'_>> for Lecture {
    type Error = rusqlite::Error;

    fn try_from(row: &Row<'_>) -> Result<Self, Self::Error> {
        Ok(Lecture {
            id: row.get(0)?,
            course_id: row.get(1)?,
            title: row.get(2)?,
            date: row.get(3)?,
            duration: row.get(4)?,
            pdf_path: row.get(5)?,
            audio_path: row.get(6)?,
            status: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            is_deleted: row.get(10).unwrap_or(false), // Append is_deleted at the end (index 10)
            // video_path was added in v0.6.0. Existing SELECTs may not
            // include it yet (column index 11 on updated queries;
            // absent on old ones). Default to None so pre-migration
            // rows don't error.
            video_path: row.get::<_, Option<String>>(11).unwrap_or(None),
        })
    }
}

/// 字幕數據模型
///
/// Phase 7 cp74.1: two orthogonal classifications
///   - `subtitle_type` (column "type"): tier — "rough" | "fine"
///     `fine` rows carry an LLM-refined version of the same line; `rough`
///     is the live ASR / Gemma output.
///   - `source`: provenance — "live" | "imported" | "edited"
///     "live" = produced by recordingSessionService stop pipeline,
///     "imported" = subtitleImportService (SRT / VTT / plain text),
///     "edited" = manual edit from the user (UI not built yet).
///
/// `fine_text` / `fine_translation` columns hold the LLM-refined English
/// and Chinese versions of the same line WITHOUT overwriting the rough
/// originals (per Phase 7 v3 audit feedback — keep both layers).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    pub id: String,
    pub lecture_id: String,
    pub timestamp: f64, // 秒
    pub text_en: String,
    pub text_zh: Option<String>,
    #[serde(rename = "type")]
    pub subtitle_type: String, // "rough" | "fine" - 序列化為 "type"
    pub confidence: Option<f64>,
    #[serde(default)]
    pub speaker_role: Option<String>,
    #[serde(default)]
    pub speaker_id: Option<String>,
    pub created_at: String,

    // ─── Phase 7 cp74.1 (subtitle two-axis schema) ────────────────────
    /// 'live' | 'imported' | 'edited'. Default 'live' for legacy rows.
    #[serde(default = "default_subtitle_source")]
    pub source: String,
    /// LLM-refined English. None on rough-only rows.
    #[serde(default)]
    pub fine_text: Option<String>,
    /// LLM-refined Chinese. None on rough-only rows.
    #[serde(default)]
    pub fine_translation: Option<String>,
    /// Confidence of the fine-tier transcription, when available.
    #[serde(default)]
    pub fine_confidence: Option<f64>,
}

fn default_subtitle_source() -> String {
    "live".to_string()
}

impl Subtitle {
    pub fn new(
        lecture_id: String,
        timestamp: f64,
        text_en: String,
        text_zh: Option<String>,
        subtitle_type: String,
        confidence: Option<f64>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            lecture_id,
            timestamp,
            text_en,
            text_zh,
            subtitle_type,
            confidence,
            speaker_role: None,
            speaker_id: None,
            created_at: Utc::now().to_rfc3339(),
            source: default_subtitle_source(),
            fine_text: None,
            fine_translation: None,
            fine_confidence: None,
        }
    }
}

impl TryFrom<&Row<'_>> for Subtitle {
    type Error = rusqlite::Error;

    fn try_from(row: &Row<'_>) -> Result<Self, Self::Error> {
        Ok(Subtitle {
            id: row.get(0)?,
            lecture_id: row.get(1)?,
            timestamp: row.get(2)?,
            text_en: row.get(3)?,
            text_zh: row.get(4)?,
            subtitle_type: row.get(5)?,
            confidence: row.get(6)?,
            created_at: row.get(7)?,
            source: row
                .get::<_, Option<String>>(8)
                .unwrap_or(None)
                .unwrap_or_else(default_subtitle_source),
            fine_text: row.get(9).unwrap_or(None),
            fine_translation: row.get(10).unwrap_or(None),
            fine_confidence: row.get(11).unwrap_or(None),
            speaker_role: row.get::<_, Option<String>>(12).unwrap_or(None),
            speaker_id: row.get::<_, Option<String>>(13).unwrap_or(None),
        })
    }
}

/// 筆記數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub lecture_id: String,
    pub title: String,
    pub content: String, // JSON 格式存儲 sections 和 qa_records
    pub generated_at: String,
    pub is_deleted: bool,
}

impl Note {
    pub fn new(lecture_id: String, title: String, content: String) -> Self {
        Self {
            lecture_id,
            title,
            content,
            generated_at: Utc::now().to_rfc3339(),
            is_deleted: false,
        }
    }
}

impl TryFrom<&Row<'_>> for Note {
    type Error = rusqlite::Error;

    fn try_from(row: &Row<'_>) -> Result<Self, Self::Error> {
        Ok(Note {
            lecture_id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            generated_at: row.get(3)?,
            is_deleted: row.get(4).unwrap_or(false),
        })
    }
}

/// 設置項數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

impl Setting {
    pub fn new(key: String, value: String) -> Self {
        Self {
            key,
            value,
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

impl TryFrom<&Row<'_>> for Setting {
    type Error = rusqlite::Error;

    fn try_from(row: &Row<'_>) -> Result<Self, Self::Error> {
        Ok(Setting {
            key: row.get(0)?,
            value: row.get(1)?,
            updated_at: row.get(2)?,
        })
    }
}
