use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;
use crate::storage::models::{Course, Lecture, Subtitle, Note, Setting};
use chrono::Utc;

/// 數據庫管理器
pub struct Database {
    conn: Connection,
}

impl Database {
    /// 初始化數據庫連接
    pub fn new(db_path: &PathBuf) -> SqlResult<Self> {
        let mut conn = Connection::open(db_path)?;
        let db = Database { conn };
        db.init_tables()?;
        Ok(db)
    }

    /// 初始化數據表
    fn init_tables(&self) -> SqlResult<()> {
        // 1. 創建 courses 表
        // 1. 創建 courses 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                keywords TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // 1.1 檢查 courses 表是否有 keywords 列 (遷移)
        let mut stmt = self.conn.prepare("PRAGMA table_info(courses)")?;
        let has_keywords = stmt.query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "keywords");
        drop(stmt);

        if !has_keywords {
            println!("Migrating courses table: adding keywords column");
            self.conn.execute("ALTER TABLE courses ADD COLUMN keywords TEXT", [])?;
        }

        // 1.2 檢查 courses 表是否有 syllabus_info 列 (遷移)
        let mut stmt = self.conn.prepare("PRAGMA table_info(courses)")?;
        let has_syllabus_info = stmt.query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "syllabus_info");
        drop(stmt);

        if !has_syllabus_info {
            println!("Migrating courses table: adding syllabus_info column");
            self.conn.execute("ALTER TABLE courses ADD COLUMN syllabus_info TEXT", [])?;
        }

        // 2. 檢查 lectures 表是否需要遷移
        let mut stmt = self.conn.prepare("PRAGMA table_info(lectures)")?;
        let has_course_id = stmt.query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "course_id");
        drop(stmt); // 釋放語句

        if !has_course_id {
            println!("Migrating lectures table...");
            // 遷移邏輯
            // A. 重命名舊表
            self.conn.execute("ALTER TABLE lectures RENAME TO lectures_old", [])?;

            // B. 創建新表
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS lectures (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    date TEXT NOT NULL,
                    duration INTEGER NOT NULL,
                    pdf_path TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
                )",
                [],
            )?;

            // C. 遷移數據
            let mut stmt = self.conn.prepare("SELECT id, title, date, duration, pdf_path, status, created_at, updated_at FROM lectures_old")?;
            let lectures_iter = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?, // id
                    row.get::<_, String>(1)?, // title
                    row.get::<_, String>(2)?, // date
                    row.get::<_, i64>(3)?,    // duration
                    row.get::<_, Option<String>>(4)?, // pdf_path
                    row.get::<_, String>(5)?, // status
                    row.get::<_, String>(6)?, // created_at
                    row.get::<_, String>(7)?, // updated_at
                ))
            })?;

            for lecture in lectures_iter {
                let (id, title, date, duration, pdf_path, status, created_at, updated_at) = lecture?;
                
                // 為每個舊課程創建一個新的科目
                let course = Course::new(title.clone(), None, None, None);
                self.save_course(&course)?;

                // 插入新課程記錄
                self.conn.execute(
                    "INSERT INTO lectures (id, course_id, title, date, duration, pdf_path, status, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![
                        id,
                        course.id,
                        title,
                        date,
                        duration,
                        pdf_path,
                        status,
                        created_at,
                        updated_at
                    ],
                )?;
            }

            // D. 刪除舊表 (可選，這裡保留以防萬一，或者刪除)
            // self.conn.execute("DROP TABLE lectures_old", [])?;
            println!("Migration completed.");
        } else {
            // 確保表存在 (如果已遷移過或全新安裝)
             self.conn.execute(
                "CREATE TABLE IF NOT EXISTS lectures (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    date TEXT NOT NULL,
                    duration INTEGER NOT NULL,
                    pdf_path TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
                )",
                [],
            )?;
        }

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

    // --- Course CRUD ---

    /// 保存科目
    pub fn save_course(&self, course: &Course) -> SqlResult<()> {
        let syllabus_str = course.syllabus_info.as_ref().map(|v| v.to_string());
        self.conn.execute(
            "INSERT OR REPLACE INTO courses (id, title, description, keywords, syllabus_info, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                course.id,
                course.title,
                course.description,
                course.keywords,
                syllabus_str,
                course.created_at,
                course.updated_at
            ],
        )?;
        Ok(())
    }

    /// 獲取科目
    pub fn get_course(&self, id: &str) -> SqlResult<Option<Course>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, description, keywords, syllabus_info, created_at, updated_at
             FROM courses WHERE id = ?1"
        )?;
        
        match stmt.query_row([id], |row| Course::try_from(row)) {
            Ok(course) => Ok(Some(course)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 列出所有科目
    pub fn list_courses(&self) -> SqlResult<Vec<Course>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, description, keywords, syllabus_info, created_at, updated_at
             FROM courses ORDER BY created_at DESC"
        )?;
        
        let courses = stmt.query_map([], |row| Course::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(courses)
    }

    /// 刪除科目 (會級聯刪除所有課堂)
    pub fn delete_course(&self, id: &str) -> SqlResult<()> {
        // 由於設置了 ON DELETE CASCADE，刪除科目會自動刪除關聯的課堂
        // 但 SQLite 默認不開啟外鍵約束，需要啟用
        self.conn.execute("PRAGMA foreign_keys = ON", [])?;
        self.conn.execute("DELETE FROM courses WHERE id = ?1", [id])?;
        Ok(())
    }

    // --- Lecture CRUD ---

    /// 保存課程
    pub fn save_lecture(&self, lecture: &Lecture) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO lectures (id, course_id, title, date, duration, pdf_path, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                lecture.id,
                lecture.course_id,
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
            "SELECT id, course_id, title, date, duration, pdf_path, status, created_at, updated_at
             FROM lectures WHERE id = ?1"
        )?;
        
        match stmt.query_row([id], |row| Lecture::try_from(row)) {
            Ok(lecture) => Ok(Some(lecture)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 列出所有課程 (全局)
    pub fn list_lectures(&self) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, title, date, duration, pdf_path, status, created_at, updated_at
             FROM lectures ORDER BY created_at DESC"
        )?;
        
        let lectures = stmt.query_map([], |row| Lecture::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lectures)
    }

    /// 列出特定科目的所有課堂
    pub fn list_lectures_by_course(&self, course_id: &str) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, title, date, duration, pdf_path, status, created_at, updated_at
             FROM lectures WHERE course_id = ?1 ORDER BY created_at DESC"
        )?;
        
        let lectures = stmt.query_map([course_id], |row| Lecture::try_from(row))?
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


