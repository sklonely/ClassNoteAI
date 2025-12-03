use serde::{Deserialize, Serialize};
use chrono::Utc;
use rusqlite::Row;

/// 課程數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lecture {
    pub id: String,
    pub title: String,
    pub date: String, // ISO 8601
    pub duration: i64, // 秒
    pub pdf_path: Option<String>,
    pub status: String, // "recording" | "completed"
    pub created_at: String,
    pub updated_at: String,
}

impl Lecture {
    pub fn new(title: String, pdf_path: Option<String>) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            date: now.clone(),
            duration: 0,
            pdf_path,
            status: "recording".to_string(),
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
            title: row.get(1)?,
            date: row.get(2)?,
            duration: row.get(3)?,
            pdf_path: row.get(4)?,
            status: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }
}

/// 字幕數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    pub id: String,
    pub lecture_id: String,
    pub timestamp: f64, // 秒
    pub text_en: String,
    pub text_zh: Option<String>,
    pub subtitle_type: String, // "rough" | "fine"
    pub confidence: Option<f64>,
    pub created_at: String,
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
            created_at: Utc::now().to_rfc3339(),
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
}

impl Note {
    pub fn new(lecture_id: String, title: String, content: String) -> Self {
        Self {
            lecture_id,
            title,
            content,
            generated_at: Utc::now().to_rfc3339(),
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

