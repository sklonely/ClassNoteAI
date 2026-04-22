//! Windows system proxy detection.
//!
//! `reqwest` auto-honors `HTTP_PROXY` / `HTTPS_PROXY` environment variables
//! but does not read the Windows Internet Settings registry. Users behind a
//! corporate / campus proxy configured only via the Windows UI therefore
//! cannot reach our update, model-download, and LLM endpoints.
//!
//! At startup we query the registry via `reg.exe` (no extra crate needed),
//! and if a proxy is enabled but no env var is set yet, we populate
//! `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. This is a one-shot best-effort
//! hook — env vars set by the user (shell, Task Scheduler, system-wide) always
//! win.

#[cfg(target_os = "windows")]
pub fn apply_system_proxy_env() {
    const REG_PATH: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    let enabled = read_reg_value(REG_PATH, "ProxyEnable")
        .and_then(|s| parse_dword(&s))
        .unwrap_or(0);

    if enabled == 0 {
        return;
    }

    let server = match read_reg_value(REG_PATH, "ProxyServer") {
        Some(s) if !s.trim().is_empty() => s,
        _ => return,
    };

    let (http_proxy, https_proxy) = split_per_scheme(&server);

    if std::env::var_os("HTTP_PROXY").is_none() && std::env::var_os("http_proxy").is_none() {
        if let Some(url) = normalize_proxy_url(&http_proxy, "http") {
            println!("[net] Windows system HTTP_PROXY = {}", url);
            std::env::set_var("HTTP_PROXY", &url);
        }
    }

    if std::env::var_os("HTTPS_PROXY").is_none() && std::env::var_os("https_proxy").is_none() {
        if let Some(url) = normalize_proxy_url(&https_proxy, "http") {
            println!("[net] Windows system HTTPS_PROXY = {}", url);
            std::env::set_var("HTTPS_PROXY", &url);
        }
    }

    if std::env::var_os("NO_PROXY").is_none() && std::env::var_os("no_proxy").is_none() {
        if let Some(bypass) = read_reg_value(REG_PATH, "ProxyOverride") {
            let normalized = bypass
                .replace(';', ",")
                .replace("<local>", "localhost,127.0.0.1");
            if !normalized.trim().is_empty() {
                std::env::set_var("NO_PROXY", normalized);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn apply_system_proxy_env() {
    // Nothing to do: macOS and Linux reqwest users either use env vars
    // already or configure a proxy inside their shell profile.
}

#[cfg(target_os = "windows")]
fn read_reg_value(path: &str, name: &str) -> Option<String> {
    use crate::utils::command::no_window;

    let output = no_window("reg")
        .args(["query", path, "/v", name])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    // Expected line: "    ProxyServer    REG_SZ    proxy.example:8080"
    for line in text.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with(name) {
            continue;
        }
        let mut parts = trimmed.splitn(3, char::is_whitespace);
        let _name = parts.next()?;
        // After the name there may be consecutive spaces. Skip to the type token.
        let rest = parts.next()?.trim_start();
        let mut pieces = rest.splitn(2, char::is_whitespace);
        let _ty = pieces.next()?;
        let value = pieces.next().unwrap_or("").trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn parse_dword(s: &str) -> Option<u32> {
    let trimmed = s.trim();
    if let Some(hex) = trimmed.strip_prefix("0x") {
        u32::from_str_radix(hex, 16).ok()
    } else {
        trimmed.parse::<u32>().ok()
    }
}

/// `ProxyServer` can be one of:
///   - "proxy.host:8080"                    (single proxy for all schemes)
///   - "http=h1:80;https=h2:80;ftp=h3:80"   (per-scheme)
///
/// Returns `(http_entry, https_entry)` where each is a host:port or empty.
#[cfg(target_os = "windows")]
fn split_per_scheme(raw: &str) -> (String, String) {
    if !raw.contains('=') {
        return (raw.to_string(), raw.to_string());
    }

    let mut http = String::new();
    let mut https = String::new();
    for pair in raw.split(';') {
        let mut kv = pair.splitn(2, '=');
        let scheme = kv.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = kv.next().unwrap_or("").trim();
        match scheme.as_str() {
            "http" => http = value.to_string(),
            "https" => https = value.to_string(),
            _ => {}
        }
    }
    if https.is_empty() && !http.is_empty() {
        https = http.clone();
    }
    if http.is_empty() && !https.is_empty() {
        http = https.clone();
    }
    (http, https)
}

#[cfg(target_os = "windows")]
fn normalize_proxy_url(entry: &str, default_scheme: &str) -> Option<String> {
    let trimmed = entry.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Some(trimmed.to_string())
    } else {
        Some(format!("{}://{}", default_scheme, trimmed))
    }
}

#[cfg(test)]
#[cfg(target_os = "windows")]
mod tests {
    use super::*;

    #[test]
    fn parses_dword_decimal_and_hex() {
        assert_eq!(parse_dword("0x1"), Some(1));
        assert_eq!(parse_dword("0x0"), Some(0));
        assert_eq!(parse_dword("1"), Some(1));
    }

    #[test]
    fn splits_single_proxy() {
        let (h, s) = split_per_scheme("proxy.host:8080");
        assert_eq!(h, "proxy.host:8080");
        assert_eq!(s, "proxy.host:8080");
    }

    #[test]
    fn splits_per_scheme() {
        let (h, s) = split_per_scheme("http=h1:80;https=h2:443");
        assert_eq!(h, "h1:80");
        assert_eq!(s, "h2:443");
    }

    #[test]
    fn normalizes_url() {
        assert_eq!(
            normalize_proxy_url("proxy:8080", "http"),
            Some("http://proxy:8080".to_string())
        );
        assert_eq!(
            normalize_proxy_url("http://p:8080", "http"),
            Some("http://p:8080".to_string())
        );
    }
}
