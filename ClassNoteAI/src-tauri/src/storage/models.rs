use chrono::Utc;
use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// 科目數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub keywords: Option<String>,                 // 全域關鍵詞
    pub syllabus_info: Option<serde_json::Value>, // 結構化課程大綱
    pub created_at: String,
    pub updated_at: String,
}

impl Course {
    pub fn new(
        title: String,
        description: Option<String>,
        keywords: Option<String>,
        syllabus_info: Option<serde_json::Value>,
    ) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            description,
            keywords,
            syllabus_info,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

impl TryFrom<&Row<'_>> for Course {
    type Error = rusqlite::Error;

    fn try_from(row: &Row<'_>) -> Result<Self, Self::Error> {
        let syllabus_str: Option<String> = row.get(4)?;
        let syllabus_info = syllabus_str.and_then(|s| serde_json::from_str(&s).ok());

        Ok(Course {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            keywords: row.get(3)?,
            syllabus_info,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }
}

/// 課程數據模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lecture {
    pub id: String,
    pub course_id: String, // 關聯的科目 ID
    pub title: String,
    pub date: String,  // ISO 8601
    pub duration: i64, // 秒
    pub pdf_path: Option<String>,
    pub status: String, // "recording" | "completed"
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
            course_id: row.get(1)?,
            title: row.get(2)?,
            date: row.get(3)?,
            duration: row.get(4)?,
            pdf_path: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
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
    #[serde(rename = "type")]
    pub subtitle_type: String, // "rough" | "fine" - 序列化為 "type"
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
