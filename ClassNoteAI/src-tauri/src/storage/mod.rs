pub mod database;
pub mod models;

pub use database::Database;
pub use models::{Lecture, Subtitle, Note, Setting};

use std::path::PathBuf;
use tauri::Manager;
use rusqlite::Result as SqlResult;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 數據庫路徑管理器
/// 由於 rusqlite::Connection 不支持 Send + Sync，我們存儲路徑並在需要時創建連接
#[derive(Clone)]
pub struct DatabaseManager {
    db_path: Arc<PathBuf>,
}

impl DatabaseManager {
    /// 初始化數據庫管理器
    pub fn new(app: &tauri::AppHandle) -> SqlResult<Self> {
        let app_data_dir = app.path()
            .app_data_dir()
            .map_err(|e| rusqlite::Error::InvalidPath(PathBuf::from(e.to_string())))?;
        
        // 確保目錄存在
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| rusqlite::Error::InvalidPath(PathBuf::from(e.to_string())))?;
        
        let db_path = app_data_dir.join("classnoteai.db");
        
        // 初始化數據庫表結構
        let db = Database::new(&db_path)?;
        drop(db); // 關閉連接
        
        Ok(Self {
            db_path: Arc::new(db_path),
        })
    }

    /// 獲取數據庫連接
    /// 注意：每次調用都會創建新連接，這對 SQLite 來說是可以接受的
    pub fn get_db(&self) -> SqlResult<Database> {
        Database::new(&self.db_path)
    }
}

/// 全局數據庫管理器實例
static DB_MANAGER: Mutex<Option<DatabaseManager>> = Mutex::const_new(None);

/// 初始化數據庫管理器
pub async fn init_db(app: &tauri::AppHandle) -> SqlResult<()> {
    let manager = DatabaseManager::new(app)?;
    let mut instance = DB_MANAGER.lock().await;
    *instance = Some(manager);
    Ok(())
}

/// 獲取數據庫管理器
pub async fn get_db_manager() -> SqlResult<DatabaseManager> {
    let instance = DB_MANAGER.lock().await;
    instance.as_ref()
        .ok_or_else(|| rusqlite::Error::InvalidPath(PathBuf::from("數據庫未初始化")))
        .cloned()
}

