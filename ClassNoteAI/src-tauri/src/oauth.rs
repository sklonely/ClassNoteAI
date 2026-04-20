//! Minimal localhost HTTP listener used as an OAuth redirect target.
//!
//! Frontend calls `oauth_listen_for_code`, then opens the browser to the
//! provider's auth URL with `redirect_uri=http://localhost:<port>/auth/callback`.
//! This function returns when the browser hits that URL, handing back the
//! full request path so the caller can parse `code` and `state`.
//!
//! Intentionally NOT a general HTTP server: reads one request, writes one
//! response, closes the socket. Listener also has a timeout so a
//! cancelled auth flow doesn't leak a port-bound task.
//!
//! v0.5.1: tries a small range of ports starting from the preferred one
//! so a previous failed sign-in stuck in TIME_WAIT doesn't block a retry.
//! Returns both the callback path and the port that was actually bound so
//! the frontend can build the correct redirect_uri.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::task;

/// Cooperative cancel flag for the OAuth listener. Set to `true` via the
/// `oauth_cancel` command — e.g. when the user closes the browser tab
/// without completing auth and clicks "Cancel" in the sign-in modal.
/// Reset on each new `oauth_listen_for_code` invocation.
static OAUTH_CANCEL: AtomicBool = AtomicBool::new(false);

/// Event name emitted to the frontend as soon as the listener has bound
/// a local port. Payload = the `u16` port that was actually bound (may
/// differ from the preferred port when 1455 is held by another process
/// — e.g. VS Code, reported in issue #36). The frontend must wait for
/// this event before opening the browser so the redirect_uri matches
/// the bound port.
pub const OAUTH_BOUND_EVENT: &str = "oauth:bound";

const HTML_SUCCESS: &str = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>ClassNoteAI</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem;color:#333}h1{font-weight:500}p{color:#666}</style></head><body><h1>\u{2705} Authentication complete</h1><p>You can close this tab and return to ClassNoteAI.</p></body></html>";

/// Result of a successful OAuth callback listen: both the callback
/// request path and the port the listener actually bound to.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OAuthListenResult {
    pub port: u16,
    pub path: String,
}

/// Try to bind to `preferred_port`, and if that fails for "address in
/// use" reasons, walk forward up to `max_attempts` ports. Once bound,
/// wait up to `timeout_secs` for the first request and return it.
///
/// Timeout, bind exhaustion, or other I/O errors return an `Err(String)`
/// so the frontend can show it in the sign-in modal.
#[tauri::command]
pub async fn oauth_listen_for_code(
    app: AppHandle,
    port: u16,
    timeout_secs: u64,
    max_attempts: Option<u16>,
) -> Result<OAuthListenResult, String> {
    // New attempt — clear any pending cancel from a previous aborted flow.
    OAUTH_CANCEL.store(false, Ordering::SeqCst);
    let attempts = max_attempts.unwrap_or(16);
    task::spawn_blocking(move || listen_once(app, port, timeout_secs, attempts))
        .await
        .map_err(|e| format!("spawn_blocking join failed: {}", e))?
}

/// Ask the currently-running OAuth listener to bail out. Safe to call
/// even if no listener is active (it just sets a flag).
#[tauri::command]
pub fn oauth_cancel() {
    OAUTH_CANCEL.store(true, Ordering::SeqCst);
}

fn try_bind(preferred_port: u16, max_attempts: u16) -> Result<(TcpListener, u16), String> {
    let mut last_err: Option<std::io::Error> = None;
    for offset in 0..max_attempts {
        let port = preferred_port.saturating_add(offset);
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(e) => {
                last_err = Some(e);
            }
        }
    }
    let detail = last_err.map(|e| e.to_string()).unwrap_or_default();
    let holder = identify_port_holder(preferred_port)
        .map(|h| format!(" 佔用者: {}", h))
        .unwrap_or_default();
    Err(format!(
        "無法綁定 127.0.0.1:{}（ChatGPT 登入必須用這個 port，OAuth server 已固定註冊）。請關閉佔用它的程式後重試。{}（底層錯誤: {}）",
        preferred_port, holder, detail,
    ))
}

/// Best-effort lookup of which process is holding a local TCP port.
/// Uses `netstat -ano` + `tasklist /FI "PID eq <pid>"` — both are
/// always present on Windows, so no extra deps. Returns `None` if the
/// port doesn't appear to be bound (e.g. TIME_WAIT from a previous run)
/// or if either command fails.
#[cfg(target_os = "windows")]
fn identify_port_holder(port: u16) -> Option<String> {
    use crate::utils::command::no_window;

    let netstat = no_window("netstat").args(["-ano"]).output().ok()?;
    if !netstat.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&netstat.stdout);
    let needle = format!(":{} ", port);
    let pid: &str = text.lines().find_map(|line| {
        if !line.contains(&needle) || !line.contains("LISTENING") {
            return None;
        }
        line.split_whitespace().last()
    })?;

    let tl = no_window("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    if !tl.status.success() {
        return Some(format!("PID {}", pid));
    }
    let out = String::from_utf8_lossy(&tl.stdout);
    let first = out.lines().next()?;
    // CSV fields are quoted. First field is the image name.
    let image = first
        .split(',')
        .next()?
        .trim_matches('"')
        .to_string();
    if image.is_empty() {
        Some(format!("PID {}", pid))
    } else {
        Some(format!("{} (PID {})", image, pid))
    }
}

#[cfg(not(target_os = "windows"))]
fn identify_port_holder(_port: u16) -> Option<String> {
    // lsof-based identification on macOS/Linux could go here. Not wired
    // up yet because the port-held-by-VS-Code case that motivated this
    // is Windows-specific (dev extensions using the same port range).
    None
}

fn listen_once(
    app: AppHandle,
    preferred_port: u16,
    timeout_secs: u64,
    max_attempts: u16,
) -> Result<OAuthListenResult, String> {
    let (listener, bound_port) = try_bind(preferred_port, max_attempts)?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    // Tell the frontend the actual bound port BEFORE we start waiting for
    // a request, so it can build the redirect_uri against the right port
    // and only then open the browser. Without this, a busy preferred port
    // causes the browser to be sent to e.g. 1455 while the listener is on
    // 1456 — the callback never reaches us.
    if let Err(e) = app.emit(OAUTH_BOUND_EVENT, bound_port) {
        eprintln!("[oauth] failed to emit bound event: {}", e);
    }

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

                // Request line looks like: "GET /auth/callback?... HTTP/1.1"
                let path = request_line
                    .split_whitespace()
                    .nth(1)
                    .map(|s| s.to_string())
                    .ok_or_else(|| "malformed HTTP request line".to_string())?;

                // Drain the rest of the headers so the browser doesn't hang
                // waiting for a half-read connection. We don't need them.
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

                return Ok(OAuthListenResult {
                    port: bound_port,
                    path,
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("accept failed: {}", e)),
        }
    }
}
