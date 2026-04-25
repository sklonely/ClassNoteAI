use std::sync::Once;

static INIT: Once = Once::new();

/// Initialize the ONNX Runtime environment using `ORT_DYLIB_PATH`.
/// Idempotent — call early at app startup; later calls no-op.
///
/// Internally calls [`init_onnx_from`] with the path stored in
/// `ORT_DYLIB_PATH`.
pub fn init_onnx() {
    INIT.call_once(|| {
        let dylib = std::env::var_os("ORT_DYLIB_PATH").map(std::path::PathBuf::from);
        match dylib {
            Some(path) => match init_onnx_from(&path) {
                Ok(()) => {
                    println!("[ORT] initialised via init_onnx_from({})", path.display());
                }
                Err(e) => {
                    eprintln!("[ORT] init_onnx_from({}) failed: {e}", path.display());
                }
            },
            None => {
                eprintln!(
                    "[ORT] ORT_DYLIB_PATH not set; cannot init via the safe path. \
                     Falling back to ort::init() — may hit the rc.12 Windows hang."
                );
                let _ = ort::init().commit();
            }
        }
    });
}

/// Manually load `onnxruntime.dll` from `dylib` and seed ort's global
/// API pointer via [`ort::set_api`], **bypassing** `ort::init_from`.
///
/// **Why we bypass `ort::init_from`:** on Windows + load-dynamic + ort
/// 2.0.0-rc.12, `ort::init_from` hangs forever inside its own
/// `load_dylib_from_path` chain (`libloading::Library::new` + symbol
/// lookup + `OrtGetApiBase` + `GetVersionString`). Each individual
/// C-level step works in <3 ms when invoked outside that chain (proved
/// via `examples/loadlib_test.rs`), but the integrated path deadlocks
/// — root cause still unknown after isolating every step. See
/// `docs/follow-ups/parakeet-rs-windows-ort-hang-handoff.md`.
///
/// The workaround pulls the `OrtApi` struct out of the DLL ourselves
/// and hands it to `ort::set_api`. From that point, `ort::api()`
/// returns our pointer and never tries to initialise via the broken
/// loader. `Session::builder` and the rest of the high-level API work
/// normally.
///
/// On non-Windows targets this still uses `ort::init_from` because
/// the bug is Windows-specific.
pub fn init_onnx_from(dylib: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows_load_and_set_api(dylib)
    }
    #[cfg(not(windows))]
    {
        ort::init_from(dylib)
            .map_err(|e| format!("ort::init_from failed: {e}"))?
            .commit();
        Ok(())
    }
}

/// Tell Windows' loader to add `dir` to the high-priority DLL search
/// list for transitive loads. Switches the process to **safe DLL
/// search mode** at the same time so `C:\Windows\System32\onnxruntime.dll`
/// (WinML 1.17) doesn't get picked up ahead of our bundled v1.23 when
/// the runtime later pulls in `onnxruntime_providers_shared.dll`,
/// `DirectML.dll`, etc.
#[cfg(windows)]
fn install_dll_search_dir(dir: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::LibraryLoader::{
        AddDllDirectory, SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_APPLICATION_DIR,
        LOAD_LIBRARY_SEARCH_SYSTEM32, LOAD_LIBRARY_SEARCH_USER_DIRS,
    };

    let wide: Vec<u16> = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // SAFETY: documented Win32 calls; constants from windows-sys; path
    // is a NUL-terminated UTF-16 string owned by the local Vec.
    unsafe {
        SetDefaultDllDirectories(
            LOAD_LIBRARY_SEARCH_USER_DIRS
                | LOAD_LIBRARY_SEARCH_APPLICATION_DIR
                | LOAD_LIBRARY_SEARCH_SYSTEM32,
        );
        AddDllDirectory(wide.as_ptr());
    }
}

#[cfg(windows)]
fn windows_load_and_set_api(dylib: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
    };

    if !dylib.exists() {
        return Err(format!("dylib not found: {}", dylib.display()));
    }

    if let Some(parent) = dylib.parent() {
        install_dll_search_dir(parent);
    }

    let wide: Vec<u16> = dylib
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // SAFETY: NUL-terminated UTF-16 path, well-known flag combo. The
    // returned HMODULE is process-global and we never FreeLibrary it.
    let h = unsafe {
        LoadLibraryExW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
        )
    };
    if h.is_null() {
        let e = unsafe { GetLastError() };
        return Err(format!(
            "LoadLibraryExW({}) failed; GetLastError = {} (0x{:x})",
            dylib.display(),
            e,
            e
        ));
    }

    let sym = b"OrtGetApiBase\0";
    let proc = unsafe { GetProcAddress(h, sym.as_ptr()) }
        .ok_or_else(|| "GetProcAddress(OrtGetApiBase) returned NULL".to_string())?;

    // SAFETY: `proc` is a valid function pointer to OrtGetApiBase as
    // exported by onnxruntime.dll. ORT_API_CALL on Windows x64 is the
    // standard MS-x64 calling convention, which matches `extern "system"`.
    let get_api_base: unsafe extern "system" fn() -> *const ort::sys::OrtApiBase =
        unsafe { std::mem::transmute(proc) };

    let base: *const ort::sys::OrtApiBase = unsafe { get_api_base() };
    if base.is_null() {
        return Err("OrtGetApiBase() returned NULL".to_string());
    }

    // Log the runtime version so we have parity with what ort would have
    // logged via crate::info!.
    let version_ptr = unsafe { ((*base).GetVersionString)() };
    if !version_ptr.is_null() {
        let v = unsafe { std::ffi::CStr::from_ptr(version_ptr) }.to_string_lossy();
        println!(
            "[ORT] loaded onnxruntime v{} from {}",
            v,
            dylib.display()
        );
    }

    // ort 2.0.0-rc.12 advertises ORT_API_VERSION = 24, but this build
    // of `parakeet-rs` ships an onnxruntime.dll whose embedded API
    // table only goes up to 23. Asking for 24 returns NULL ("requested
    // API version is not available"). Walk down from the requested
    // version until the runtime hands us a non-NULL table — older API
    // levels are supersets of the newer ones we use.
    let mut api_version = ort::sys::ORT_API_VERSION;
    let api_ptr = loop {
        let p = unsafe { ((*base).GetApi)(api_version) };
        if !p.is_null() {
            if api_version != ort::sys::ORT_API_VERSION {
                eprintln!(
                    "[ORT] ort wants API v{} but DLL only supports v{}; using v{}",
                    ort::sys::ORT_API_VERSION,
                    api_version,
                    api_version
                );
            }
            break p;
        }
        if api_version <= 1 {
            return Err(format!(
                "OrtApiBase::GetApi returned NULL for every API version 1..={} — \
                 the bundled onnxruntime.dll has no compatible API table",
                ort::sys::ORT_API_VERSION
            ));
        }
        api_version -= 1;
    };

    // Copy the OrtApi struct into a local and hand it to ort. ort
    // boxes + leaks it internally; we never need the original pointer
    // again. Returns false if a previous set_api won the race — that's
    // fine, the existing API stays in place (idempotent).
    //
    // SAFETY: `api_ptr` is a valid `*const OrtApi` returned by the
    // runtime; it points to a static struct inside onnxruntime.dll that
    // outlives any use we'd make of the copy.
    let api_copy: ort::sys::OrtApi = unsafe { std::ptr::read(api_ptr) };
    let _ = ort::set_api(api_copy);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_onnx() {
        // First call should succeed
        init_onnx();
        // Second call should also succeed (idempotent)
        init_onnx();
    }

    /// Regression guard for the Windows DLL-precedence hang. With the
    /// `set_api` workaround in place this should pass; if `init_from`
    /// ever creeps back into the load path on Windows, this test will
    /// hang again.
    #[test]
    fn test_session_builder_does_not_hang() {
        init_onnx();
        let t = std::time::Instant::now();
        let builder = ort::session::Session::builder();
        eprintln!(
            "Session::builder() returned in {} ms — ok={}",
            t.elapsed().as_millis(),
            builder.is_ok()
        );
        assert!(
            builder.is_ok(),
            "Session::builder failed: {:?}",
            builder.err()
        );
    }
}
