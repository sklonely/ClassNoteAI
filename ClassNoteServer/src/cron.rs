use crate::db::Database;
use tokio::time::{interval, Duration};
use tracing::{info, error};

/// Start the GC background task
/// - Runs every 24 hours
/// - Deletes soft-deleted items older than 30 days
/// - Cleans up purged_items records older than 90 days
pub async fn start_gc_task(db_path: String) {
    info!("[GC] Starting garbage collection task...");
    
    let mut interval = interval(Duration::from_secs(24 * 60 * 60)); // 24 hours
    
    // Run immediately on startup, then every 24 hours
    loop {
        interval.tick().await;
        
        info!("[GC] Running garbage collection...");
        
        let path = db_path.clone();
        
        // Run in blocking thread since Database is not Send
        let result = tokio::task::spawn_blocking(move || {
            let db = match Database::new(&path) {
                Ok(d) => d,
                Err(e) => {
                    error!("[GC] Failed to open database: {}", e);
                    return;
                }
            };
            
            // Clean up soft-deleted items older than 30 days
            match db.gc_soft_deleted_items(30) {
                Ok((courses, lectures, notes)) => {
                    if courses > 0 || lectures > 0 || notes > 0 {
                        info!(
                            "[GC] Purged {} courses, {} lectures, {} notes (30-day retention)",
                            courses, lectures, notes
                        );
                    } else {
                        info!("[GC] No items to purge.");
                    }
                }
                Err(e) => {
                    error!("[GC] Failed to run soft-delete GC: {}", e);
                }
            }
            
            // Clean up purged_items records older than 90 days
            match db.gc_purged_items(90) {
                Ok(count) => {
                    if count > 0 {
                        info!("[GC] Cleaned up {} old purged_items records (90-day retention)", count);
                    }
                }
                Err(e) => {
                    error!("[GC] Failed to clean purged_items: {}", e);
                }
            }
        }).await;
        
        if let Err(e) = result {
            error!("[GC] Task panicked: {}", e);
        }
    }
}
