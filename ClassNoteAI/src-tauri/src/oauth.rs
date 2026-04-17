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

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::Duration;
use tokio::task;

const HTML_SUCCESS: &str = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>ClassNoteAI</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem;color:#333}h1{font-weight:500}p{color:#666}</style></head><body><h1>\u{2705} Authentication complete</h1><p>You can close this tab and return to ClassNoteAI.</p></body></html>";

/// Bind to localhost:`port`, wait up to `timeout_secs` for one request,
/// return the request path (e.g. `/auth/callback?code=...&state=...`).
///
/// Timeout out or any I/O error returns an `Err(String)` so the frontend
/// can show it in the sign-in modal.
#[tauri::command]
pub async fn oauth_listen_for_code(port: u16, timeout_secs: u64) -> Result<String, String> {
    task::spawn_blocking(move || listen_once(port, timeout_secs))
        .await
        .map_err(|e| format!("spawn_blocking join failed: {}", e))?
}

fn listen_once(port: u16, timeout_secs: u64) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("cannot bind 127.0.0.1:{}: {}", port, e))?;
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;

    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    loop {
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

                return Ok(path);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("accept failed: {}", e)),
        }
    }
}
