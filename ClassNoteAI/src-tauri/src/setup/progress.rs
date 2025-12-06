/**
 * Progress Reporting Module
 *
 * Handles progress tracking and reporting for installations and downloads.
 */
use serde::{Deserialize, Serialize};

/// Progress status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProgressStatus {
    /// Waiting to start
    Pending,
    /// Currently in progress
    InProgress,
    /// Successfully completed
    Completed,
    /// Failed with error
    Failed(String),
    /// Cancelled by user
    Cancelled,
}

/// Progress information for a single task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    /// Unique task identifier
    pub task_id: String,
    /// Human-readable task name
    pub task_name: String,
    /// Current status
    pub status: ProgressStatus,
    /// Current progress value (bytes downloaded, steps completed, etc.)
    pub current: u64,
    /// Total expected value
    pub total: u64,
    /// Download speed in bytes per second (if applicable)
    pub speed_bps: Option<u64>,
    /// Estimated time remaining in seconds
    pub eta_seconds: Option<u64>,
    /// Optional message for additional context
    pub message: Option<String>,
}

impl Progress {
    /// Create a new pending progress
    pub fn pending(task_id: &str, task_name: &str) -> Self {
        Self {
            task_id: task_id.to_string(),
            task_name: task_name.to_string(),
            status: ProgressStatus::Pending,
            current: 0,
            total: 0,
            speed_bps: None,
            eta_seconds: None,
            message: None,
        }
    }

    /// Create a new in-progress progress
    pub fn in_progress(task_id: &str, task_name: &str, current: u64, total: u64) -> Self {
        Self {
            task_id: task_id.to_string(),
            task_name: task_name.to_string(),
            status: ProgressStatus::InProgress,
            current,
            total,
            speed_bps: None,
            eta_seconds: None,
            message: None,
        }
    }

    /// Create a completed progress
    pub fn completed(task_id: &str, task_name: &str) -> Self {
        Self {
            task_id: task_id.to_string(),
            task_name: task_name.to_string(),
            status: ProgressStatus::Completed,
            current: 100,
            total: 100,
            speed_bps: None,
            eta_seconds: None,
            message: None,
        }
    }

    /// Create a failed progress
    pub fn failed(task_id: &str, task_name: &str, error: &str) -> Self {
        Self {
            task_id: task_id.to_string(),
            task_name: task_name.to_string(),
            status: ProgressStatus::Failed(error.to_string()),
            current: 0,
            total: 0,
            speed_bps: None,
            eta_seconds: None,
            message: Some(error.to_string()),
        }
    }

    /// Get progress percentage (0-100)
    #[allow(dead_code)]
    pub fn percentage(&self) -> f32 {
        if self.total == 0 {
            0.0
        } else {
            (self.current as f32 / self.total as f32) * 100.0
        }
    }

    /// Update with speed and ETA calculation
    pub fn with_speed(mut self, speed_bps: u64) -> Self {
        self.speed_bps = Some(speed_bps);
        if speed_bps > 0 && self.total > self.current {
            self.eta_seconds = Some((self.total - self.current) / speed_bps);
        }
        self
    }

    /// Add a message
    pub fn with_message(mut self, message: &str) -> Self {
        self.message = Some(message.to_string());
        self
    }
}

/// Overall installation progress (multiple tasks)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverallProgress {
    /// All tasks and their progress
    pub tasks: Vec<Progress>,
    /// Index of currently active task
    pub current_task_index: usize,
    /// Whether the overall installation is complete
    pub is_complete: bool,
    /// Whether the installation was cancelled
    pub is_cancelled: bool,
    /// Overall error message if failed
    pub error: Option<String>,
}

#[allow(dead_code)]
impl OverallProgress {
    pub fn new(tasks: Vec<Progress>) -> Self {
        Self {
            tasks,
            current_task_index: 0,
            is_complete: false,
            is_cancelled: false,
            error: None,
        }
    }

    /// Get overall percentage
    pub fn overall_percentage(&self) -> f32 {
        if self.tasks.is_empty() {
            return 0.0;
        }

        let total_tasks = self.tasks.len() as f32;
        let completed_tasks = self
            .tasks
            .iter()
            .filter(|t| matches!(t.status, ProgressStatus::Completed))
            .count() as f32;

        let current_task_progress = self
            .tasks
            .get(self.current_task_index)
            .map(|t| t.percentage() / 100.0)
            .unwrap_or(0.0);

        ((completed_tasks + current_task_progress) / total_tasks) * 100.0
    }
}
