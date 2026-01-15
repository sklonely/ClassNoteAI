use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct TaskEvent {
    pub task_id: String,
    pub task_type: String,
    pub status: String, // "processing", "completed", "failed"
    pub result: Option<serde_json::Value>,
    pub user_id: Option<String>,
}
