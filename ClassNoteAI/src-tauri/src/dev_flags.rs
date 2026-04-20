//! Developer / agent-mode experimental toggles that have to be read
//! **before** Tauri spins up WebView2. These can't live in the main
//! SQLite DB because DB init runs inside `tauri::Builder::setup`, far
//! too late to influence env vars that WebView2 consumes at launch.
//!
//! Storage: a minimal `dev-flags.toml` under the app's platform data
//! dir (same directory as the SQLite db). Missing file / invalid TOML
//! / missing key all degrade to "flag off" — safe default.
//!
//! Write path: the frontend's Settings → experimental → "Remote debug
//! port" toggle invokes `set_remote_debug_enabled` (command in
//! `lib.rs`), which updates the TOML. Flag only takes effect on next
//! app launch; Settings UI shows a "請重啟應用程式" hint after toggling.

use std::path::PathBuf;

/// The only key we currently store. Expand the struct if a second
/// flag needs pre-WebView2 timing; the file format is cheap to grow.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DevFlags {
    /// When `true`, `main()` sets
    /// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port={port}`
    /// so `scripts/cdp.cjs` + third-party agents (Playwright, Claude
    /// Code, etc.) can drive the installed release the same way
    /// they drive the dev build.
    #[serde(default)]
    pub remote_debug_port_enabled: bool,
}

/// Resolve the TOML path without depending on Tauri's app handle
/// (which isn't available at `main()` entry). Matches the Tauri
/// platform convention — same root the DB ends up under.
fn flags_file() -> Option<PathBuf> {
    // `dirs::config_dir()` on Windows → `%APPDATA%`, on macOS →
    // `~/Library/Application Support`, on Linux → `~/.config`.
    // Subdir matches the bundle identifier from `tauri.conf.json`.
    let base = dirs::config_dir()?;
    Some(base.join("com.classnoteai").join("dev-flags.toml"))
}

pub fn load() -> DevFlags {
    let Some(path) = flags_file() else {
        return DevFlags::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return DevFlags::default();
    };
    toml::from_str::<DevFlags>(&text).unwrap_or_default()
}

pub fn save(flags: &DevFlags) -> Result<(), String> {
    let path = flags_file().ok_or_else(|| "config dir unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let text = toml::to_string_pretty(flags).map_err(|e| format!("toml serialize: {}", e))?;
    std::fs::write(&path, text).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

/// Cheap read for `main()` — no error propagation, defaults to off.
pub fn remote_debug_enabled() -> bool {
    load().remote_debug_port_enabled
}
