//! Smoke test for the ort 2.0.0-rc.12 + Windows + load-dynamic
//! workaround in `utils::onnx::init_onnx_from`.
//!
//! Background: ort 2.0.0-rc.12 internally requests `ORT_API_VERSION =
//! 24`, but parakeet-rs ships `onnxruntime.dll` 1.23.0, whose API
//! table only goes up to 23. ort's `setup_api` doesn't fall back —
//! it asserts non-null — and on Windows the failure mode looks like a
//! silent hang rather than a clean panic (the runtime's stderr
//! diagnostic is buffered and the assertion's unwind stalls before
//! the parent process notices).
//!
//! Workaround: manually load the DLL, walk down from `ORT_API_VERSION`
//! until `OrtApiBase::GetApi` returns non-null, then hand the table
//! to `ort::set_api`. Implemented in `utils::onnx::init_onnx_from`.
//!
//! This binary exercises the full chain (init → Session::builder →
//! commit_from_file on a real model) and prints timings so we have a
//! quick "did the workaround break?" check after dep bumps.

use std::env;
use std::io::Write;
use std::time::Instant;

macro_rules! say {
    ($($arg:tt)*) => {{
        println!($($arg)*);
        let _ = std::io::stdout().flush();
    }};
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let exe = env::current_exe().unwrap_or_default();
    let exe_dir = exe.parent().unwrap_or(&exe).to_path_buf();
    let dll = exe_dir.join("onnxruntime.dll");
    say!("[1] dll = {} (exists: {})", dll.display(), dll.exists());

    say!("[2] manual ort initialisation (bypasses ort::init_from)");
    let t = Instant::now();
    classnoteai_lib::utils::onnx::init_onnx_from(&dll)?;
    say!("    {} ms", t.elapsed().as_millis());

    say!("[3] Session::builder()");
    let t = Instant::now();
    let b = ort::session::Session::builder()?;
    say!("    {} ms", t.elapsed().as_millis());
    let _ = b;

    let model: std::path::PathBuf = env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .ok_or("no APPDATA")?
        .join("com.classnoteai")
        .join("models")
        .join("parakeet-nemotron-int8")
        .join("decoder_joint.onnx");
    say!("[4] commit_from_file({})", model.display());
    say!("    exists = {}", model.exists());
    if !model.exists() {
        say!("    skipping — model not on disk");
        say!("DONE");
        return Ok(());
    }
    let t = Instant::now();
    let session = ort::session::Session::builder()?.commit_from_file(&model)?;
    say!("    {} ms — session created", t.elapsed().as_millis());
    let _ = session;

    say!("DONE");
    Ok(())
}
