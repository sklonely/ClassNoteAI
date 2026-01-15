use rusqlite::{Connection, Result, params};
use crate::TaskResponse;
use chrono::Utc;
use uuid::Uuid;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub username: String,
    pub created_at: String,
    pub last_login: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    pub username: String,
    pub title: String,
    pub description: Option<String>,
    pub syllabus_info: Option<String>,
    pub keywords: Option<String>, // Added
    pub created_at: String,
    pub updated_at: String,
    pub is_deleted: Option<bool>, // Added for Soft Delete
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Lecture {
    pub id: String,
    pub course_id: String,
    pub title: String,
    pub date: String, // Added
    pub duration: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String, // Added
    pub audio_path: Option<String>,
    pub transcript_path: Option<String>,
    pub summary_path: Option<String>,
    pub pdf_path: Option<String>, // Added
    pub keywords: Option<String>, // Added
    pub is_deleted: Option<bool>, // Added for Soft Delete
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub username: String,
    pub name: String,
    pub platform: String,
    pub last_seen: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageEmbedding {
    pub id: i64,
    pub lecture_id: String,
    pub page_number: i32,
    pub content: String,
    pub embedding: Vec<f32>,
    pub created_at: String,
}

pub struct Database {
    conn: Connection,
}

impl Clone for Database {
    fn clone(&self) -> Self {
        // For simplicity, open a new connection with same path
        // In production, use a connection pool
        Database {
            conn: Connection::open("classnote_server.db").expect("Failed to clone db connection"),
        }
    }
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Initialize schema
        conn.execute_batch(r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                priority INTEGER NOT NULL DEFAULT 5,
                result TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT
            );
            
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC);
            CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);

            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                last_login TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                syllabus_info TEXT,
                keywords TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );
            
            -- Attempt to add columns if they don't exist (SQLite doesn't support IF NOT EXISTS for ADD COLUMN properly in batch easily, handling errors loosely or usage of separate block recommended but for now we rely on user starting fresh or manual alter if fails)
            -- Ideally we should use a migration function. For this step, I will modify the CREATE statement.
            -- Existing DBs might need manual upgrade. I'll add a dirty migration block below.
            
            CREATE INDEX IF NOT EXISTS idx_courses_username ON courses(username);

            CREATE TABLE IF NOT EXISTS lectures (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                title TEXT NOT NULL,
                date TEXT NOT NULL DEFAULT '',
                duration INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                audio_path TEXT,
                transcript_path TEXT,
                summary_path TEXT,
                pdf_path TEXT,
                keywords TEXT,
                FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_lectures_course_id ON lectures(course_id);

            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                platform TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_devices_username ON devices(username);

            CREATE TABLE IF NOT EXISTS page_embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lecture_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_embeddings_lecture ON page_embeddings(lecture_id);

            CREATE TABLE IF NOT EXISTS notes (
                lecture_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                FOREIGN KEY(lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
            );
        "#)?;
        


        // Simple Migrations (Ignore errors if columns exist)
        let _ = conn.execute("ALTER TABLE courses ADD COLUMN keywords TEXT", []);
        let _ = conn.execute("ALTER TABLE lectures ADD COLUMN date TEXT DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE lectures ADD COLUMN updated_at TEXT DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE lectures ADD COLUMN pdf_path TEXT", []);
        let _ = conn.execute("ALTER TABLE lectures ADD COLUMN keywords TEXT", []);
        
        // Soft Delete Migrations
        let _ = conn.execute("ALTER TABLE courses ADD COLUMN is_deleted BOOLEAN DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE lectures ADD COLUMN is_deleted BOOLEAN DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN is_deleted BOOLEAN DEFAULT 0", []);
        
        // Purged Items table (for anti-resurrection)
        let _ = conn.execute(r#"
            CREATE TABLE IF NOT EXISTS purged_items (
                id TEXT NOT NULL,
                item_type TEXT NOT NULL,
                username TEXT NOT NULL,
                purged_at TEXT NOT NULL,
                PRIMARY KEY (id, item_type)
            )
        "#, []);
        
        // Index for GC cleanup
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_purged_at ON purged_items(purged_at)", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_courses_is_deleted ON courses(is_deleted)", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_lectures_is_deleted ON lectures(is_deleted)", []);
        
        // === NEW: Subtitles table ===
        let _ = conn.execute(r#"
            CREATE TABLE IF NOT EXISTS subtitles (
                id TEXT PRIMARY KEY,
                lecture_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                text_en TEXT NOT NULL,
                text_zh TEXT,
                type TEXT NOT NULL,
                confidence REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
            )
        "#, []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_subtitles_lecture ON subtitles(lecture_id)", []);
        
        // === NEW: User Settings table ===
        let _ = conn.execute(r#"
            CREATE TABLE IF NOT EXISTS user_settings (
                username TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (username, key),
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            )
        "#, []);
        
        // === NEW: Chat Sessions table ===
        let _ = conn.execute(r#"
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                lecture_id TEXT,
                username TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(lecture_id) REFERENCES lectures(id) ON DELETE SET NULL,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            )
        "#, []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_sessions_username ON chat_sessions(username)", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_sessions_lecture ON chat_sessions(lecture_id)", []);
        
        // === NEW: Chat Messages table ===
        let _ = conn.execute(r#"
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            )
        "#, []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)", []);
        
        Ok(Database { conn })
    }
    
    pub fn create_task(
        &self,
        task_type: &str,
        payload: &serde_json::Value,
        priority: i32,
    ) -> Result<TaskResponse> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let payload_str = serde_json::to_string(payload).unwrap();
        
        self.conn.execute(
            "INSERT INTO tasks (id, task_type, payload, status, priority, created_at) VALUES (?1, ?2, ?3, 'pending', ?4, ?5)",
            params![id, task_type, payload_str, priority, created_at],
        )?;
        
        Ok(TaskResponse {
            id,
            task_type: task_type.to_string(),
            status: "pending".to_string(),
            priority,
            result: None,
            error: None,
            created_at,
            started_at: None,
            completed_at: None,
        })
    }
    
    pub fn get_task(&self, id: &str) -> Result<Option<TaskResponse>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_type, status, priority, result, error, created_at, started_at, completed_at FROM tasks WHERE id = ?1"
        )?;
        
        let mut rows = stmt.query(params![id])?;
        
        if let Some(row) = rows.next()? {
            let result_str: Option<String> = row.get(4)?;
            let result = result_str.and_then(|s| serde_json::from_str(&s).ok());
            
            Ok(Some(TaskResponse {
                id: row.get(0)?,
                task_type: row.get(1)?,
                status: row.get(2)?,
                priority: row.get(3)?,
                result,
                error: row.get(5)?,
                created_at: row.get(6)?,
                started_at: row.get(7)?,
                completed_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }
    
    pub fn get_next_pending_task(&self) -> Result<Option<(String, String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_type, payload FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1"
        )?;
        
        let mut rows = stmt.query([])?;
        
        if let Some(row) = rows.next()? {
            Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?)))
        } else {
            Ok(None)
        }
    }
    
    pub fn mark_task_processing(&self, id: &str) -> Result<()> {
        let started_at = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE tasks SET status = 'processing', started_at = ?1 WHERE id = ?2",
            params![started_at, id],
        )?;
        Ok(())
    }
    
    pub fn mark_task_completed(&self, id: &str, result: &serde_json::Value) -> Result<()> {
        let completed_at = Utc::now().to_rfc3339();
        let result_str = serde_json::to_string(result).unwrap();
        self.conn.execute(
            "UPDATE tasks SET status = 'completed', result = ?1, completed_at = ?2 WHERE id = ?3",
            params![result_str, completed_at, id],
        )?;
        Ok(())
    }
    
    pub fn mark_task_failed(&self, id: &str, error: &str) -> Result<()> {
        let completed_at = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE tasks SET status = 'failed', error = ?1, completed_at = ?2 WHERE id = ?3",
            params![error, completed_at, id],
        )?;
        Ok(())
    }
    
    pub fn get_completed_tasks_since(&self, since: Option<&str>) -> Result<Vec<TaskResponse>> {
        let mut tasks = Vec::new();
        
        if let Some(s) = since {
            let mut stmt = self.conn.prepare(
                "SELECT id, task_type, status, priority, result, error, created_at, started_at, completed_at FROM tasks WHERE status IN ('completed', 'failed') AND completed_at > ?1 ORDER BY completed_at ASC"
            )?;
            
            let mut rows = stmt.query(params![s])?;
            while let Some(row) = rows.next()? {
                let result_str: Option<String> = row.get(4)?;
                let result = result_str.and_then(|s| serde_json::from_str(&s).ok());
                
                tasks.push(TaskResponse {
                    id: row.get(0)?,
                    task_type: row.get(1)?,
                    status: row.get(2)?,
                    priority: row.get(3)?,
                    result,
                    error: row.get(5)?,
                    created_at: row.get(6)?,
                    started_at: row.get(7)?,
                    completed_at: row.get(8)?,
                });
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, task_type, status, priority, result, error, created_at, started_at, completed_at FROM tasks WHERE status IN ('completed', 'failed') ORDER BY completed_at DESC LIMIT 100"
            )?;
            
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let result_str: Option<String> = row.get(4)?;
                let result = result_str.and_then(|s| serde_json::from_str(&s).ok());
                
                tasks.push(TaskResponse {
                    id: row.get(0)?,
                    task_type: row.get(1)?,
                    status: row.get(2)?,
                    priority: row.get(3)?,
                    result,
                    error: row.get(5)?,
                    created_at: row.get(6)?,
                    started_at: row.get(7)?,
                    completed_at: row.get(8)?,
                });
            }
        }
        
        Ok(tasks)
    }

    pub fn get_active_tasks(&self) -> Result<Vec<TaskResponse>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_type, status, priority, result, error, created_at, started_at, completed_at FROM tasks WHERE status IN ('pending', 'processing') ORDER BY priority DESC, created_at ASC"
        )?;

        let mut rows = stmt.query([])?;
        let mut tasks = Vec::new();

        while let Some(row) = rows.next()? {
            let result_str: Option<String> = row.get(4)?;
            let result = result_str.and_then(|s| serde_json::from_str(&s).ok());
            
            tasks.push(TaskResponse {
                id: row.get(0)?,
                task_type: row.get(1)?,
                status: row.get(2)?,
                priority: row.get(3)?,
                result,
                error: row.get(5)?,
                created_at: row.get(6)?,
                started_at: row.get(7)?,
                completed_at: row.get(8)?,
            });
        }
        Ok(tasks)
    }

    pub fn create_user(&self, username: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR IGNORE INTO users (username, created_at, last_login) VALUES (?1, ?2, ?3)",
            params![username, now, now],
        )?;
        Ok(())
    }

    pub fn get_user(&self, username: &str) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare("SELECT username, created_at, last_login FROM users WHERE username = ?1")?;
        let mut rows = stmt.query(params![username])?;
        if let Some(row) = rows.next()? {
            Ok(Some(User {
                username: row.get(0)?,
                created_at: row.get(1)?,
                last_login: row.get(2)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn upsert_course(&self, course: &Course) -> Result<()> {
        self.conn.execute(
            "INSERT INTO courses (id, username, title, description, syllabus_info, keywords, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, syllabus_info=excluded.syllabus_info, keywords=excluded.keywords, updated_at=excluded.updated_at",
            params![course.id, course.username, course.title, course.description, course.syllabus_info, course.keywords, course.created_at, course.updated_at],
        )?;
        Ok(())
    }

    pub fn get_courses(&self, username: &str) -> Result<Vec<Course>> {
        let mut stmt = self.conn.prepare("SELECT id, username, title, description, syllabus_info, keywords, created_at, updated_at, is_deleted FROM courses WHERE username = ?1 ORDER BY updated_at DESC")?;
        let rows = stmt.query_map(params![username], |row| {
            Ok(Course {
                id: row.get(0)?,
                username: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                syllabus_info: row.get(4)?,
                keywords: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                is_deleted: row.get(8)?,
            })
        })?;
        
        let mut courses = Vec::new();
        for course in rows {
            courses.push(course?);
        }
        Ok(courses)
    }

    pub fn update_course_syllabus(&self, id: &str, syllabus_json: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE courses SET syllabus_info = ?1, updated_at = ?2 WHERE id = ?3",
            params![syllabus_json, now, id],
        )?;
        Ok(())
    }

    pub fn update_course_keywords(&self, id: &str, keywords: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE courses SET keywords = ?1, updated_at = ?2 WHERE id = ?3",
            params![keywords, now, id],
        )?;
        Ok(())
    }

    pub fn upsert_lecture(&self, lecture: &Lecture) -> Result<()> {
        self.conn.execute(
            "INSERT INTO lectures (id, course_id, title, date, duration, status, created_at, updated_at, audio_path, transcript_path, summary_path, pdf_path, keywords) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET 
                title=excluded.title, date=excluded.date, duration=excluded.duration, 
                status=excluded.status, updated_at=excluded.updated_at, audio_path=excluded.audio_path, 
                transcript_path=excluded.transcript_path, summary_path=excluded.summary_path,
                pdf_path=excluded.pdf_path, keywords=excluded.keywords",
            params![lecture.id, lecture.course_id, lecture.title, lecture.date, lecture.duration, lecture.status, lecture.created_at, lecture.updated_at, lecture.audio_path, lecture.transcript_path, lecture.summary_path, lecture.pdf_path, lecture.keywords],
        )?;
        Ok(())
    }

    pub fn get_lectures(&self, course_id: &str) -> Result<Vec<Lecture>> {
        let mut stmt = self.conn.prepare("SELECT id, course_id, title, date, duration, status, created_at, updated_at, audio_path, transcript_path, summary_path, pdf_path, keywords, is_deleted FROM lectures WHERE course_id = ?1 ORDER BY created_at DESC")?;
        let rows = stmt.query_map(params![course_id], |row| {
            Ok(Lecture {
                id: row.get(0)?,
                course_id: row.get(1)?,
                title: row.get(2)?,
                date: row.get(3)?,
                duration: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                audio_path: row.get(8)?,
                transcript_path: row.get(9)?,
                summary_path: row.get(10)?,
                pdf_path: row.get(11)?,
                keywords: row.get(12)?,
                is_deleted: row.get(13)?,
            })
        })?;

        let mut lectures = Vec::new();
        for lecture in rows {
            lectures.push(lecture?);
        }
        Ok(lectures)
    }

    pub fn register_device(&self, device: &Device) -> Result<()> {
        self.conn.execute(
            "INSERT INTO devices (id, username, name, platform, last_seen, created_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET 
                name=excluded.name, platform=excluded.platform, last_seen=excluded.last_seen",
            params![device.id, device.username, device.name, device.platform, device.last_seen, device.created_at],
        )?;
        Ok(())
    }

    pub fn get_devices(&self, username: &str) -> Result<Vec<Device>> {
        let mut stmt = self.conn.prepare("SELECT id, username, name, platform, last_seen, created_at FROM devices WHERE username = ?1 ORDER BY last_seen DESC")?;
        let rows = stmt.query_map(params![username], |row| {
            Ok(Device {
                id: row.get(0)?,
                username: row.get(1)?,
                name: row.get(2)?,
                platform: row.get(3)?,
                last_seen: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        let mut devices = Vec::new();
        for device in rows {
            devices.push(device?);
        }
        Ok(devices)
    }

    pub fn delete_device(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM devices WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_device_heartbeat(&self, id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute("UPDATE devices SET last_seen = ?1 WHERE id = ?2", params![now, id])?;
        Ok(())
    }

    pub fn insert_page_embedding(&self, lecture_id: &str, page_number: i32, content: &str, embedding: &[f32]) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let embedding_json = serde_json::to_string(embedding).unwrap();
        
        self.conn.execute(
            "INSERT INTO page_embeddings (lecture_id, page_number, content, embedding, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![lecture_id, page_number, content, embedding_json, now],
        )?;
        Ok(())
    }

    pub fn get_page_embeddings(&self, lecture_id: &str) -> Result<Vec<PageEmbedding>> {
        let mut stmt = self.conn.prepare("SELECT id, lecture_id, page_number, content, embedding, created_at FROM page_embeddings WHERE lecture_id = ?1 ORDER BY page_number ASC")?;
        
        let rows = stmt.query_map(params![lecture_id], |row| {
            let embedding_json: String = row.get(4)?;
            let embedding: Vec<f32> = serde_json::from_str(&embedding_json).unwrap_or_default();
            
            Ok(PageEmbedding {
                id: row.get(0)?,
                lecture_id: row.get(1)?,
                page_number: row.get(2)?,
                content: row.get(3)?,
                embedding,
                created_at: row.get(5)?,
            })
        })?;

        let mut embeddings = Vec::new();
        for row in rows {
            embeddings.push(row?);
        }
        Ok(embeddings)
    }

    pub fn upsert_note(&self, lecture_id: &str, title: &str, content: &str, is_deleted: bool) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO notes (lecture_id, title, content, generated_at, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(lecture_id) DO UPDATE SET title=excluded.title, content=excluded.content, generated_at=excluded.generated_at, is_deleted=excluded.is_deleted",
            params![lecture_id, title, content, now, is_deleted],
        )?;
        Ok(())
    }

    pub fn get_note(&self, lecture_id: &str) -> Result<Option<(String, String, String, String, bool)>> {
        let mut stmt = self.conn.prepare("SELECT lecture_id, title, content, generated_at, is_deleted FROM notes WHERE lecture_id = ?1")?;
        let mut rows = stmt.query(params![lecture_id])?;
        
        if let Some(row) = rows.next()? {
             // is_deleted might be NULL if from old DB without migration fully applied/defaulted, but we set DEFAULT 0
             let is_del: bool = row.get(4).unwrap_or(false);
             Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, is_del)))
        } else {
            Ok(None)
        }
    }

    // ========== Garbage Collection Functions ==========

    /// GC: Delete soft-deleted items older than retention_days and record in purged_items
    pub fn gc_soft_deleted_items(&self, retention_days: i64) -> Result<(usize, usize, usize)> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
        let cutoff_str = cutoff.to_rfc3339();
        let now = Utc::now().to_rfc3339();

        // Get courses to purge
        let mut stmt = self.conn.prepare(
            "SELECT id, username FROM courses WHERE is_deleted = 1 AND updated_at < ?1"
        )?;
        let courses: Vec<(String, String)> = stmt.query_map([&cutoff_str], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.filter_map(|r| r.ok()).collect();

        // Record in purged_items and delete
        for (id, username) in &courses {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO purged_items (id, item_type, username, purged_at) VALUES (?1, 'course', ?2, ?3)",
                params![id, username, now]
            );
            let _ = self.conn.execute("DELETE FROM courses WHERE id = ?1", [id]);
        }

        // Get lectures to purge
        let mut stmt = self.conn.prepare(
            "SELECT l.id, c.username FROM lectures l 
             JOIN courses c ON l.course_id = c.id 
             WHERE l.is_deleted = 1 AND l.updated_at < ?1"
        )?;
        let lectures: Vec<(String, String)> = stmt.query_map([&cutoff_str], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.filter_map(|r| r.ok()).collect();

        for (id, username) in &lectures {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO purged_items (id, item_type, username, purged_at) VALUES (?1, 'lecture', ?2, ?3)",
                params![id, username, now]
            );
            let _ = self.conn.execute("DELETE FROM lectures WHERE id = ?1", [id]);
        }

        // Get notes to purge
        let mut stmt = self.conn.prepare(
            "SELECT n.lecture_id, c.username FROM notes n 
             JOIN lectures l ON n.lecture_id = l.id 
             JOIN courses c ON l.course_id = c.id 
             WHERE n.is_deleted = 1"
        )?;
        let notes: Vec<(String, String)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.filter_map(|r| r.ok()).collect();

        for (id, username) in &notes {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO purged_items (id, item_type, username, purged_at) VALUES (?1, 'note', ?2, ?3)",
                params![id, username, now]
            );
            let _ = self.conn.execute("DELETE FROM notes WHERE lecture_id = ?1", [id]);
        }

        Ok((courses.len(), lectures.len(), notes.len()))
    }

    /// Clean up old purged_items records (older than retention_days)
    pub fn gc_purged_items(&self, retention_days: i64) -> Result<usize> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
        let cutoff_str = cutoff.to_rfc3339();
        
        let deleted = self.conn.execute(
            "DELETE FROM purged_items WHERE purged_at < ?1",
            [&cutoff_str]
        )?;
        
        Ok(deleted)
    }

    /// Check if an item has been purged (for anti-resurrection)
    pub fn is_item_purged(&self, id: &str, item_type: &str) -> Result<bool> {
        let count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM purged_items WHERE id = ?1 AND item_type = ?2",
            params![id, item_type],
            |row| row.get(0)
        )?;
        Ok(count > 0)
    }

    /// Add item to purged list
    pub fn add_purged_item(&self, id: &str, item_type: &str, username: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR REPLACE INTO purged_items (id, item_type, username, purged_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, item_type, username, now]
        )?;
        Ok(())
    }

    // ============================================================
    // SUBTITLE CRUD
    // ============================================================

    /// Delete all subtitles for a lecture (used before full replacement)
    pub fn delete_subtitles_by_lecture(&self, lecture_id: &str) -> Result<usize> {
        let deleted = self.conn.execute(
            "DELETE FROM subtitles WHERE lecture_id = ?1",
            [lecture_id]
        )?;
        Ok(deleted)
    }

    /// Insert multiple subtitles (batch)
    pub fn insert_subtitles(&self, subtitles: &[(String, String, f64, String, Option<String>, String, Option<f64>, String)]) -> Result<()> {
        for (id, lecture_id, timestamp, text_en, text_zh, sub_type, confidence, created_at) in subtitles {
            self.conn.execute(
                "INSERT OR REPLACE INTO subtitles (id, lecture_id, timestamp, text_en, text_zh, type, confidence, created_at) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, lecture_id, timestamp, text_en, text_zh, sub_type, confidence, created_at]
            )?;
        }
        Ok(())
    }

    /// Get all subtitles for multiple lectures
    pub fn get_subtitles_by_lectures(&self, lecture_ids: &[String]) -> Result<Vec<(String, String, f64, String, Option<String>, String, Option<f64>, String)>> {
        let mut result = Vec::new();
        for lecture_id in lecture_ids {
            let mut stmt = self.conn.prepare(
                "SELECT id, lecture_id, timestamp, text_en, text_zh, type, confidence, created_at 
                 FROM subtitles WHERE lecture_id = ?1 ORDER BY timestamp ASC"
            )?;
            let subs: Vec<_> = stmt.query_map([lecture_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })?.filter_map(|r| r.ok()).collect();
            result.extend(subs);
        }
        Ok(result)
    }

    // ============================================================
    // USER SETTINGS CRUD
    // ============================================================

    /// Upsert a user setting
    pub fn upsert_setting(&self, username: &str, key: &str, value: &str, updated_at: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO user_settings (username, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![username, key, value, updated_at]
        )?;
        Ok(())
    }

    /// Get all settings for a user
    pub fn get_settings(&self, username: &str) -> Result<Vec<(String, String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT key, value, updated_at FROM user_settings WHERE username = ?1"
        )?;
        let settings: Vec<_> = stmt.query_map([username], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?.filter_map(|r| r.ok()).collect();
        Ok(settings)
    }

    // ============================================================
    // CHAT SESSIONS CRUD
    // ============================================================

    /// Upsert a chat session
    pub fn upsert_chat_session(&self, id: &str, lecture_id: Option<&str>, username: &str, title: &str, summary: Option<&str>, created_at: &str, updated_at: &str, is_deleted: bool) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO chat_sessions (id, lecture_id, username, title, summary, created_at, updated_at, is_deleted) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, lecture_id, username, title, summary, created_at, updated_at, is_deleted as i32]
        )?;
        Ok(())
    }

    /// Get all chat sessions for a user
    pub fn get_chat_sessions(&self, username: &str) -> Result<Vec<(String, Option<String>, String, String, Option<String>, String, String, bool)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, lecture_id, username, title, summary, created_at, updated_at, is_deleted 
             FROM chat_sessions WHERE username = ?1 ORDER BY updated_at DESC"
        )?;
        let sessions: Vec<_> = stmt.query_map([username], |row| {
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

    /// Delete all messages for a session (before full replacement)
    pub fn delete_chat_messages_by_session(&self, session_id: &str) -> Result<usize> {
        let deleted = self.conn.execute(
            "DELETE FROM chat_messages WHERE session_id = ?1",
            [session_id]
        )?;
        Ok(deleted)
    }

    /// Insert multiple chat messages (batch)
    pub fn insert_chat_messages(&self, messages: &[(String, String, String, String, Option<String>, String)]) -> Result<()> {
        for (id, session_id, role, content, sources, timestamp) in messages {
            self.conn.execute(
                "INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, sources, timestamp) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, session_id, role, content, sources, timestamp]
            )?;
        }
        Ok(())
    }

    /// Get all messages for multiple sessions
    pub fn get_chat_messages_by_sessions(&self, session_ids: &[String]) -> Result<Vec<(String, String, String, String, Option<String>, String)>> {
        let mut result = Vec::new();
        for session_id in session_ids {
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
            result.extend(msgs);
        }
        Ok(result)
    }
}
