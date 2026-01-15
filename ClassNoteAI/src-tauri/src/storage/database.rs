use crate::storage::models::{Course, Lecture, Note, Setting, Subtitle};
use chrono::Utc;
use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;

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
        // 開啟外鍵約束（SQLite 默認關閉）
        self.conn.execute("PRAGMA foreign_keys = ON", [])?;

        // 檢查並修復 subtitles 表的 FK 約束（遷移：lectures_old -> lectures）
        if let Ok(sql) = self.conn.query_row::<String, _, _>(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='subtitles'",
            [],
            |row| row.get(0),
        ) {
            if sql.contains("lectures_old") {
                println!("[Database] 修復 subtitles 表 FK 約束...");

                // 備份 -> 刪除 -> 重建 -> 恢復
                self.conn.execute(
                    "CREATE TABLE IF NOT EXISTS subtitles_backup AS SELECT * FROM subtitles",
                    [],
                )?;
                self.conn.execute("DROP TABLE subtitles", [])?;
                self.conn.execute(
                    "CREATE TABLE subtitles (
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
                self.conn.execute(
                    "INSERT INTO subtitles SELECT * FROM subtitles_backup WHERE lecture_id IN (SELECT id FROM lectures)",
                    [],
                )?;
                self.conn.execute("DROP TABLE subtitles_backup", [])?;
                println!("[Database] FK 修復完成");
            }
        }

        // 清理孤立的 subtitles 記錄（FK 違規）
        if let Ok(count) = self.conn.execute(
            "DELETE FROM subtitles WHERE lecture_id NOT IN (SELECT id FROM lectures)",
            [],
        ) {
            if count > 0 {
                println!("[Database] 已清理 {} 條孤立字幕記錄", count);
            }
        }

        // ===== FIX: 檢查並修復 notes 表的 FK 約束（遷移：lectures_old -> lectures）=====
        if let Ok(sql) = self.conn.query_row::<String, _, _>(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='notes'",
            [],
            |row| row.get(0),
        ) {
            if sql.contains("lectures_old") {
                println!("[Database] 修復 notes 表 FK 約束 (lectures_old -> lectures)...");

                // 備份 -> 刪除 -> 重建 -> 恢復
                self.conn.execute(
                    "CREATE TABLE IF NOT EXISTS notes_backup AS SELECT * FROM notes",
                    [],
                )?;
                self.conn.execute("DROP TABLE notes", [])?;
                self.conn.execute(
                    "CREATE TABLE notes (
                        lecture_id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        generated_at TEXT NOT NULL,
                        FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
                    )",
                    [],
                )?;
                // 只恢復有效的筆記（lecture_id 存在於 lectures 表中）
                self.conn.execute(
                    "INSERT INTO notes SELECT * FROM notes_backup WHERE lecture_id IN (SELECT id FROM lectures)",
                    [],
                )?;
                self.conn.execute("DROP TABLE notes_backup", [])?;
                println!("[Database] notes 表 FK 修復完成");
            }
        }
        // ==========================================================================

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
        let has_keywords = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "keywords");
        drop(stmt);

        if !has_keywords {
            println!("Migrating courses table: adding keywords column");
            self.conn
                .execute("ALTER TABLE courses ADD COLUMN keywords TEXT", [])?;
        }

        // 1.2 檢查 courses 表是否有 syllabus_info 列 (遷移)
        let mut stmt = self.conn.prepare("PRAGMA table_info(courses)")?;
        let has_syllabus_info = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "syllabus_info");
        drop(stmt);

        if !has_syllabus_info {
            println!("Migrating courses table: adding syllabus_info column");
            self.conn
                .execute("ALTER TABLE courses ADD COLUMN syllabus_info TEXT", [])?;
        }

        // 1.3 檢查 courses 表是否有 user_id 列 (Auth Migration)
        let mut stmt = self.conn.prepare("PRAGMA table_info(courses)")?;
        let has_user_id = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "user_id");
        drop(stmt);

        if !has_user_id {
            println!("Migrating courses table: adding user_id column");
            // Default to 'default_user' for existing data
            self.conn
                .execute("ALTER TABLE courses ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user'", [])?;
        }

        // 1.5 檢查 courses 表是否有 is_deleted 列 (Soft Delete Migration)
        let mut stmt = self.conn.prepare("PRAGMA table_info(courses)")?;
        let has_is_deleted = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "is_deleted");
        drop(stmt);

        if !has_is_deleted {
            println!("Migrating courses table: adding is_deleted column");
            self.conn
                .execute("ALTER TABLE courses ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0", [])?;
            // Index for performance on sync/filtering
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_courses_is_deleted ON courses(is_deleted)", [])?;
        }

        // 1.4 創建 local_users 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS local_users (
                username TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                sync_status TEXT DEFAULT 'pending'
            )",
            [],
        )?;
        
        // 確保預設使用者存在
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR IGNORE INTO local_users (username, created_at, sync_status) VALUES ('default_user', ?1, 'synced')",
            rusqlite::params![now],
        )?;

        // 2. 檢查 lectures 表是否需要遷移
        let mut stmt = self.conn.prepare("PRAGMA table_info(lectures)")?;
        let has_course_id = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "course_id");
        drop(stmt); // 釋放語句

        if !has_course_id {
            println!("Migrating lectures table...");
            // 遷移邏輯
            // A. 重命名舊表
            self.conn
                .execute("ALTER TABLE lectures RENAME TO lectures_old", [])?;

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
                    row.get::<_, String>(0)?,         // id
                    row.get::<_, String>(1)?,         // title
                    row.get::<_, String>(2)?,         // date
                    row.get::<_, i64>(3)?,            // duration
                    row.get::<_, Option<String>>(4)?, // pdf_path
                    row.get::<_, String>(5)?,         // status
                    row.get::<_, String>(6)?,         // created_at
                    row.get::<_, String>(7)?,         // updated_at
                ))
            })?;

            for lecture in lectures_iter {
                let (id, title, date, duration, pdf_path, status, created_at, updated_at) =
                    lecture?;

                // 為每個舊課程創建一個新的科目
                let course = Course::new("default_user".to_string(), title.clone(), None, None, None);
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
                    audio_path TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
                )",
                [],
            )?;
        }

        // 2.1 檢查 lectures 表是否有 audio_path 列 (Schema Update)
        // 此處應該獨立於上面的 if/else，因為即使是全新安裝也需要檢查（或者上面的 CREATE TABLE 已經包含）
        // 但為了安全起見，這裡可以再次檢查，或者只對 migration path 檢查。
        // 上面的 CREATE TABLE 已經包含了 audio_path，所以只有舊數據結構才需要 ADD COLUMN。
        // 修正邏輯：如果走了 else 分支（表不存在），已經創建了帶 audio_path 的表。
        // 如果走了 if 分支（表存在且需要遷移），遷移代碼沒加 audio_path？
        // 原代碼遷移邏輯中 create table 沒有 audio_path 嗎？
        // 讓我檢查遷移邏輯... 遷移邏輯中 self.conn.execute 用的是舊結構（在之前的步驟中）。
        // 所以無論如何，檢查並添加列是安全的。
        
        let mut stmt = self.conn.prepare("PRAGMA table_info(lectures)")?;
        let has_audio_path = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "audio_path");
        drop(stmt);

        if !has_audio_path {
            println!("Migrating lectures table: adding audio_path column");
            self.conn
                .execute("ALTER TABLE lectures ADD COLUMN audio_path TEXT", [])?;
        }

        // 2.2 檢查 lectures 表是否有 is_deleted 列 (Soft Delete Migration)
        let mut stmt = self.conn.prepare("PRAGMA table_info(lectures)")?;
        let has_is_deleted = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "is_deleted");
        drop(stmt);

        if !has_is_deleted {
            println!("Migrating lectures table: adding is_deleted column");
            self.conn
                .execute("ALTER TABLE lectures ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0", [])?;
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_lectures_is_deleted ON lectures(is_deleted)", [])?;
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

        // 4.1 檢查 notes 表是否有 is_deleted 列 (Soft Delete Migration)
        // 注意：notes 沒有獨立的 ID（使用 lecture_id 作為 PK），所以通常它的生命週期跟隨 lecture。
        // 但為了方便同步刪除狀態，我們也加上 is_deleted
        let mut stmt = self.conn.prepare("PRAGMA table_info(notes)")?;
        let has_is_deleted = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.unwrap_or_default() == "is_deleted");
        drop(stmt);

        if !has_is_deleted {
            println!("Migrating notes table: adding is_deleted column");
            self.conn
                .execute("ALTER TABLE notes ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0", [])?;
        }

        // 創建 settings 表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // 創建 pending_actions 表 (離線佇列)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS pending_actions (
                id TEXT PRIMARY KEY,
                action_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_actions(status)",
            [],
        )?;

        // === NEW: Chat Sessions 表 ===
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                lecture_id TEXT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE SET NULL
            )",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_chat_sessions_lecture ON chat_sessions(lecture_id)",
            [],
        )?;

        // === NEW: Chat Messages 表 ===
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            )",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)",
            [],
        )?;

        Ok(())
    }

    // --- Course CRUD ---

    /// 保存科目
    pub fn save_course(&self, course: &Course) -> SqlResult<()> {
        let syllabus_str = course.syllabus_info.as_ref().map(|v| v.to_string());
        self.conn.execute(
            "INSERT OR REPLACE INTO courses (id, user_id, title, description, keywords, syllabus_info, created_at, updated_at, is_deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                course.id,
                course.user_id,
                course.title,
                course.description,
                course.keywords,
                syllabus_str,
                course.created_at,
                course.updated_at,
                course.is_deleted // Persist is_deleted
            ],
        )?;
        Ok(())
    }

    /// 獲取科目
    pub fn get_course(&self, id: &str) -> SqlResult<Option<Course>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, title, description, keywords, syllabus_info, created_at, updated_at, is_deleted
             FROM courses WHERE id = ?1",
        )?;

        match stmt.query_row([id], |row| Course::try_from(row)) {
            Ok(course) => Ok(Some(course)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 列出指定使用者的所有科目 (不包含已刪除)
    pub fn list_courses(&self, user_id: &str) -> SqlResult<Vec<Course>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, title, description, keywords, syllabus_info, created_at, updated_at, is_deleted
             FROM courses WHERE user_id = ?1 AND is_deleted = 0 ORDER BY created_at DESC",
        )?;

        let courses = stmt
            .query_map([user_id], |row| Course::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(courses)
    }

    /// 列出指定使用者的所有科目 (包含已刪除，用於同步)
    pub fn list_courses_sync(&self, user_id: &str) -> SqlResult<Vec<Course>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, title, description, keywords, syllabus_info, created_at, updated_at, is_deleted
             FROM courses WHERE user_id = ?1 ORDER BY updated_at DESC",
        )?;

        let courses = stmt
            .query_map([user_id], |row| Course::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(courses)
    }

    /// 刪除科目 (軟刪除)
    pub fn delete_course(&self, id: &str) -> SqlResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE courses SET is_deleted = 1, updated_at = ?2 WHERE id = ?1",
             rusqlite::params![id, now],
        )?;
        Ok(())
    }

    // --- Lecture CRUD ---

    /// 保存課程
    pub fn save_lecture(&self, lecture: &Lecture, user_id: &str) -> SqlResult<()> {
        // 預先檢查 course 是否存在且屬於該用戶
        // 注意：這裡應該也檢查 c.is_deleted = 0 ? 
        // 為了向前兼容同步（同步可能寫入舊數據），暫不嚴格檢查 is_deleted，只檢查物理存在。
        let course_exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?1 AND user_id = ?2)",
                [&lecture.course_id, user_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !course_exists {
            println!(
                "[Database] 保存課程失敗: Course '{}' 不存在或不屬於用戶 '{}'。",
                lecture.course_id, user_id
            );
            // ... (Auto creation logic removed/commented out in previous steps, just return error or log)
             return Err(rusqlite::Error::QueryReturnedNoRows); // Or ignore
        }

        self.conn.execute(
            "INSERT OR REPLACE INTO lectures (id, course_id, title, date, duration, pdf_path, audio_path, status, created_at, updated_at, is_deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                lecture.id,
                lecture.course_id,
                lecture.title,
                lecture.date,
                lecture.duration,
                lecture.pdf_path,
                lecture.audio_path,
                lecture.status,
                lecture.created_at,
                lecture.updated_at,
                lecture.is_deleted // Persist is_deleted
            ],
        )?;
        Ok(())
    }

    /// 獲取課程
    pub fn get_lecture(&self, id: &str) -> SqlResult<Option<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, title, date, duration, pdf_path, audio_path, status, created_at, updated_at, is_deleted
             FROM lectures WHERE id = ?1",
        )?;

        match stmt.query_row([id], |row| Lecture::try_from(row)) {
            Ok(lecture) => Ok(Some(lecture)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 列出指定用戶的所有課程 (不包含已刪除)
    pub fn list_lectures(&self, user_id: &str) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.id, l.course_id, l.title, l.date, l.duration, l.pdf_path, l.audio_path, l.status, l.created_at, l.updated_at, l.is_deleted
             FROM lectures l
             JOIN courses c ON l.course_id = c.id
             WHERE c.user_id = ?1 AND l.is_deleted = 0 AND c.is_deleted = 0
             ORDER BY l.created_at DESC",
        )?;

        let lectures = stmt
            .query_map([user_id], |row| Lecture::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lectures)
    }

    /// 列出指定用戶的所有課程 (包含已刪除，用於同步)
    pub fn list_lectures_sync(&self, user_id: &str) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.id, l.course_id, l.title, l.date, l.duration, l.pdf_path, l.audio_path, l.status, l.created_at, l.updated_at, l.is_deleted
             FROM lectures l
             JOIN courses c ON l.course_id = c.id
             WHERE c.user_id = ?1
             ORDER BY l.updated_at DESC",
        )?;

        let lectures = stmt
            .query_map([user_id], |row| Lecture::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lectures)
    }

    /// 列出特定科目的所有課堂 (需驗證科目所屬權)
    pub fn list_lectures_by_course(&self, course_id: &str, user_id: &str) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.id, l.course_id, l.title, l.date, l.duration, l.pdf_path, l.audio_path, l.status, l.created_at, l.updated_at, l.is_deleted
             FROM lectures l
             JOIN courses c ON l.course_id = c.id
             WHERE l.course_id = ?1 AND c.user_id = ?2 AND l.is_deleted = 0
             ORDER BY l.created_at DESC",
        )?;

        let lectures = stmt
            .query_map([course_id, user_id], |row| Lecture::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lectures)
    }

    /// 刪除課程 (軟刪除)
    pub fn delete_lecture(&self, id: &str) -> SqlResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn
            .execute("UPDATE lectures SET is_deleted = 1, updated_at = ?2 WHERE id = ?1", 
            rusqlite::params![id, now])?;
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
        if subtitles.is_empty() {
            return Ok(());
        }

        let lecture_id = &subtitles[0].lecture_id;

        // 驗證 Lecture 存在
        let lecture_exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lectures WHERE id = ?1)",
                [lecture_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !lecture_exists {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        // 驗證 Course 存在（自動修復）
        let course_id: String = self.conn.query_row(
            "SELECT course_id FROM lectures WHERE id = ?1",
            [lecture_id],
            |row| row.get(0),
        )?;

        let course_exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?1)",
                [&course_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !course_exists {
            // 自動創建缺失的 Course
            let now = chrono::Utc::now().to_rfc3339();
            self.conn.execute(
                "INSERT OR IGNORE INTO courses (id, user_id, title, description, keywords, created_at, updated_at)
                 VALUES (?1, 'default_user', ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    course_id,
                    "自動修復的課程",
                    "",
                    "",
                    now,
                    now
                ],
            )?;
        }

        // 保存字幕
        for subtitle in subtitles.iter() {
            self.save_subtitle(subtitle)?;
        }
        Ok(())
    }

    /// 獲取課程的所有字幕
    pub fn get_subtitles(&self, lecture_id: &str) -> SqlResult<Vec<Subtitle>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, lecture_id, timestamp, text_en, text_zh, type, confidence, created_at
             FROM subtitles WHERE lecture_id = ?1 ORDER BY timestamp ASC",
        )?;

        let subtitles = stmt
            .query_map([lecture_id], |row| Subtitle::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(subtitles)
    }

    /// 刪除課程的所有字幕
    pub fn delete_subtitles(&self, lecture_id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM subtitles WHERE lecture_id = ?1", [lecture_id])?;
        Ok(())
    }

    /// 刪除單條字幕 (by ID)
    pub fn delete_subtitle_by_id(&self, id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM subtitles WHERE id = ?1", [id])?;
        Ok(())
    }

    /// 保存筆記
    pub fn save_note(&self, note: &Note) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO notes (lecture_id, title, content, generated_at, is_deleted)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![note.lecture_id, note.title, note.content, note.generated_at, note.is_deleted],
        )?;
        Ok(())
    }

    /// 獲取筆記
    pub fn get_note(&self, lecture_id: &str) -> SqlResult<Option<Note>> {
        let mut stmt = self.conn.prepare(
            "SELECT lecture_id, title, content, generated_at, is_deleted
             FROM notes WHERE lecture_id = ?1",
        )?;

        match stmt.query_row([lecture_id], |row| Note::try_from(row)) {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 刪除筆記
    pub fn delete_note(&self, lecture_id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM notes WHERE lecture_id = ?1", [lecture_id])?;
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
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;

        match stmt.query_row([key], |row| row.get::<_, String>(0)) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 獲取所有設置
    pub fn get_all_settings(&self) -> SqlResult<Vec<Setting>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value, updated_at FROM settings")?;

        let settings = stmt
            .query_map([], |row| Setting::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(settings)
    }

    /// 刪除設置
    pub fn delete_setting(&self, key: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM settings WHERE key = ?1", [key])?;
        Ok(())
    }

    /// 創建本地使用者
    pub fn create_local_user(&self, username: &str) -> SqlResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR IGNORE INTO local_users (username, created_at, sync_status) VALUES (?1, ?2, 'pending')",
            rusqlite::params![username, now],
        )?;
        Ok(())
    }

    /// 檢查本地使用者是否存在
    pub fn check_local_user(&self, username: &str) -> SqlResult<bool> {
        let mut stmt = self.conn.prepare("SELECT 1 FROM local_users WHERE username = ?1")?;
        Ok(stmt.exists([username])?)
    }

    // --- Pending Actions (Offline Queue) ---

    /// 新增待處理動作
    pub fn add_pending_action(&self, id: &str, action_type: &str, payload: &str) -> SqlResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO pending_actions (id, action_type, payload, status, retry_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4)",
            rusqlite::params![id, action_type, payload, now],
        )?;
        Ok(())
    }

    /// 列出所有待處理動作
    pub fn list_pending_actions(&self) -> SqlResult<Vec<(String, String, String, String, i32)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action_type, payload, status, retry_count FROM pending_actions WHERE status = 'pending' OR status = 'failed' ORDER BY created_at ASC"
        )?;
        let actions = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)?,
            ))
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(actions)
    }

    /// 更新待處理動作狀態
    pub fn update_pending_action(&self, id: &str, status: &str, retry_count: i32) -> SqlResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE pending_actions SET status = ?2, retry_count = ?3, updated_at = ?4 WHERE id = ?1",
            rusqlite::params![id, status, retry_count, now],
        )?;
        Ok(())
    }

    /// 移除待處理動作
    pub fn remove_pending_action(&self, id: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM pending_actions WHERE id = ?1", [id])?;
        Ok(())
    }

    // --- Trash Bin Functions ---

    /// 列出已刪除的課程
    pub fn list_deleted_courses(&self, user_id: &str) -> SqlResult<Vec<Course>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, title, description, keywords, syllabus_info, created_at, updated_at, is_deleted
             FROM courses WHERE user_id = ?1 AND is_deleted = 1 ORDER BY updated_at DESC",
        )?;
        let courses = stmt
            .query_map([user_id], |row| Course::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(courses)
    }

    /// 列出已刪除的課堂
    pub fn list_deleted_lectures(&self, user_id: &str) -> SqlResult<Vec<Lecture>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.id, l.course_id, l.title, l.date, l.duration, l.pdf_path, l.audio_path, l.status, l.created_at, l.updated_at, l.is_deleted
             FROM lectures l
             INNER JOIN courses c ON l.course_id = c.id
             WHERE c.user_id = ?1 AND l.is_deleted = 1 ORDER BY l.updated_at DESC",
        )?;
        let lectures = stmt
            .query_map([user_id], |row| Lecture::try_from(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lectures)
    }

    /// 還原已刪除的課程
    pub fn restore_course(&self, id: &str) -> SqlResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE courses SET is_deleted = 0, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, now],
        )?;
        Ok(())
    }

    /// 還原已刪除的課堂
    pub fn restore_lecture(&self, id: &str) -> SqlResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE lectures SET is_deleted = 0, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, now],
        )?;
        Ok(())
    }

    /// 永久刪除課程 (物理刪除)
    pub fn purge_course(&self, id: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM courses WHERE id = ?1", [id])?;
        Ok(())
    }

    /// 永久刪除課堂 (物理刪除)
    pub fn purge_lecture(&self, id: &str) -> SqlResult<()> {
        self.conn.execute("DELETE FROM lectures WHERE id = ?1", [id])?;
        Ok(())
    }

    // ============================================================
    // SUBTITLE SYNC HELPERS
    // ============================================================

    /// 刪除課堂的所有字幕 (用於全量替換)
    pub fn delete_subtitles_by_lecture(&self, lecture_id: &str) -> SqlResult<usize> {
        let deleted = self.conn.execute(
            "DELETE FROM subtitles WHERE lecture_id = ?1",
            [lecture_id]
        )?;
        Ok(deleted)
    }

    // ============================================================
    // CHAT SESSIONS CRUD
    // ============================================================

    /// 保存聊天會話
    pub fn save_chat_session(&self, id: &str, lecture_id: Option<&str>, user_id: &str, title: &str, summary: Option<&str>, created_at: &str, updated_at: &str, is_deleted: bool) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO chat_sessions (id, lecture_id, user_id, title, summary, created_at, updated_at, is_deleted) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![id, lecture_id, user_id, title, summary, created_at, updated_at, is_deleted as i32]
        )?;
        Ok(())
    }

    /// 獲取所有聊天會話
    pub fn get_all_chat_sessions(&self, user_id: &str) -> SqlResult<Vec<(String, Option<String>, String, String, Option<String>, String, String, bool)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, lecture_id, user_id, title, summary, created_at, updated_at, is_deleted 
             FROM chat_sessions WHERE user_id = ?1 ORDER BY updated_at DESC"
        )?;
        let sessions: Vec<_> = stmt.query_map([user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i32>(7)? != 0,
            ))
        })?.filter_map(|r| r.ok()).collect();
        Ok(sessions)
    }

    /// 刪除會話的所有訊息 (用於全量替換)
    pub fn delete_chat_messages_by_session(&self, session_id: &str) -> SqlResult<usize> {
        let deleted = self.conn.execute(
            "DELETE FROM chat_messages WHERE session_id = ?1",
            [session_id]
        )?;
        Ok(deleted)
    }

    /// 保存聊天訊息
    pub fn save_chat_message(&self, id: &str, session_id: &str, role: &str, content: &str, sources: Option<&str>, timestamp: &str) -> SqlResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, sources, timestamp) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, session_id, role, content, sources, timestamp]
        )?;
        Ok(())
    }

    /// 獲取會話的所有訊息
    pub fn get_chat_messages(&self, session_id: &str) -> SqlResult<Vec<(String, String, String, String, Option<String>, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, role, content, sources, timestamp 
             FROM chat_messages WHERE session_id = ?1 ORDER BY timestamp ASC"
        )?;
        let msgs: Vec<_> = stmt.query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?.filter_map(|r| r.ok()).collect();
        Ok(msgs)
    }

    /// 獲取多個會話的所有訊息
    pub fn get_all_chat_messages(&self, user_id: &str) -> SqlResult<Vec<(String, String, String, String, Option<String>, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.session_id, m.role, m.content, m.sources, m.timestamp 
             FROM chat_messages m
             INNER JOIN chat_sessions s ON m.session_id = s.id
             WHERE s.user_id = ?1 ORDER BY m.timestamp ASC"
        )?;
        let msgs: Vec<_> = stmt.query_map([user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?.filter_map(|r| r.ok()).collect();
        Ok(msgs)
    }
}
