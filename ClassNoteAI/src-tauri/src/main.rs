// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Developer / agent-mode opt-in: if the user flipped the
    // experimental "Remote debug port" toggle in Settings, we honour
    // it here — BEFORE Tauri fires up WebView2, because
    // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is read at WebView2
    // process-start time. Anything set after `tauri::Builder::run()`
    // is too late.
    //
    // Flag is stored in `%APPDATA%\com.classnoteai\dev-flags.toml`
    // (not the main SQLite DB, which init runs much later than this
    // point). Missing / unreadable file means "off" — safe default.
    // On: opens `127.0.0.1:9222` for Chrome DevTools Protocol,
    // matching what `win-tauri-dev.bat` already does for dev builds.
    // Users toggling this get a restart prompt; the flag takes
    // effect on next launch only.
    if classnoteai_lib::dev_flags::remote_debug_enabled() {
        let port = std::env::var("CNAI_DEV_CDP_PORT").unwrap_or_else(|_| "9222".to_string());
        let args = format!("--remote-debugging-port={}", port);
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &args);
        eprintln!(
            "[ClassNoteAI] Remote debug port enabled: http://127.0.0.1:{}",
            port
        );
    }
    classnoteai_lib::run()
}
