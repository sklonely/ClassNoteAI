//! Minimal localhost HTTP listener used as an OAuth redirect target.
//!
//! Frontend first calls `oauth_bind_port`, then opens the browser to the
//! provider's auth URL with `redirect_uri=http://localhost:<port>/auth/callback`,
//! then calls `oauth_wait_for_code`. The listener is stored in Tauri app state
//! between those two commands so the redirect URI always matches the port that
//! Rust actually bound.
//!
//! Intentionally NOT a general HTTP server: reads one request, writes one
//! response, closes the socket. Listener also has a timeout so a
//! cancelled auth flow doesn't leak a port-bound task.

use std::borrow::Cow;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

/// Cooperative cancel flag for the OAuth listener. Set to `true` via the
/// `oauth_cancel` command when the user aborts sign-in.
/// Reset on each new `oauth_bind_port` invocation.
static OAUTH_CANCEL: AtomicBool = AtomicBool::new(false);

pub struct OAuthListenerState {
    listener: Mutex<Option<TcpListener>>,
}

impl Default for OAuthListenerState {
    fn default() -> Self {
        Self {
            listener: Mutex::new(None),
        }
    }
}

const HTML_SUCCESS: &str = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>ClassNoteAI</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem;color:#333}h1{font-weight:500}p{color:#666}</style></head><body><h1>\u{2705} Authentication complete</h1><p>You can close this tab and return to ClassNoteAI.</p></body></html>";

#[derive(Debug, Clone, serde::Serialize)]
pub struct OAuthCallback {
    pub code: String,
    pub state: String,
}

#[tauri::command]
pub fn oauth_bind_port(
    state: State<'_, OAuthListenerState>,
    preferred_port: u16,
    max_attempts: u16,
) -> Result<u16, String> {
    OAUTH_CANCEL.store(false, Ordering::SeqCst);

    let attempts = max_attempts.max(1);
    let mut guard = state
        .listener
        .lock()
        .map_err(|_| "OAuth listener state poisoned.".to_string())?;
    guard.take();

    let (listener, bound_port) = try_bind(preferred_port, attempts)?;
    *guard = Some(listener);
    Ok(bound_port)
}

#[tauri::command]
pub async fn oauth_wait_for_code(
    state: State<'_, OAuthListenerState>,
    timeout_secs: u64,
) -> Result<OAuthCallback, String> {
    let listener = {
        let mut guard = state
            .listener
            .lock()
            .map_err(|_| "OAuth listener state poisoned.".to_string())?;
        guard
            .take()
            .ok_or_else(|| "OAuth listener not bound. Start sign-in again.".to_string())?
    };

    tokio::task::spawn_blocking(move || wait_for_code(listener, timeout_secs))
        .await
        .map_err(|e| format!("spawn_blocking join failed: {}", e))?
}

/// Ask the currently-running OAuth listener to bail out. Safe to call
/// even if no listener is active.
#[tauri::command]
pub fn oauth_cancel(state: State<'_, OAuthListenerState>) {
    OAUTH_CANCEL.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = state.listener.lock() {
        guard.take();
    }
}

fn try_bind(preferred_port: u16, max_attempts: u16) -> Result<(TcpListener, u16), String> {
    for offset in 0..max_attempts {
        let port = preferred_port.saturating_add(offset);
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok((listener, port));
        }
    }

    Err(format!(
        "OAuth port range {}-{} all busy, please close other OAuth sessions and retry",
        preferred_port,
        preferred_port.saturating_add(max_attempts.saturating_sub(1)),
    ))
}

fn wait_for_code(listener: TcpListener, timeout_secs: u64) -> Result<OAuthCallback, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if OAUTH_CANCEL.load(Ordering::SeqCst) {
            return Err("OAuth sign-in cancelled.".to_string());
        }
        if std::time::Instant::now() >= deadline {
            return Err("OAuth callback listener timed out.".to_string());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .map_err(|e| e.to_string())?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .map_err(|e| e.to_string())?;

                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                reader
                    .read_line(&mut request_line)
                    .map_err(|e| format!("read request line: {}", e))?;

                let path = request_line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| "malformed HTTP request line".to_string())?
                    .to_string();

                let mut junk = String::new();
                while reader.read_line(&mut junk).map(|n| n > 2).unwrap_or(false) {
                    junk.clear();
                }

                let mut out = stream;
                let body = HTML_SUCCESS;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = out.write_all(response.as_bytes());
                let _ = out.flush();

                if let Some(error) = extract_query_param(&path, "error")? {
                    return Err(format!("OAuth error: {}", error));
                }

                let code = extract_query_param(&path, "code")?
                    .ok_or_else(|| "OAuth callback missing `code`".to_string())?;
                let state = extract_query_param(&path, "state")?
                    .ok_or_else(|| "OAuth callback missing `state`".to_string())?;

                return Ok(OAuthCallback { code, state });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("accept failed: {}", e)),
        }
    }
}

fn extract_query_param(path: &str, key: &str) -> Result<Option<String>, String> {
    let query = match path.split_once('?') {
        Some((_, query)) => query,
        None => return Ok(None),
    };

    for pair in query.split('&') {
        let (raw_key, raw_value) = match pair.split_once('=') {
            Some(parts) => parts,
            None => (pair, ""),
        };
        if raw_key != key {
            continue;
        }

        let decoded = urlencoding::decode(raw_value)
            .map_err(|e| format!("decode query param `{}`: {}", key, e))?;
        return Ok(Some(normalize_query_value(decoded)));
    }

    Ok(None)
}

fn normalize_query_value(value: Cow<'_, str>) -> String {
    value.replace('+', " ")
}
