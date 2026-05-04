//! TranslateGemma llama-server sidecar lifecycle.
//!
//! Spawns and supervises the bundled `llama-server` binary so the renderer
//! sees the Gemma backend as a self-contained service — no manual setup,
//! no external Ollama install. Mirrors the existing ffmpeg pattern in
//! `recording/video_import.rs` (locate binary, spawn with no-window flag,
//! reap on app exit).
//!
//! ## Binary resolution order
//!
//! 1. **Bundled** — `<resource_dir>/binaries/llama-server-<TARGET-TRIPLE>.exe`
//!    populated by the release CI workflow before `tauri build`. This is
//!    the production path users will hit.
//! 2. **Dev override** — `D:\tools\llama-cpp\bin\llama-server.exe` (the
//!    location our `gpu-dev-env-windows.bat` script already uses). Lets
//!    devs iterate without bundling on every change.
//! 3. **`PATH` lookup** — last resort for advanced users / Linux ports.
//!
//! ## Lifecycle
//!
//! - `ensure_running(model_path, port)` either confirms the existing
//!   sidecar is healthy or spawns a fresh one and waits for `/health`.
//! - The spawned `Child` is parked inside a global `Mutex<Option<Child>>`
//!   so we can `kill()` it on app shutdown. Tauri's `RunEvent::Exit` hook
//!   in `lib.rs` calls [`shutdown`] for graceful teardown.
//! - Crash recovery: the next `ensure_running` call detects the dead
//!   child via `try_wait` and replaces it.

use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::paths;
use crate::utils::command::no_window;

/// Default localhost port. Picked to match the dev-time manual command
/// documented in `SettingsTranslation.tsx` so settings + sidecar agree
/// out of the box.
pub const DEFAULT_PORT: u16 = 8080;

/// Health-check probe deadline. llama-server cold-starts in ~1-3 s on
/// CPU + ~5 s when GPU offload (-ngl) loads weights. 30 s headroom for
/// slow disks / first-time CUDA kernel JIT.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);

/// One global child handle. `Option::None` means "no sidecar is currently
/// owned by us" — either because the user picked a non-Gemma provider, or
/// because we detected a pre-existing sidecar (e.g. one the dev started
/// manually) and chose not to manage it.
static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn child_lock() -> &'static Mutex<Option<Child>> {
    CHILD.get_or_init(|| Mutex::new(None))
}

/// cp75.24 — spawn-critical-section serializer.
///
/// Distinct from [`CHILD`] so we can hold it across the "should-I-spawn"
/// decision + the spawn syscall + storing the resulting `Child` handle
/// without ever holding a `MutexGuard` across an `.await` point. The
/// previous design read the child slot, made an async health probe, and
/// only then locked + spawned — two concurrent `ensure_running` calls
/// could both clear the dead-handle, both pass the probe, and both spawn
/// a fresh `llama-server`, racing over the TCP port (1455 / 8080
/// EADDRINUSE crash). With this lock the spawn decision is atomic w.r.t.
/// other in-process callers.
static SPAWN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn spawn_lock() -> &'static Mutex<()> {
    SPAWN_LOCK.get_or_init(|| Mutex::new(()))
}

/// True if a sidecar process is currently running under our supervision.
/// Cheap probe; doesn't HTTP-check.
pub fn is_running() -> bool {
    let mut guard = match child_lock().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => true, // still alive
            Ok(Some(status)) => {
                eprintln!(
                    "[gemma_sidecar] child exited unexpectedly: {status:?} — clearing handle"
                );
                *guard = None;
                false
            }
            Err(e) => {
                eprintln!("[gemma_sidecar] try_wait failed: {e} — assuming dead");
                *guard = None;
                false
            }
        }
    } else {
        false
    }
}

/// Locate the llama-server binary. See module docs for resolution order.
pub fn locate_binary(app_resource_dir: Option<&PathBuf>) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    // 1. Bundled in app resources
    if let Some(dir) = app_resource_dir {
        let bundled = dir.join("binaries").join(exe_name);
        if bundled.exists() {
            return Some(bundled);
        }
    }

    // 2. Dev overrides — explicit paths our docs already point at,
    //    per-OS so contributors on each platform have a "just works"
    //    path before bundling exists.
    #[cfg(windows)]
    {
        for p in [
            r"D:\tools\llama-cpp\bin\llama-server.exe",
            r"C:\tools\llama-cpp\bin\llama-server.exe",
        ] {
            let pb = PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for p in [
            "/opt/homebrew/bin/llama-server",
            "/usr/local/bin/llama-server",
            // Build-from-source default (cmake --install)
            "/opt/llama.cpp/bin/llama-server",
        ] {
            let pb = PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for p in ["/usr/local/bin/llama-server", "/usr/bin/llama-server"] {
            let pb = PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
    }

    // 3. PATH lookup via `where` / `which`. We don't run the binary; just
    //    ask the OS to find it. Same trick `video_import::locate_ffmpeg`
    //    uses for ffmpeg.
    let probe_cmd = if cfg!(windows) { "where" } else { "which" };
    let output = no_window(probe_cmd).arg(exe_name).output().ok()?;
    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout);
        let first_line = path_str.lines().next().map(|s| s.trim().to_string())?;
        if !first_line.is_empty() {
            return Some(PathBuf::from(first_line));
        }
    }

    None
}

#[cfg(windows)]
fn prepend_to_path(cmd: &mut std::process::Command, dir: &std::path::Path) {
    let mut paths: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    paths.insert(0, dir.to_path_buf());
    if let Ok(joined) = std::env::join_paths(paths) {
        cmd.env("PATH", joined);
    }
}

fn configure_sidecar_command(cmd: &mut std::process::Command, bin: &std::path::Path) {
    if let Some(dir) = bin.parent() {
        // Keep llama.cpp's sibling backend/runtime DLLs resolvable. This is
        // important for the CUDA build and harmless for the CPU build.
        cmd.current_dir(dir);
        #[cfg(windows)]
        prepend_to_path(cmd, dir);
    }
}

/// Probe `http://127.0.0.1:<port>/health` once.
async fn probe_health(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/health");
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    matches!(client.get(&url).send().await, Ok(r) if r.status().is_success())
}

/// Block until `/health` returns 200 or [`HEALTH_TIMEOUT`] elapses.
/// Returns `true` on success.
async fn wait_for_health(port: u16) -> bool {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        if probe_health(port).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}

/// Build the llama-server argv. Matches the manual command our docs
/// give users for dev testing — keep them in sync.
///
/// **Context window** is set to 4096 tokens. The renderer's
/// `SentenceAccumulator` hard-caps committed sentences at 60 words
/// (≈ 80–120 tokens English, ~200 tokens English+ZH+chat scaffold),
/// well under 1024. The 4× headroom is for: (a) the rare 60-word
/// English sentence with dense morphology that token-explodes,
/// (b) future rolling-context wiring in `translationPipeline.ts`
/// that prepends prior pairs, and (c) the c=1024 incident from the
/// 2026-04-25 eval where a pre-existing sidecar started with the
/// llama-server default rejected a 9721-token request from a
/// pre-fix unbounded sentence. KV-cache cost at c=4096 is well under
/// 1 GB on Q4_K_M, fits any 4GB+ VRAM card.
fn server_args(model_path: &str, port: u16) -> Vec<String> {
    // cp74.3 changes:
    //  - Removed `--temp 0.0` server-side default. Per-request body now
    //    controls temperature so we can ship 0.0 for translation but
    //    higher values for any future chat / refinement use of the same
    //    sidecar without rebooting.
    //  - Kept `--no-jinja`. We tested switching to `--jinja` so we could
    //    drive TranslateGemma's specialized chat template through the
    //    OpenAI-compatible /v1/chat/completions endpoint, but support for
    //    structured-content payloads (source_lang_code / target_lang_code
    //    fields) varies by llama-server version. The official reference
    //    implementation (TranslateGemma-Studio) also stays on `/completion`
    //    + manual prompt rendering, so that's the lower-risk path. We
    //    instead beef up the prompt itself in `build_prompt` below.
    vec![
        "-m".into(),
        model_path.into(),
        "-ngl".into(),
        "99".into(),
        "-c".into(),
        "4096".into(),
        "--port".into(),
        port.to_string(),
        "--host".into(),
        "127.0.0.1".into(),
        "--no-jinja".into(),
    ]
}

/// Result of a sidecar bring-up attempt — distinguishes "we spawned it"
/// from "an existing one was already serving" so the caller can log
/// usefully and the UI can adjust messaging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BringUpResult {
    /// A sidecar was already healthy at this port (we didn't spawn).
    AlreadyRunning,
    /// We spawned a fresh sidecar and `/health` came back green.
    Spawned,
    /// We tried but couldn't get a healthy response within the timeout.
    Timeout,
    /// Binary couldn't be located.
    BinaryNotFound,
    /// `Command::spawn` failed (permissions, missing DLL, etc.).
    SpawnError,
}

/// cp75.24 — outcome of the synchronous spawn-decision step.
///
/// Distinguishes "another in-process caller already raced ahead and
/// spawned a child while we waited for the lock" (`AlreadySpawned`) from
/// "we ourselves spawned" so the async caller can pick the right
/// `BringUpResult`.
enum SpawnDecision {
    /// We spawned a fresh `Child`. Caller must `wait_for_health`.
    JustSpawned,
    /// A managed child was already alive when we acquired the lock —
    /// another concurrent caller spawned it. Caller still needs to
    /// `wait_for_health` (the child may not have finished startup yet)
    /// but should report this as `AlreadyRunning` to the UI.
    AlreadySpawned,
    /// Binary couldn't be located.
    BinaryNotFound,
    /// `Command::spawn` failed.
    SpawnError,
}

/// Synchronous spawn-critical section. Holds [`spawn_lock`] for the
/// entire decision + spawn + handle-store window. **Must not call any
/// `.await`** — `std::sync::MutexGuard` is `!Send` and tokio multi-thread
/// runtime would refuse, but more importantly we want this section to
/// run to completion atomically per in-process caller.
fn try_spawn_under_lock(
    model_path: &str,
    port: u16,
    app_resource_dir: Option<&PathBuf>,
) -> SpawnDecision {
    let _spawn_guard = spawn_lock().lock().unwrap_or_else(|p| p.into_inner());

    // Re-check under lock: another caller may have spawned while we
    // waited. `is_running` does its own try_wait + slot-clear, so a
    // dead handle is reset to None and we'll respawn below.
    if is_running() {
        return SpawnDecision::AlreadySpawned;
    }

    // Locate binary
    let bin = match locate_binary(app_resource_dir) {
        Some(p) => p,
        None => {
            eprintln!(
                "[gemma_sidecar] llama-server binary not found in any of: bundled, dev path, PATH"
            );
            return SpawnDecision::BinaryNotFound;
        }
    };

    // Spawn. Capture llama-server's stderr to a file under the app
    // data dir so the FIRST thing we look at on a `BringUpResult::
    // Timeout` ticket is the actual sidecar log instead of "well it
    // didn't say anything". Prior behaviour was `Stdio::null()` —
    // every llama-server failure mode (CUDA OOM, GGUF mismatch,
    // port already bound, model file missing) was invisible.
    println!(
        "[gemma_sidecar] spawning {} on :{port} with model {}",
        bin.display(),
        model_path
    );
    let log_path = sidecar_log_path();
    let stderr_target = match log_path
        .as_ref()
        .and_then(|p| OpenOptions::new().create(true).append(true).open(p).ok())
    {
        Some(f) => {
            if let Some(p) = log_path.as_ref() {
                println!("[gemma_sidecar] llama-server stderr → {}", p.display());
            }
            Stdio::from(f)
        }
        None => {
            eprintln!(
                "[gemma_sidecar] could not open log file (would have been {:?}); \
                 falling back to inheriting parent stderr",
                log_path
            );
            Stdio::inherit()
        }
    };
    let mut cmd = no_window(&bin);
    configure_sidecar_command(&mut cmd, &bin);
    cmd.args(server_args(model_path, port))
        // stdout still discarded — llama-server's progress chatter is
        // verbose and not actionable. stderr is what carries the
        // failure-mode messages worth keeping.
        .stdout(Stdio::null())
        .stderr(stderr_target)
        .stdin(Stdio::null());
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[gemma_sidecar] spawn failed: {e}");
            return SpawnDecision::SpawnError;
        }
    };

    {
        let mut guard = child_lock().lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some(child);
    }

    SpawnDecision::JustSpawned
    // _spawn_guard dropped here — releases the spawn lock for the
    // next concurrent caller, who will see `is_running() == true` and
    // return `AlreadySpawned`.
}

/// Ensure a sidecar is healthy on `port`. Spawns one if needed.
///
/// `model_path` must point at a `.gguf` model file readable by llama-server
/// (e.g. `translategemma-4b_Q4_K_M.gguf`).
/// `app_resource_dir` is the Tauri app resource directory (used for
/// bundled-binary lookup); pass `None` to rely on dev/PATH fallbacks only.
///
/// **cp75.24 concurrency:** the decision-and-spawn step runs under
/// [`spawn_lock`] so two concurrent callers can't both clear the dead
/// handle and both spawn. The async health probe runs OUTSIDE the lock
/// (we can't hold a `std::sync::MutexGuard` across `.await`), but that's
/// safe — the lock protects the only step that has a side-effect on the
/// child slot.
pub async fn ensure_running(
    model_path: &str,
    port: u16,
    app_resource_dir: Option<PathBuf>,
) -> BringUpResult {
    // 1. Fast path — already healthy? (dev started manually, or prior
    //    call kept it alive). Lock-free, async; safe even under
    //    concurrent callers because at worst they all return
    //    AlreadyRunning without spawning.
    if probe_health(port).await {
        return BringUpResult::AlreadyRunning;
    }

    // 2. Lock-protected spawn decision. Re-checks `is_running()` under
    //    the lock so a racing caller can't double-spawn. Returns
    //    synchronously; we await health below.
    let decision = try_spawn_under_lock(model_path, port, app_resource_dir.as_ref());

    match decision {
        SpawnDecision::BinaryNotFound => return BringUpResult::BinaryNotFound,
        SpawnDecision::SpawnError => return BringUpResult::SpawnError,
        SpawnDecision::AlreadySpawned | SpawnDecision::JustSpawned => {
            // Both paths still need to wait for /health — the racing
            // caller's child may not have finished startup yet.
        }
    }

    // 3. Wait for /health
    if wait_for_health(port).await {
        println!("[gemma_sidecar] sidecar ready on :{port}");
        match decision {
            SpawnDecision::JustSpawned => BringUpResult::Spawned,
            SpawnDecision::AlreadySpawned => BringUpResult::AlreadyRunning,
            // unreachable — early-returned above
            SpawnDecision::BinaryNotFound => BringUpResult::BinaryNotFound,
            SpawnDecision::SpawnError => BringUpResult::SpawnError,
        }
    } else {
        eprintln!("[gemma_sidecar] /health timeout — killing sidecar");
        shutdown();
        BringUpResult::Timeout
    }
}

/// Resolve the path llama-server's stderr is appended to. Returns
/// `None` when we can't determine an app-data dir — caller then falls
/// back to inheriting the parent's stderr (visible in dev terminals).
pub fn sidecar_log_path() -> Option<PathBuf> {
    let dir = paths::get_app_data_dir().ok()?.join("logs");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[gemma_sidecar] mkdir {} failed: {e}", dir.display());
        return None;
    }
    Some(dir.join("llama-server.log"))
}

/// Kill the supervised sidecar. Idempotent — does nothing if we never
/// spawned one or the child has already exited.
pub fn shutdown() {
    let mut guard = child_lock().lock().unwrap_or_else(|p| p.into_inner());
    if let Some(mut child) = guard.take() {
        // Best-effort SIGTERM-ish. On Windows this is TerminateProcess.
        if let Err(e) = child.kill() {
            eprintln!("[gemma_sidecar] kill failed: {e}");
        }
        let _ = child.wait();
        println!("[gemma_sidecar] sidecar shut down");
    }
}

// ─────────────────────────────────────────────────────────────────────
// cp75.24 — concurrency tests
//
// We don't spin up a real `llama-server` here (3 s startup, GPU init
// surface, port collisions in CI all make that flaky as a unit test).
// Instead we exercise the EXACT lock primitive `try_spawn_under_lock`
// uses (`spawn_lock()`), with a counter standing in for the
// "spawn child + store handle" side effect. If two concurrent threads
// were able to both clear-and-respawn under the old design, the same
// flaw would show up here as the counter advancing past `1` from the
// inside of the critical section. With the lock the counter MUST be
// observed strictly serially — exactly the property the production
// code relies on to avoid the 1455/8080 EADDRINUSE crash.
// ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod cp75_24_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    /// The same lock acquisition pattern used by `try_spawn_under_lock`,
    /// but with a counter instead of a real child. If two threads ever
    /// observe the same `snapshot` value (i.e. they were both inside
    /// the critical section at the same time) the lock is broken.
    fn locked_critical_section_increment(
        counter: &AtomicUsize,
        observed: &Arc<std::sync::Mutex<Vec<usize>>>,
    ) {
        let _g = spawn_lock().lock().unwrap_or_else(|p| p.into_inner());
        // Read-modify-write inside the critical section. The sleep
        // widens the race window so a missing lock would reliably show
        // up rather than only on unlucky scheduling.
        let snapshot = counter.load(Ordering::SeqCst);
        thread::sleep(Duration::from_millis(5));
        counter.store(snapshot + 1, Ordering::SeqCst);
        observed.lock().unwrap().push(snapshot);
    }

    #[test]
    fn spawn_lock_serializes_concurrent_callers() {
        // Reset is implicit — counter starts at 0 in this scope. The
        // global `spawn_lock` may have been used by another test, but
        // the lock's job is mutual exclusion of the critical section,
        // not of state — using a fresh per-test counter is the right
        // hygiene.
        let counter = Arc::new(AtomicUsize::new(0));
        let observed: Arc<std::sync::Mutex<Vec<usize>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));

        let n_threads = 8;
        let handles: Vec<_> = (0..n_threads)
            .map(|_| {
                let counter = Arc::clone(&counter);
                let observed = Arc::clone(&observed);
                thread::spawn(move || {
                    locked_critical_section_increment(&counter, &observed);
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        // Every thread must have observed a UNIQUE snapshot — that's
        // the proof of serialization. With a broken lock, two threads
        // would both read `0`, both write `1`, and the final counter
        // would be < n_threads (lost update).
        let mut seen = observed.lock().unwrap().clone();
        seen.sort();
        let expected: Vec<usize> = (0..n_threads).collect();
        assert_eq!(
            seen, expected,
            "spawn_lock failed to serialize: observed snapshots {:?}",
            seen
        );
        assert_eq!(
            counter.load(Ordering::SeqCst),
            n_threads,
            "lost-update detected — lock didn't hold across read-modify-write"
        );
    }

    #[test]
    fn spawn_lock_recovers_from_poisoning() {
        // Poison the lock from a panicking thread, then verify the
        // production-code idiom `lock().unwrap_or_else(|p| p.into_inner())`
        // still yields a usable guard. This mirrors what
        // `try_spawn_under_lock` does after any prior caller panicked.
        let panicked = thread::spawn(|| {
            let _g = spawn_lock().lock().unwrap_or_else(|p| p.into_inner());
            panic!("intentional poison for test");
        })
        .join();
        assert!(panicked.is_err(), "panic should have propagated to join");

        // Production idiom — must NOT panic even with poisoned lock.
        let _g = spawn_lock().lock().unwrap_or_else(|p| p.into_inner());
        // If we got here, the recovery path works.
    }
}
