use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot, Mutex};
use uuid::Uuid;

const API_VERSION: u32 = 1;
const DEFAULT_PORT: u16 = 4317;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const EVENT_RING_CAPACITY: usize = 128;
const EVENT_BROADCAST_CAPACITY: usize = 256;
const UI_ACTION_TIMEOUT_MS: u64 = 30_000;

static BRIDGE_STATE: OnceLock<Arc<BridgeState>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachFile {
    pub schema_version: u32,
    pub api_version: u32,
    pub app_version: String,
    pub url: String,
    pub token: String,
    pub pid: u32,
    pub port: u16,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeEvent {
    id: u64,
    event_type: String,
    timestamp: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeTask {
    id: String,
    task_type: String,
    status: String,
    started_at: String,
    updated_at: String,
    message: Option<String>,
    artifacts: Vec<Value>,
}

#[derive(Debug)]
struct BridgeState {
    app: AppHandle,
    attach: AttachFile,
    started_at: String,
    events: Mutex<VecDeque<BridgeEvent>>,
    event_tx: broadcast::Sender<BridgeEvent>,
    next_event_id: Mutex<u64>,
    tasks: Mutex<HashMap<String, BridgeTask>>,
    ui_state: Mutex<Option<Value>>,
    pending_ui_actions: Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

pub fn enabled_from_env() -> bool {
    std::env::var("CNAI_AGENT_BRIDGE")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "on"))
        .unwrap_or(false)
        || std::env::var("CNAI_AGENT_BRIDGE_PORT").is_ok()
}

pub fn maybe_start(app: AppHandle) -> Result<(), String> {
    if !enabled_from_env() {
        return Ok(());
    }

    start(app)
}

pub fn start(app: AppHandle) -> Result<(), String> {
    let requested_port = std::env::var("CNAI_AGENT_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let token = std::env::var("CNAI_AGENT_BRIDGE_TOKEN").unwrap_or_else(|_| generate_token());

    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_server(app, requested_port, token).await {
            eprintln!("[agent_bridge] failed: {error}");
        }
    });

    Ok(())
}

async fn run_server(app: AppHandle, requested_port: u16, token: String) -> Result<(), String> {
    let bind_addr = format!("127.0.0.1:{requested_port}");
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("bind {bind_addr}: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();

    let created_at = now();
    let attach = AttachFile {
        schema_version: 1,
        api_version: API_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        url: format!("http://127.0.0.1:{port}"),
        token,
        pid: std::process::id(),
        port,
        created_at: created_at.clone(),
    };

    write_attach_file(&app, &attach)?;

    let (event_tx, _) = broadcast::channel(EVENT_BROADCAST_CAPACITY);
    let state = Arc::new(BridgeState {
        app,
        attach,
        started_at: created_at,
        events: Mutex::new(VecDeque::with_capacity(EVENT_RING_CAPACITY)),
        event_tx,
        next_event_id: Mutex::new(1),
        tasks: Mutex::new(HashMap::new()),
        ui_state: Mutex::new(None),
        pending_ui_actions: Mutex::new(HashMap::new()),
    });
    let _ = BRIDGE_STATE.set(state.clone());

    push_event(
        &state,
        "bridge.started",
        json!({
            "url": state.attach.url,
            "pid": state.attach.pid,
        }),
    )
    .await;
    println!("[agent_bridge] listening on {}", state.attach.url);

    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("accept: {e}"))?;
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, state).await {
                eprintln!("[agent_bridge] request failed: {error}");
            }
        });
    }
}

async fn push_event(state: &Arc<BridgeState>, event_type: &str, payload: Value) {
    let mut next = state.next_event_id.lock().await;
    let event = BridgeEvent {
        id: *next,
        event_type: event_type.to_string(),
        timestamp: now(),
        payload,
    };
    *next += 1;

    let mut events = state.events.lock().await;
    if events.len() >= EVENT_RING_CAPACITY {
        events.pop_front();
    }
    events.push_back(event.clone());
    let _ = state.event_tx.send(event);
}

async fn start_task(state: &Arc<BridgeState>, task_id: String, task_type: &str, payload: Value) {
    let timestamp = now();
    let task = BridgeTask {
        id: task_id.clone(),
        task_type: task_type.to_string(),
        status: "running".to_string(),
        started_at: timestamp.clone(),
        updated_at: timestamp,
        message: None,
        artifacts: Vec::new(),
    };
    state
        .tasks
        .lock()
        .await
        .insert(task_id.clone(), task.clone());
    push_event(
        state,
        "task.started",
        json!({
            "taskId": task_id,
            "taskType": task_type,
            "task": task,
            "payload": payload,
        }),
    )
    .await;
}

async fn finish_task(
    state: &Arc<BridgeState>,
    task_id: &str,
    status: &str,
    message: Option<String>,
    artifacts: Vec<Value>,
    payload: Value,
) {
    let updated_at = now();
    let mut tasks = state.tasks.lock().await;
    let task = tasks
        .entry(task_id.to_string())
        .or_insert_with(|| BridgeTask {
            id: task_id.to_string(),
            task_type: "unknown".to_string(),
            status: status.to_string(),
            started_at: updated_at.clone(),
            updated_at: updated_at.clone(),
            message: None,
            artifacts: Vec::new(),
        });
    task.status = status.to_string();
    task.updated_at = updated_at;
    task.message = message.clone();
    task.artifacts = artifacts;
    let task_snapshot = task.clone();
    drop(tasks);

    let event_type = match status {
        "completed" => "task.completed",
        "failed" => "task.failed",
        "timeout" => "task.timeout",
        _ => "task.updated",
    };
    push_event(
        state,
        event_type,
        json!({
            "taskId": task_id,
            "taskType": task_snapshot.task_type,
            "task": task_snapshot,
            "payload": payload,
        }),
    )
    .await;
}

#[tauri::command]
pub async fn agent_bridge_update_ui_state(state: Value) -> Result<(), String> {
    let Some(bridge_state) = BRIDGE_STATE.get() else {
        return Ok(());
    };
    let mut slot = bridge_state.ui_state.lock().await;
    *slot = Some(state);
    Ok(())
}

#[tauri::command]
pub async fn agent_bridge_complete_ui_action(
    action_id: String,
    result: Value,
) -> Result<(), String> {
    let Some(bridge_state) = BRIDGE_STATE.get() else {
        return Ok(());
    };
    let sender = bridge_state
        .pending_ui_actions
        .lock()
        .await
        .remove(&action_id);
    if let Some(sender) = sender {
        let _ = sender.send(result);
    }
    Ok(())
}

fn write_attach_file(app: &AppHandle, attach: &AttachFile) -> Result<(), String> {
    let path = attach_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create attach dir: {e}"))?;
    }
    let bytes = serde_json::to_vec_pretty(attach).map_err(|e| format!("serialize attach: {e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("write attach file {}: {e}", path.display()))
}

fn attach_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CNAI_AGENT_ATTACH_FILE") {
        return Ok(PathBuf::from(path));
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?
        .join("agent-bridge.json"))
}

fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn handle_connection(mut stream: TcpStream, state: Arc<BridgeState>) -> Result<(), String> {
    let request = read_request(&mut stream).await?;
    if is_events_follow_request(&request) && is_authorized(&request, &state.attach.token) {
        write_events_stream(&mut stream, state).await?;
        return Ok(());
    }
    let response = route_request(request, state).await;
    stream
        .write_all(&response)
        .await
        .map_err(|e| format!("write response: {e}"))?;
    Ok(())
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut temp = [0_u8; 1024];
    let mut header_end = None;
    loop {
        let read = stream
            .read(&mut temp)
            .await
            .map_err(|e| format!("read request: {e}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read]);
        if let Some(split) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = Some(split + 4);
            break;
        }
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
    }
    let header_end = header_end.ok_or_else(|| "missing header terminator".to_string())?;
    let content_length = parse_content_length(&buffer[..header_end])?;
    while buffer.len() < header_end + content_length {
        let read = stream
            .read(&mut temp)
            .await
            .map_err(|e| format!("read request body: {e}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request too large".to_string());
        }
    }
    parse_http_request(&buffer)
}

async fn route_request(request: HttpRequest, state: Arc<BridgeState>) -> Vec<u8> {
    if request.method == "OPTIONS" {
        return empty_response(204);
    }

    if request.path == "/v1/handshake" {
        return json_response(200, handshake_payload(&state));
    }

    if !is_authorized(&request, &state.attach.token) {
        return json_response(
            401,
            json!({
                "schemaVersion": 1,
                "type": "auth_error",
                "status": "unauthorized",
                "message": "Missing or invalid bearer token.",
            }),
        );
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/v1/status") => json_response(200, status_payload(&state).await),
        ("GET", "/v1/logs") => json_response(200, logs_payload(&state, &request).await),
        ("GET", "/v1/events") => events_response(&state).await,
        ("GET", "/v1/tasks") => json_response(200, tasks_payload(&state).await),
        ("POST", "/v1/diag/bundle") => diag_bundle_response(&state).await,
        ("GET", "/v1/workflows") => json_response(200, workflow_payload()),
        ("POST", "/v1/call/raw") => raw_command_response(&state, &request).await,
        ("POST", "/v1/workflow/diagnostics") => diag_bundle_response(&state).await,
        ("POST", "/v1/workflow/import-media") => unsupported_response("workflow.import-media"),
        ("POST", "/v1/workflow/ocr-index") => unsupported_response("workflow.ocr-index"),
        ("POST", "/v1/workflow/summarize") => unsupported_response("workflow.summarize"),
        ("POST", "/v1/workflow/chat") => unsupported_response("workflow.chat"),
        ("GET", "/v1/ui/snapshot") => json_response(200, ui_snapshot_payload(&state).await),
        ("GET", "/v1/ui/tree") => json_response(200, ui_tree_payload(&state).await),
        ("POST", "/v1/ui/click") => ui_action_response(&state, "click", &request).await,
        ("POST", "/v1/ui/type") => ui_action_response(&state, "type", &request).await,
        ("POST", "/v1/ui/key") => ui_action_response(&state, "key", &request).await,
        ("POST", "/v1/ui/navigate") => ui_action_response(&state, "navigate", &request).await,
        ("POST", "/v1/ui/wait-for") => ui_action_response(&state, "wait-for", &request).await,
        _ => json_response(
            404,
            json!({
                "schemaVersion": 1,
                "type": "not_found",
                "status": "failed",
                "message": format!("No agent bridge route for {} {}", request.method, request.path),
            }),
        ),
    }
}

fn handshake_payload(state: &BridgeState) -> Value {
    json!({
        "schemaVersion": 1,
        "type": "bridge_handshake",
        "status": "ok",
        "apiVersion": API_VERSION,
        "app": {
            "name": "ClassNoteAI",
            "version": state.attach.app_version,
            "pid": state.attach.pid,
        },
        "bridge": {
            "url": state.attach.url,
            "auth": "bearer",
            "startedAt": state.started_at,
        },
        "capabilities": [
            {"id": "app.handshake", "stability": "stable"},
            {"id": "app.status", "stability": "stable"},
            {"id": "logs.tail", "stability": "experimental"},
            {"id": "events.watch", "stability": "experimental"},
            {"id": "events.follow", "stability": "experimental"},
            {"id": "tasks.list", "stability": "experimental"},
            {"id": "diag.bundle", "stability": "experimental"},
            {"id": "workflow.list", "stability": "experimental"},
            {"id": "call.raw", "stability": "planned"},
            {"id": "workflow.import-media", "stability": "planned"},
            {"id": "workflow.diagnostics", "stability": "experimental"},
            {"id": "workflow.ocr-index", "stability": "planned"},
            {"id": "workflow.summarize", "stability": "planned"},
            {"id": "workflow.chat", "stability": "planned"},
            {"id": "ui.snapshot", "stability": "experimental"},
            {"id": "ui.tree", "stability": "experimental"},
            {"id": "ui.click", "stability": "experimental"},
            {"id": "ui.type", "stability": "experimental"},
            {"id": "ui.key", "stability": "experimental"},
            {"id": "ui.navigate", "stability": "experimental"},
            {"id": "ui.wait-for", "stability": "experimental"}
        ],
    })
}

async fn status_payload(state: &Arc<BridgeState>) -> Value {
    let events = state.events.lock().await;
    let tasks = state.tasks.lock().await;
    let window_count = state.app.webview_windows().len();
    let log_dir = state
        .app
        .path()
        .app_log_dir()
        .map(|path| path.to_string_lossy().to_string())
        .ok();
    let app_data_dir = state
        .app
        .path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .ok();

    json!({
        "schemaVersion": 1,
        "type": "app_status",
        "status": "ok",
        "app": {
            "version": state.attach.app_version,
            "pid": state.attach.pid,
            "windowCount": window_count,
        },
        "bridge": {
            "url": state.attach.url,
            "apiVersion": API_VERSION,
            "startedAt": state.started_at,
            "eventCount": events.len(),
            "taskCount": tasks.len(),
            "runningTaskCount": tasks.values().filter(|task| task.status == "running").count(),
        },
        "paths": {
            "appDataDir": app_data_dir,
            "logDir": log_dir,
        }
    })
}

async fn logs_payload(state: &Arc<BridgeState>, request: &HttpRequest) -> Value {
    let lines = request
        .query
        .get("lines")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(200)
        .min(2000);
    let text = read_recent_log_lines(&state.app, lines)
        .unwrap_or_else(|error| format!("[agent_bridge] failed to read app log: {error}"));
    json!({
        "schemaVersion": 1,
        "type": "logs_tail",
        "status": "ok",
        "lines": lines,
        "followSupported": false,
        "text": text,
    })
}

async fn events_response(state: &Arc<BridgeState>) -> Vec<u8> {
    let events = state.events.lock().await;
    let mut body = String::new();
    body.push_str("event: bridge.snapshot\n");
    body.push_str(&format!(
        "data: {}\n\n",
        json!({
            "schemaVersion": 1,
            "type": "event_snapshot",
            "status": "ok",
            "events": events.iter().collect::<Vec<_>>(),
        })
    ));
    raw_response(
        200,
        "OK",
        "text/event-stream; charset=utf-8",
        body.into_bytes(),
    )
}

async fn tasks_payload(state: &Arc<BridgeState>) -> Value {
    let tasks = state.tasks.lock().await;
    json!({
        "schemaVersion": 1,
        "type": "task_list",
        "status": "ok",
        "tasks": tasks.values().collect::<Vec<_>>(),
    })
}

fn is_events_follow_request(request: &HttpRequest) -> bool {
    request.method == "GET"
        && request.path == "/v1/events"
        && request
            .query
            .get("follow")
            .map(|value| matches!(value.as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
}

async fn write_events_stream(
    stream: &mut TcpStream,
    state: Arc<BridgeState>,
) -> Result<(), String> {
    let mut receiver = state.event_tx.subscribe();
    let snapshot = {
        let events = state.events.lock().await;
        json!({
            "schemaVersion": 1,
            "type": "event_snapshot",
            "status": "ok",
            "events": events.iter().collect::<Vec<_>>(),
        })
    };

    let headers = "HTTP/1.1 200 OK\r\n\
         Content-Type: text/event-stream; charset=utf-8\r\n\
         Cache-Control: no-cache\r\n\
         Access-Control-Allow-Origin: http://localhost\r\n\
         Access-Control-Allow-Headers: authorization, content-type\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Connection: close\r\n\r\n";
    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|e| format!("write event stream headers: {e}"))?;
    write_sse_event(stream, "bridge.snapshot", &snapshot).await?;

    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    loop {
        tokio::select! {
            event = receiver.recv() => {
                match event {
                    Ok(event) => {
                        let payload = serde_json::to_value(&event)
                            .map_err(|e| format!("serialize event: {e}"))?;
                        write_sse_event(stream, &event.event_type, &payload).await?;
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        write_sse_event(
                            stream,
                            "bridge.events.lagged",
                            &json!({
                                "schemaVersion": 1,
                                "type": "event_lagged",
                                "status": "warning",
                                "skipped": skipped,
                            }),
                        ).await?;
                    }
                    Err(broadcast::error::RecvError::Closed) => return Ok(()),
                }
            }
            _ = heartbeat.tick() => {
                write_sse_comment(stream, "keepalive").await?;
            }
        }
    }
}

async fn write_sse_event(
    stream: &mut TcpStream,
    event_type: &str,
    payload: &Value,
) -> Result<(), String> {
    let data = serde_json::to_string(payload).map_err(|e| format!("serialize sse data: {e}"))?;
    let text = format!("event: {event_type}\ndata: {data}\n\n");
    stream
        .write_all(text.as_bytes())
        .await
        .map_err(|e| format!("write sse event: {e}"))
}

async fn write_sse_comment(stream: &mut TcpStream, comment: &str) -> Result<(), String> {
    let text = format!(": {comment}\n\n");
    stream
        .write_all(text.as_bytes())
        .await
        .map_err(|e| format!("write sse heartbeat: {e}"))
}

async fn diag_bundle_response(state: &Arc<BridgeState>) -> Vec<u8> {
    let task_id = format!("diag-{}", Uuid::new_v4());
    start_task(
        state,
        task_id.clone(),
        "workflow.diagnostics",
        json!({ "source": "agent_bridge" }),
    )
    .await;
    let log_text = read_recent_log_lines(&state.app, 2000).unwrap_or_default();
    let input = crate::diagnostics::DiagnosticPackageInput {
        lecture_meta_json: "{}".to_string(),
        subtitles_json: "[]".to_string(),
        audio_path: None,
        redacted_log_text: log_text,
        metadata_json: serde_json::to_string_pretty(&json!({
            "source": "agent_bridge",
            "createdAt": now(),
            "bridge": {
                "url": state.attach.url,
                "apiVersion": API_VERSION,
            },
            "app": {
                "version": state.attach.app_version,
                "pid": state.attach.pid,
            }
        }))
        .unwrap_or_else(|_| "{}".to_string()),
    };
    match crate::diagnostics::build_diagnostic_zip(input, false) {
        Ok(path) => {
            let path_text = path.to_string_lossy().to_string();
            let artifact = json!({
                "type": "diagnostic_bundle",
                "path": path_text,
            });
            finish_task(
                state,
                &task_id,
                "completed",
                None,
                vec![artifact.clone()],
                json!({ "path": path_text }),
            )
            .await;
            json_response(
                200,
                json!({
                    "schemaVersion": 1,
                    "type": "diag_bundle",
                    "status": "ok",
                    "taskId": task_id,
                    "path": path_text,
                    "artifacts": [artifact],
                }),
            )
        }
        Err(error) => {
            let error_text = error;
            finish_task(
                state,
                &task_id,
                "failed",
                Some(error_text.clone()),
                Vec::new(),
                json!({ "message": error_text.clone() }),
            )
            .await;
            json_response(
                500,
                json!({
                    "schemaVersion": 1,
                    "type": "diag_bundle",
                    "status": "failed",
                    "taskId": task_id,
                    "message": error_text,
                }),
            )
        }
    }
}

fn workflow_payload() -> Value {
    json!({
        "schemaVersion": 1,
        "type": "workflow_contracts",
        "status": "ok",
        "workflows": [
            {"id": "diagnostics", "stability": "experimental", "requiresBridge": true},
            {"id": "import-media", "stability": "planned", "requiresBridge": true},
            {"id": "ocr-index", "stability": "planned", "requiresBridge": true},
            {"id": "summarize", "stability": "planned", "requiresBridge": true},
            {"id": "chat", "stability": "planned", "requiresBridge": true}
        ]
    })
}

async fn raw_command_response(state: &Arc<BridgeState>, request: &HttpRequest) -> Vec<u8> {
    let value: Value = serde_json::from_slice(&request.body).unwrap_or_else(|_| json!({}));
    let command = value
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let result = match command {
        "get_build_features" => json!({
            "nmt_local": cfg!(feature = "nmt-local"),
            "gpu_cuda": cfg!(feature = "gpu-cuda"),
            "bundle_cuda": cfg!(feature = "bundle-cuda"),
            "gpu_metal": cfg!(feature = "gpu-metal"),
            "gpu_vulkan": cfg!(feature = "gpu-vulkan"),
        }),
        "agent_bridge_status" => status_payload(state).await,
        _ => {
            return json_response(
                404,
                json!({
                    "schemaVersion": 1,
                    "type": "raw_command",
                    "status": "failed",
                    "message": format!("Raw command is not allowlisted: {command}"),
                    "allowlist": ["get_build_features", "agent_bridge_status"],
                }),
            )
        }
    };

    json_response(
        200,
        json!({
            "schemaVersion": 1,
            "type": "raw_command",
            "status": "ok",
            "command": command,
            "result": result,
        }),
    )
}

async fn ui_tree_payload(state: &Arc<BridgeState>) -> Value {
    if let Some(renderer_state) = state.ui_state.lock().await.clone() {
        return json!({
            "schemaVersion": 1,
            "type": "ui_tree",
            "status": "ok",
            "source": "renderer-dom",
            "state": renderer_state,
            "tree": renderer_state.get("tree").cloned().unwrap_or_else(|| json!(null)),
            "elements": renderer_state.get("elements").cloned().unwrap_or_else(|| json!([])),
        });
    }

    let windows = state
        .app
        .webview_windows()
        .into_keys()
        .map(|label| {
            json!({
                "id": label,
                "role": "window",
                "label": label,
            })
        })
        .collect::<Vec<_>>();

    json!({
        "schemaVersion": 1,
        "type": "ui_tree",
        "status": "ok",
        "source": "tauri-window-inventory",
        "note": "Semantic DOM/accessibility tree is not wired yet; this is the stable native window inventory.",
        "tree": {
            "role": "application",
            "label": "ClassNoteAI",
            "children": windows,
        }
    })
}

async fn ui_snapshot_payload(state: &Arc<BridgeState>) -> Value {
    if let Some(renderer_state) = state.ui_state.lock().await.clone() {
        return json!({
            "schemaVersion": 1,
            "type": "ui_snapshot",
            "status": "ok",
            "source": "renderer-dom",
            "note": "Semantic snapshot only; pixel capture is reserved for a later bridge phase.",
            "state": renderer_state,
        });
    }

    json!({
        "schemaVersion": 1,
        "type": "ui_snapshot",
        "status": "ok",
        "source": "tauri-window-inventory",
        "note": "Renderer DOM state has not registered yet; pixel capture is reserved for a later bridge phase.",
        "state": ui_tree_payload(state).await,
    })
}

async fn ui_action_response(
    state: &Arc<BridgeState>,
    kind: &str,
    request: &HttpRequest,
) -> Vec<u8> {
    let mut payload: Value = serde_json::from_slice(&request.body).unwrap_or_else(|_| json!({}));
    let action_id = Uuid::new_v4().to_string();
    let task_id = payload
        .get("taskId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("ui-{action_id}"));
    payload["actionId"] = json!(action_id);
    payload["taskId"] = json!(task_id);
    payload["kind"] = json!(kind);

    start_task(
        state,
        task_id.clone(),
        &format!("ui.{kind}"),
        payload.clone(),
    )
    .await;

    let Some(window) = state.app.get_webview_window("main") else {
        finish_task(
            state,
            &task_id,
            "failed",
            Some("main webview window is not available".to_string()),
            Vec::new(),
            json!({ "kind": kind }),
        )
        .await;
        return json_response(
            500,
            json!({
                "schemaVersion": 1,
                "type": "ui_action",
                "status": "failed",
                "kind": kind,
                "message": "main webview window is not available",
                "taskId": task_id,
            }),
        );
    };

    let (sender, receiver) = oneshot::channel();
    state
        .pending_ui_actions
        .lock()
        .await
        .insert(action_id.clone(), sender);

    push_event(
        state,
        "ui.action.started",
        json!({
            "actionId": action_id,
            "kind": kind,
        }),
    )
    .await;

    if let Err(error) = window.emit("agent-bridge-ui-action", payload.clone()) {
        let _ = state.pending_ui_actions.lock().await.remove(&action_id);
        let message = format!("emit ui action: {error}");
        finish_task(
            state,
            &task_id,
            "failed",
            Some(message.clone()),
            Vec::new(),
            json!({ "kind": kind, "actionId": action_id }),
        )
        .await;
        return json_response(
            500,
            json!({
                "schemaVersion": 1,
                "type": "ui_action",
                "status": "failed",
                "kind": kind,
                "actionId": action_id,
                "taskId": task_id,
                "message": message,
            }),
        );
    }

    match tokio::time::timeout(Duration::from_millis(UI_ACTION_TIMEOUT_MS), receiver).await {
        Ok(Ok(result)) => {
            push_event(
                state,
                "ui.action.completed",
                json!({
                    "actionId": action_id,
                    "kind": kind,
                    "result": result,
                }),
            )
            .await;
            let ok = result
                .get("status")
                .and_then(Value::as_str)
                .map(|status| status == "ok")
                .unwrap_or(false);
            let task_status = if ok { "completed" } else { "failed" };
            let message = result
                .get("message")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            finish_task(
                state,
                &task_id,
                task_status,
                message,
                Vec::new(),
                json!({
                    "kind": kind,
                    "actionId": action_id,
                    "result": result,
                }),
            )
            .await;
            json_response(
                if ok { 200 } else { 500 },
                json!({
                    "schemaVersion": 1,
                    "type": "ui_action",
                    "status": if ok { "ok" } else { "failed" },
                    "kind": kind,
                    "actionId": action_id,
                    "taskId": task_id,
                    "result": result,
                }),
            )
        }
        Ok(Err(_)) => {
            finish_task(
                state,
                &task_id,
                "failed",
                Some("renderer dropped ui action response".to_string()),
                Vec::new(),
                json!({ "kind": kind, "actionId": action_id }),
            )
            .await;
            json_response(
                500,
                json!({
                    "schemaVersion": 1,
                    "type": "ui_action",
                    "status": "failed",
                    "kind": kind,
                    "actionId": action_id,
                    "taskId": task_id,
                    "message": "renderer dropped ui action response",
                }),
            )
        }
        Err(_) => {
            let _ = state.pending_ui_actions.lock().await.remove(&action_id);
            finish_task(
                state,
                &task_id,
                "timeout",
                Some("renderer did not complete ui action before timeout".to_string()),
                Vec::new(),
                json!({ "kind": kind, "actionId": action_id }),
            )
            .await;
            json_response(
                504,
                json!({
                    "schemaVersion": 1,
                    "type": "ui_action",
                    "status": "timeout",
                    "kind": kind,
                    "actionId": action_id,
                    "taskId": task_id,
                    "message": "renderer did not complete ui action before timeout",
                }),
            )
        }
    }
}

fn unsupported_response(capability: &str) -> Vec<u8> {
    json_response(
        501,
        json!({
            "schemaVersion": 1,
            "type": "unsupported",
            "status": "unsupported",
            "capability": capability,
            "message": format!("{capability} is part of the Agent Bridge contract but is not implemented yet."),
        }),
    )
}

fn read_recent_log_lines(app: &AppHandle, lines: usize) -> Result<String, String> {
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("resolve log dir: {e}"))?
        .join("classnoteai.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    let text = fs::read_to_string(&log_path)
        .map_err(|e| format!("read log {}: {e}", log_path.display()))?;
    let all_lines: Vec<_> = text.lines().collect();
    let start = all_lines.len().saturating_sub(lines.min(2000));
    Ok(all_lines[start..].join("\n"))
}

fn is_authorized(request: &HttpRequest, token: &str) -> bool {
    let bearer = request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "));
    bearer == Some(token)
}

fn parse_http_request(bytes: &[u8]) -> Result<HttpRequest, String> {
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "missing header terminator".to_string())?;
    let header_text = std::str::from_utf8(&bytes[..split])
        .map_err(|e| format!("request headers are not utf8: {e}"))?;
    let body = bytes[(split + 4)..].to_vec();
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default();
    if method.is_empty() || target.is_empty() {
        return Err("invalid request line".to_string());
    }

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let (path, query) = parse_target(target);
    Ok(HttpRequest {
        method,
        path,
        query,
        headers,
        body,
    })
}

fn parse_content_length(header_bytes: &[u8]) -> Result<usize, String> {
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|e| format!("request headers are not utf8: {e}"))?;
    for line in header_text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("content-length") {
            return value
                .trim()
                .parse::<usize>()
                .map_err(|e| format!("invalid content-length: {e}"));
        }
    }
    Ok(0)
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let Some((path, query_text)) = target.split_once('?') else {
        return (target.to_string(), HashMap::new());
    };
    let query = query_text
        .split('&')
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            Some((key.to_string(), value.to_string()))
        })
        .collect();
    (path.to_string(), query)
}

fn json_response(status: u16, value: Value) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    raw_response(
        status,
        reason(status),
        "application/json; charset=utf-8",
        body,
    )
}

fn empty_response(status: u16) -> Vec<u8> {
    raw_response(
        status,
        reason(status),
        "text/plain; charset=utf-8",
        Vec::new(),
    )
}

fn raw_response(status: u16, reason: &str, content_type: &str, body: Vec<u8>) -> Vec<u8> {
    let mut response = Vec::new();
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: http://localhost\r\n\
         Access-Control-Allow-Headers: authorization, content-type\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    response.extend_from_slice(headers.as_bytes());
    response.extend_from_slice(&body);
    response
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        401 => "Unauthorized",
        404 => "Not Found",
        504 => "Gateway Timeout",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "OK",
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_request_with_query_and_headers() {
        let request = parse_http_request(
            b"GET /v1/logs?lines=50 HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer abc\r\n\r\n",
        )
        .unwrap();

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/v1/logs");
        assert_eq!(request.query.get("lines").unwrap(), "50");
        assert_eq!(request.headers.get("authorization").unwrap(), "Bearer abc");
    }

    #[test]
    fn parses_post_request_body() {
        let request = parse_http_request(
            b"POST /v1/ui/click HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: 25\r\n\r\n{\"target\":\"nav.settings\"}",
        )
        .unwrap();

        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v1/ui/click");
        assert_eq!(request.body, br#"{"target":"nav.settings"}"#);
        assert_eq!(
            parse_content_length(b"POST /v1/ui/click HTTP/1.1\r\nContent-Length: 25\r\n\r\n")
                .unwrap(),
            25
        );
    }

    #[test]
    fn detects_events_follow_requests() {
        let request = parse_http_request(
            b"GET /v1/events?follow=1 HTTP/1.1\r\nAuthorization: Bearer abc\r\n\r\n",
        )
        .unwrap();

        assert!(is_events_follow_request(&request));

        let snapshot =
            parse_http_request(b"GET /v1/events HTTP/1.1\r\nAuthorization: Bearer abc\r\n\r\n")
                .unwrap();
        assert!(!is_events_follow_request(&snapshot));
    }

    #[test]
    fn validates_bearer_token() {
        let request =
            parse_http_request(b"GET /v1/status HTTP/1.1\r\nAuthorization: Bearer secret\r\n\r\n")
                .unwrap();

        assert!(is_authorized(&request, "secret"));
        assert!(!is_authorized(&request, "other"));
    }

    #[test]
    fn generated_token_is_hex_64() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|ch| ch.is_ascii_hexdigit()));
    }
}
