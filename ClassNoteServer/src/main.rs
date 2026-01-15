use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, delete},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod db;
mod worker;
mod ollama;
mod sync;
mod files;
mod devices;
mod auth;
mod events;
mod cron;

use worker::{PageData, IndexingPayload, SummaryPayload, SyllabusPayload};
use events::TaskEvent;

use db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub ollama_url: String,
    pub tx: tokio::sync::broadcast::Sender<TaskEvent>,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting ClassNoteServer...");

    // Start worker in background
    let db_instance = Database::new("classnote_server.db").expect("Failed to initialize database");
    
    // Initialize broadcast channel
    let (tx, _rx) = tokio::sync::broadcast::channel(100);

    let db_clone_for_worker = db_instance.clone();
    let db_for_state = Arc::new(Mutex::new(db_instance));
    
    let ollama_url = std::env::var("OLLAMA_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let ollama_url_clone = ollama_url.clone();

    let state = AppState {
        db: db_for_state,
        ollama_url,
        tx: tx.clone(),
    };
    
    // Pass tx to worker
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        worker::run_worker(db_clone_for_worker, ollama_url_clone, tx_clone).await;
    });

    // Start GC cron task (pass path, not instance since Database is not Send)
    let db_path = "classnote_server.db".to_string();
    tokio::spawn(async move {
        cron::start_gc_task(db_path).await;
    });

    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/tasks", post(create_task))
        .route("/api/tasks/:id", get(get_task))
        .route("/api/tasks/sync", get(sync_tasks))
        .route("/api/tasks/active", get(get_active_tasks_api))
        .route("/api/sync/push", post(sync::push_data))
        .route("/api/sync/pull", get(sync::pull_data))
        .route("/api/files/upload", post(files::upload_file))
        .nest_service("/api/files/download", ServeDir::new("uploads"))
        // Devices API
        .route("/api/devices/register", post(devices::register_device))
        .route("/api/devices", get(devices::get_devices))
        
        // Auth API
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        
        // SSE Events
        .route("/api/events", get(sse_handler))


        // Async Tasks (RAG & Summary)
        .route("/api/lectures/:id/index", post(trigger_indexing))
        .route("/api/lectures/:id/summary", post(trigger_summary))
        .route("/api/courses/:id/syllabus", post(trigger_syllabus))
        .route("/api/lectures/:id/embeddings", get(get_lecture_embeddings))
        .route("/api/embed", post(proxy_embedding))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    tracing::info!("Server listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// SSE Handler
use axum::response::sse::{Event, Sse};
use futures::stream::{Stream, StreamExt};
use std::convert::Infallible;

async fn sse_handler(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    tracing::info!("New SSE connection established");
    let rx = state.tx.subscribe();
    
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx)
        .map(|msg| {
            match msg {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    Ok(Event::default().data(data))
                }
                Err(_lag) => {
                    // If lagged, we might want to send an error or just ignore
                    tracing::warn!("SSE stream lagged");
                    Ok(Event::default().comment("lagged"))
                }
            }
        });

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}

// === Task Types ===

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub task_type: String,  // "embedding" | "extraction" | "graph"
    pub payload: serde_json::Value,
    #[serde(default)]
    pub priority: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskResponse {
    pub id: String,
    pub task_type: String,
    pub status: String,
    pub priority: i32,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncQuery {
    pub since: Option<String>,
}

// === API Handlers ===

async fn create_task(
    State(state): State<AppState>,
    Json(req): Json<CreateTaskRequest>,
) -> Result<Json<TaskResponse>, StatusCode> {
    let db = state.db.lock().await;
    
    let priority = req.priority.unwrap_or(match req.task_type.as_str() {
        "embedding" => 10,  // High priority
        "extraction" => 5,  // Medium
        "graph" => 1,       // Low
        _ => 5,
    });
    
    match db.create_task(&req.task_type, &req.payload, priority) {
        Ok(task) => Ok(Json(task)),
        Err(e) => {
            tracing::error!("Failed to create task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskResponse>, StatusCode> {
    let db = state.db.lock().await;
    
    match db.get_task(&id) {
        Ok(Some(task)) => Ok(Json(task)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to get task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn sync_tasks(
    State(state): State<AppState>,
    Query(query): Query<SyncQuery>,
) -> Result<Json<Vec<TaskResponse>>, StatusCode> {
    let db = state.db.lock().await;
    
    match db.get_completed_tasks_since(query.since.as_deref()) {
        Ok(tasks) => Ok(Json(tasks)),
        Err(e) => {
            tracing::error!("Failed to sync tasks: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_active_tasks_api(
    State(state): State<AppState>,
) -> Result<Json<Vec<TaskResponse>>, StatusCode> {
    let db = state.db.lock().await;
    
    match db.get_active_tasks() {
        Ok(tasks) => Ok(Json(tasks)),
        Err(e) => {
            tracing::error!("Failed to get active tasks: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// === New Handlers ===

#[derive(Deserialize)]
pub struct SummaryRequest {
    pub language: String,
    pub pdf_context: Option<String>,
    pub content: String,
}

async fn trigger_indexing(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(pages): Json<Vec<PageData>>,
) -> Result<Json<TaskResponse>, StatusCode> {
    let db = state.db.lock().await;
    
    // Construct payload
    let payload = IndexingPayload {
        lecture_id: id,
        pages,
    };
    
    let payload_value = serde_json::to_value(payload).map_err(|e| {
        tracing::error!("Failed to serialize payload: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    match db.create_task("indexing", &payload_value, 5) {
        Ok(task) => Ok(Json(task)),
        Err(e) => {
            tracing::error!("Failed to create indexing task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn trigger_summary(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SummaryRequest>,
) -> Result<Json<TaskResponse>, StatusCode> {
    let db = state.db.lock().await;
    
    let payload = SummaryPayload {
        lecture_id: id,
        language: req.language,
        pdf_context: req.pdf_context,
        content: req.content,
    };
    
    let payload_value = serde_json::to_value(payload).map_err(|e| {
        tracing::error!("Failed to serialize payload: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    match db.create_task("summary", &payload_value, 8) { // Higher priority for summary
        Ok(task) => Ok(Json(task)),
        Err(e) => {
            tracing::error!("Failed to create summary task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
pub struct SyllabusRequest {
    pub title: String,
    pub description: Option<String>,
    pub target_language: Option<String>,
}

async fn trigger_syllabus(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SyllabusRequest>,
) -> Result<Json<TaskResponse>, StatusCode> {
    let db = state.db.lock().await;

    let payload = SyllabusPayload {
        course_id: id,
        title: req.title,
        description: req.description,
        target_language: req.target_language,
    };

    let payload_value = serde_json::to_value(payload).map_err(|e| {
        tracing::error!("Failed to serialize payload: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    match db.create_task("syllabus", &payload_value, 7) { // High priority, user waiting likely
        Ok(task) => Ok(Json(task)),
        Err(e) => {
            tracing::error!("Failed to create syllabus task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_lecture_embeddings(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<db::PageEmbedding>>, StatusCode> {
    let db = state.db.lock().await;
    
    match db.get_page_embeddings(&id) {
        Ok(embeddings) => Ok(Json(embeddings)),
        Err(e) => {
             tracing::error!("Failed to get embeddings: {}", e);
             Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
pub struct EmbedRequest {
    pub text: String,
    pub model: Option<String>,
}

async fn proxy_embedding(
    State(state): State<AppState>,
    Json(req): Json<EmbedRequest>,
) -> Result<Json<Vec<f32>>, StatusCode> {
    let client = ollama::OllamaClient::new(&state.ollama_url);
    let model = req.model.as_deref().unwrap_or("nomic-embed-text");
    
    match client.embed(&req.text, model).await {
        Ok(embedding) => Ok(Json(embedding)),
        Err(e) => {
            tracing::error!("Failed to proxy embedding: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
