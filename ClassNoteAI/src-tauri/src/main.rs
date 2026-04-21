// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Route Rust panics through the `log` crate so they land in the
    // tauri-plugin-log file at `{APP_DATA}/logs/classnoteai.log`
    // instead of dying with the process. Without this hook, native
    // panics leave zero post-mortem trail, which is what made #72
    // so hard to diagnose before alpha.4.
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let msg = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("<non-string panic payload>");
        if let Some(loc) = info.location() {
            log::error!(
                "PANIC at {}:{}:{} — {}",
                loc.file(),
                loc.line(),
                loc.column(),
                msg
            );
        } else {
            log::error!("PANIC (no location) — {}", msg);
        }
    }));

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
