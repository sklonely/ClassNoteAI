use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;
use crate::storage::models::{Lecture, Subtitle, Note, Setting};
use chrono::Utc;

/// 數據庫管理器
pub struct Database {
    conn: Connection,
}

impl Database {
    /// 初始化數據庫連接
    pub fn new(db_path: &PathBuf) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database { conn };
        db.init_tables()?;
        Ok(db)
    }

    /// 初始化數據表
    fn init_tables(&self) -> SqlResult<()> {
        // 創建 lectures 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS lectures (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                date TEXT NOT NULL,
                duration INTEGER NOT NULL,
                pdf_path TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // 創建 subtitles 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS subtitles (
                id TEXT PRIMARY KEY,
                lecture_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                text_en TEXT NOT NULL,
                text_zh TEXT,
                type TEXT NOT NULL,
                confidence REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 創建索引以提升查詢性能
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_subtitles_lecture_id ON subtitles(lecture_id)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_subtitles_timestamp ON subtitles(lecture_id, timestamp)",
            [],
        )?;

        // 創建 notes 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                lecture_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 創建 settings 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        Ok(())
    }

    /// 保存課程
    pub fn save_lecture(&self, lecture: &Lecture) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO lectures (id, title, date, duration, pdf_path, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                lecture.id,
                lecture.title,
                lecture.date,
                lecture.duration,
                lecture.pdf_path,
                lecture.status,
                lecture.created_at,
                lecture.updated_at
            ],
        )?;
        Ok(())
    }

    /// 獲取課程
    pub fn get_lecture(&self, id: &str) -> SqlResult<Option<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, date, duration, pdf_path, status, created_at, updated_at
             FROM lectures WHERE id = ?1"
        )?;
        
        match stmt.query_row([id], |row| Lecture::try_from(row)) {
            Ok(lecture) => Ok(Some(lecture)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 列出所有課程
    pub fn list_lectures(&self) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, date, duration, pdf_path, status, created_at, updated_at
             FROM lectures ORDER BY created_at DESC"
        )?;
        
        let lectures = stmt.query_map([], |row| Lecture::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lectures)
    }

    /// 刪除課程
    pub fn delete_lecture(&self, id: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM lectures WHERE id = ?1", [id])?;
        Ok(())
    }

    /// 更新課程狀態
    pub fn update_lecture_status(&self, id: &str, status: &str) -> SqlResult<()> {
        let updated_at = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE lectures SET status = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![status, updated_at, id],
        )?;
        Ok(())
    }

    /// 更新課程時長
    pub fn update_lecture_duration(&self, id: &str, duration: i64) -> SqlResult<()> {
        let updated_at = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE lectures SET duration = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![duration, updated_at, id],
        )?;
        Ok(())
    }

    /// 保存字幕
    pub fn save_subtitle(&self, subtitle: &Subtitle) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO subtitles (id, lecture_id, timestamp, text_en, text_zh, type, confidence, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                subtitle.id,
                subtitle.lecture_id,
                subtitle.timestamp,
                subtitle.text_en,
                subtitle.text_zh,
                subtitle.subtitle_type,
                subtitle.confidence,
                subtitle.created_at
            ],
        )?;
        Ok(())
    }

    /// 批量保存字幕
    pub fn save_subtitles(&self, subtitles: &[Subtitle]) -> SqlResult<()> {
        // 循環調用單個保存方法
        // 注意：雖然性能不如事務，但更簡單且不需要可變引用
        for subtitle in subtitles {
            self.save_subtitle(subtitle)?;
        }
        Ok(())
    }

    /// 獲取課程的所有字幕
    pub fn get_subtitles(&self, lecture_id: &str) -> SqlResult<Vec<Subtitle>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, lecture_id, timestamp, text_en, text_zh, type, confidence, created_at
             FROM subtitles WHERE lecture_id = ?1 ORDER BY timestamp ASC"
        )?;
        
        let subtitles = stmt.query_map([lecture_id], |row| Subtitle::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(subtitles)
    }

    /// 刪除課程的所有字幕
    pub fn delete_subtitles(&self, lecture_id: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM subtitles WHERE lecture_id = ?1", [lecture_id])?;
        Ok(())
    }

    /// 保存筆記
    pub fn save_note(&self, note: &Note) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO notes (lecture_id, title, content, generated_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                note.lecture_id,
                note.title,
                note.content,
                note.generated_at
            ],
        )?;
        Ok(())
    }

    /// 獲取筆記
    pub fn get_note(&self, lecture_id: &str) -> SqlResult<Option<Note>> {
        let mut stmt = self.conn.prepare(
            "SELECT lecture_id, title, content, generated_at
             FROM notes WHERE lecture_id = ?1"
        )?;
        
        match stmt.query_row([lecture_id], |row| Note::try_from(row)) {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 刪除筆記
    pub fn delete_note(&self, lecture_id: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM notes WHERE lecture_id = ?1", [lecture_id])?;
        Ok(())
    }

    /// 保存設置
    pub fn save_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        let updated_at = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![key, value, updated_at],
        )?;
        Ok(())
    }

    /// 獲取設置
    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        
        match stmt.query_row([key], |row| row.get::<_, String>(0)) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 獲取所有設置
    pub fn get_all_settings(&self) -> SqlResult<Vec<Setting>> {
        let mut stmt = self.conn.prepare(
            "SELECT key, value, updated_at FROM settings"
        )?;
        
        let settings = stmt.query_map([], |row| Setting::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(settings)
    }

    /// 刪除設置
    pub fn delete_setting(&self, key: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
        Ok(())
    }
}

