use axum::{
    extract::{State, Query},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use crate::{AppState, db::{Course, Lecture}};

// ============================================================
// EXISTING STRUCTURES
// ============================================================

#[derive(Debug, Deserialize, Serialize)]
pub struct PushRequest {
    pub username: String,
    pub courses: Vec<Course>,
    pub lectures: Vec<Lecture>,
    pub notes: Option<Vec<NoteResponse>>,
    // NEW
    pub subtitles: Option<Vec<LectureSubtitles>>,
    pub settings: Option<Vec<SettingSync>>,
    pub chat_sessions: Option<Vec<ChatSessionSync>>,
    pub chat_messages: Option<Vec<ChatMessageSync>>,
}

#[derive(Debug, Deserialize)]
pub struct PullQuery {
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct PullResponse {
    pub courses: Vec<Course>,
    pub lectures: Vec<Lecture>,
    pub notes: Vec<NoteResponse>,
    // NEW
    pub subtitles: Vec<SubtitleSync>,
    pub settings: Vec<SettingSync>,
    pub chat_sessions: Vec<ChatSessionSync>,
    pub chat_messages: Vec<ChatMessageSync>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteResponse {
    pub lecture_id: String,
    pub title: String,
    pub content: String,
    pub generated_at: String,
    pub is_deleted: Option<bool>,
}

// ============================================================
// NEW STRUCTURES
// ============================================================

/// Subtitles grouped by lecture (for Push)
#[derive(Debug, Serialize, Deserialize)]
pub struct LectureSubtitles {
    pub lecture_id: String,
    pub items: Vec<SubtitleSync>,
}

/// Individual subtitle
#[derive(Debug, Serialize, Deserialize)]
pub struct SubtitleSync {
    pub id: String,
    pub lecture_id: String,
    pub timestamp: f64,
    pub text_en: String,
    pub text_zh: Option<String>,
    pub sub_type: String, // 'rough' | 'fine'
    pub confidence: Option<f64>,
    pub created_at: String,
}

/// User setting
#[derive(Debug, Serialize, Deserialize)]
pub struct SettingSync {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

/// Chat session
#[derive(Debug, Serialize, Deserialize)]
pub struct ChatSessionSync {
    pub id: String,
    pub lecture_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_deleted: Option<bool>,
}

/// Chat message
#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessageSync {
    pub id: String,
    pub session_id: String,
    pub role: String, // 'user' | 'assistant'
    pub content: String,
    pub sources: Option<String>, // JSON stringified
    pub timestamp: String,
}

// ============================================================
// HANDLERS
// ============================================================

pub async fn push_data(
    State(state): State<AppState>,
    Json(req): Json<PushRequest>,
) -> Result<StatusCode, StatusCode> {
    let db = state.db.lock().await;
    
    // 1. Ensure user exists
    if let Err(e) = db.create_user(&req.username) {
        tracing::error!("Failed to create user: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // 2. Upsert Courses
    for course in req.courses {
        if let Err(e) = db.upsert_course(&course) {
             tracing::error!("Failed to upsert course {}: {}", course.id, e);
             return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    // 3. Upsert Lectures
    for lecture in req.lectures {
        if let Err(e) = db.upsert_lecture(&lecture) {
            tracing::error!("Failed to upsert lecture {}: {}", lecture.id, e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    // 4. Upsert Notes
    if let Some(notes) = req.notes {
        for note in notes {
            if let Err(e) = db.upsert_note(&note.lecture_id, &note.title, &note.content, note.is_deleted.unwrap_or(false)) {
                tracing::error!("Failed to upsert note for lecture {}: {}", note.lecture_id, e);
            }
        }
    }

    // 5. Upsert Subtitles (full replacement per lecture)
    if let Some(subtitles_by_lecture) = req.subtitles {
        for ls in subtitles_by_lecture {
            // Delete existing
            if let Err(e) = db.delete_subtitles_by_lecture(&ls.lecture_id) {
                tracing::error!("Failed to delete subtitles for lecture {}: {}", ls.lecture_id, e);
            }
            // Insert new
            let subs: Vec<_> = ls.items.iter().map(|s| (
                s.id.clone(),
                s.lecture_id.clone(),
                s.timestamp,
                s.text_en.clone(),
                s.text_zh.clone(),
                s.sub_type.clone(),
                s.confidence,
                s.created_at.clone(),
            )).collect();
            if let Err(e) = db.insert_subtitles(&subs) {
                tracing::error!("Failed to insert subtitles for lecture {}: {}", ls.lecture_id, e);
            }
        }
    }

    // 6. Upsert Settings
    if let Some(settings) = req.settings {
        for s in settings {
            if let Err(e) = db.upsert_setting(&req.username, &s.key, &s.value, &s.updated_at) {
                tracing::error!("Failed to upsert setting {}: {}", s.key, e);
            }
        }
    }

    // 7. Upsert Chat Sessions
    if let Some(sessions) = req.chat_sessions {
        for s in sessions {
            if let Err(e) = db.upsert_chat_session(
                &s.id,
                s.lecture_id.as_deref(),
                &req.username,
                &s.title,
                s.summary.as_deref(),
                &s.created_at,
                &s.updated_at,
                s.is_deleted.unwrap_or(false),
            ) {
                tracing::error!("Failed to upsert chat session {}: {}", s.id, e);
            }
        }
    }

    // 8. Upsert Chat Messages (full replacement per session)
    if let Some(messages) = req.chat_messages {
        // Group by session_id for deletion
        let mut sessions_seen = std::collections::HashSet::new();
        for msg in &messages {
            if sessions_seen.insert(msg.session_id.clone()) {
                let _ = db.delete_chat_messages_by_session(&msg.session_id);
            }
        }
        // Insert all
        let msgs: Vec<_> = messages.iter().map(|m| (
            m.id.clone(),
            m.session_id.clone(),
            m.role.clone(),
            m.content.clone(),
            m.sources.clone(),
            m.timestamp.clone(),
        )).collect();
        if let Err(e) = db.insert_chat_messages(&msgs) {
            tracing::error!("Failed to insert chat messages: {}", e);
        }
    }

    Ok(StatusCode::OK)
}

pub async fn pull_data(
    State(state): State<AppState>,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, StatusCode> {
    let db = state.db.lock().await;

    // Courses
    let courses = match db.get_courses(&query.username) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to get courses: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    
    // Lectures
    let mut lectures = Vec::new();
    for course in &courses {
        match db.get_lectures(&course.id) {
            Ok(l) => lectures.extend(l),
            Err(e) => {
                tracing::error!("Failed to get lectures for course {}: {}", course.id, e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
    
    // Notes
    let mut notes = Vec::new();
    for lecture in &lectures {
        if let Ok(Some((lecture_id, title, content, generated_at, is_deleted))) = db.get_note(&lecture.id) {
            notes.push(NoteResponse {
                lecture_id,
                title,
                content,
                generated_at,
                is_deleted: Some(is_deleted),
            });
        }
    }
    
    // Subtitles
    let lecture_ids: Vec<String> = lectures.iter().map(|l| l.id.clone()).collect();
    let subtitles_raw = db.get_subtitles_by_lectures(&lecture_ids).unwrap_or_default();
    let subtitles: Vec<SubtitleSync> = subtitles_raw.into_iter().map(|(id, lecture_id, timestamp, text_en, text_zh, sub_type, confidence, created_at)| {
        SubtitleSync { id, lecture_id, timestamp, text_en, text_zh, sub_type, confidence, created_at }
    }).collect();
    
    // Settings
    let settings_raw = db.get_settings(&query.username).unwrap_or_default();
    let settings: Vec<SettingSync> = settings_raw.into_iter().map(|(key, value, updated_at)| {
        SettingSync { key, value, updated_at }
    }).collect();
    
    // Chat Sessions
    let sessions_raw = db.get_chat_sessions(&query.username).unwrap_or_default();
    let session_ids: Vec<String> = sessions_raw.iter().map(|(id, _, _, _, _, _, _, _)| id.clone()).collect();
    let chat_sessions: Vec<ChatSessionSync> = sessions_raw.into_iter().map(|(id, lecture_id, _username, title, summary, created_at, updated_at, is_deleted)| {
        ChatSessionSync { id, lecture_id, title, summary, created_at, updated_at, is_deleted: Some(is_deleted) }
    }).collect();
    
    // Chat Messages
    let messages_raw = db.get_chat_messages_by_sessions(&session_ids).unwrap_or_default();
    let chat_messages: Vec<ChatMessageSync> = messages_raw.into_iter().map(|(id, session_id, role, content, sources, timestamp)| {
        ChatMessageSync { id, session_id, role, content, sources, timestamp }
    }).collect();
    
    Ok(Json(PullResponse { courses, lectures, notes, subtitles, settings, chat_sessions, chat_messages }))
}
