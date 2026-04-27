use std::sync::Once;

static INIT: Once = Once::new();

/// Initialize the ONNX Runtime environment using `ORT_DYLIB_PATH`.
/// Idempotent — call early at app startup; later calls no-op.
///
/// **All platforms now use the manual `dlopen` + `set_api` workaround**
/// (previously Windows-only, see `windows_load_and_set_api`). Reason:
/// `ort = "2.0.0-rc.12"` advertises `ORT_API_VERSION = 24` but we ship
/// `libonnxruntime.1.23.0.{dylib,so}` which only exports API v23. On
/// Windows this caused the documented hang in `ort::init_from`; on
/// macOS (universal2 dylib) it causes the *same* hang inside
/// `setup()`, which Tauri 2 needs to return before showing any window
/// — net effect is "dock icon appears, window never opens".
///
/// The fix is identical to the Windows path: load the dylib by hand,
/// walk `OrtApiBase::GetApi(v)` down from `ORT_API_VERSION` until it
/// returns non-NULL, hand that table to `ort::set_api`. From then on
/// `ort::api()` returns our pointer and `ort::init_from` is never
/// invoked.
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
                    // Do NOT fall through to ort::init() on any platform.
                    // That path hits the same rc.12 deadlock — better to
                    // surface a clear panic on first Session::builder()
                    // call than to leave the setup hook spinning.
                }
            },
            None => {
                eprintln!(
                    "[ORT] FATAL: ORT_DYLIB_PATH is not set. The Tauri \
                     setup hook in lib.rs is supposed to point it at the \
                     bundled onnxruntime binary *before* calling init_onnx(). \
                     Falling back to ort::init() is unsafe (hangs forever \
                     on the rc.12 + bundled v1.23 combo). Skipping init; \
                     every Session::builder() call will panic until the env \
                     is set and the process restarts."
                );
            }
        }
    });
}

/// Manually load the onnxruntime dylib from `dylib` and seed ort's
/// global API pointer via [`ort::set_api`], **bypassing** any path
/// inside the `ort` crate that calls `OrtApiBase::GetApi` with the
/// hard-coded `ORT_API_VERSION` (currently v24 in rc.12). When the
/// loaded runtime only advertises an older API table — as our pinned
/// v1.23.0 build does — that hard-coded request returns NULL and the
/// crate's recovery path deadlocks.
pub fn init_onnx_from(dylib: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows_load_and_set_api(dylib)
    }
    #[cfg(not(windows))]
    {
        unix_load_and_set_api(dylib)
    }
}

/// Walk `OrtApiBase::GetApi(v)` down from `ORT_API_VERSION` and return
/// the first non-NULL `*const OrtApi`. Shared by all platforms.
///
/// # Safety
/// `base` must be a valid, non-NULL `*const OrtApiBase` returned from
/// `OrtGetApiBase()` and pointing at a static struct inside the loaded
/// onnxruntime library.
unsafe fn walk_down_to_api(
    base: *const ort::sys::OrtApiBase,
) -> Result<*const ort::sys::OrtApi, String> {
    let mut api_version = ort::sys::ORT_API_VERSION;
    loop {
        let p = unsafe { ((*base).GetApi)(api_version) };
        if !p.is_null() {
            if api_version != ort::sys::ORT_API_VERSION {
                eprintln!(
                    "[ORT] ort wants API v{} but onnxruntime only supports v{}; using v{}",
                    ort::sys::ORT_API_VERSION,
                    api_version,
                    api_version
                );
            }
            return Ok(p);
        }
        if api_version <= 1 {
            return Err(format!(
                "OrtApiBase::GetApi returned NULL for every API version 1..={} — \
                 the bundled onnxruntime has no compatible API table",
                ort::sys::ORT_API_VERSION
            ));
        }
        api_version -= 1;
    }
}

/// Read the `OrtApiBase` version string and println! it for parity
/// with what the `ort` crate would have logged via `crate::info!`.
unsafe fn log_runtime_version(base: *const ort::sys::OrtApiBase, source: &std::path::Path) {
    let version_ptr = unsafe { ((*base).GetVersionString)() };
    if !version_ptr.is_null() {
        let v = unsafe { std::ffi::CStr::from_ptr(version_ptr) }.to_string_lossy();
        println!("[ORT] loaded onnxruntime v{} from {}", v, source.display());
    }
}

// ============================================================================
// macOS / Linux loader — uses libloading (dlopen/dlsym wrapper).
// ============================================================================

#[cfg(not(windows))]
fn unix_load_and_set_api(dylib: &std::path::Path) -> Result<(), String> {
    if !dylib.exists() {
        return Err(format!("dylib not found: {}", dylib.display()));
    }

    // SAFETY: `dylib` is a path we control (set by the Tauri setup
    // hook). libloading's `Library::new` invokes `dlopen` under the
    // hood; the loaded library is leaked deliberately so the function
    // pointers we pull out remain valid for the process lifetime.
    let lib = unsafe { libloading::Library::new(dylib) }
        .map_err(|e| format!("dlopen({}) failed: {e}", dylib.display()))?;

    type OrtGetApiBaseFn = unsafe extern "C" fn() -> *const ort::sys::OrtApiBase;
    let get_api_base: libloading::Symbol<OrtGetApiBaseFn> = unsafe {
        lib.get(b"OrtGetApiBase\0")
            .map_err(|e| format!("dlsym(OrtGetApiBase) failed: {e}"))?
    };

    let base: *const ort::sys::OrtApiBase = unsafe { get_api_base() };
    if base.is_null() {
        return Err("OrtGetApiBase() returned NULL".to_string());
    }

    unsafe { log_runtime_version(base, dylib) };

    // SAFETY: `base` is non-null and points at a static struct inside
    // the loaded library; `walk_down_to_api`'s contract is met.
    let api_ptr = unsafe { walk_down_to_api(base)? };

    // SAFETY: `api_ptr` is a valid `*const OrtApi` returned by the
    // runtime; the underlying static struct lives as long as the
    // library remains loaded (which is forever — we never close it).
    let api_copy: ort::sys::OrtApi = unsafe { std::ptr::read(api_ptr) };
    let _ = ort::set_api(api_copy);

    // Deliberately leak the Library handle. If we drop it, dlclose
    // would unload the dylib and the OrtApi function pointers we just
    // copied would dangle.
    std::mem::forget(lib);

    Ok(())
}

// ============================================================================
// Windows loader (unchanged from previous version, refactored to share
// walk_down_to_api / log_runtime_version).
// ============================================================================

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

    let get_api_base: unsafe extern "system" fn() -> *const ort::sys::OrtApiBase =
        unsafe { std::mem::transmute(proc) };

    let base: *const ort::sys::OrtApiBase = unsafe { get_api_base() };
    if base.is_null() {
        return Err("OrtGetApiBase() returned NULL".to_string());
    }

    unsafe { log_runtime_version(base, dylib) };

    let api_ptr = unsafe { walk_down_to_api(base)? };

    let api_copy: ort::sys::OrtApi = unsafe { std::ptr::read(api_ptr) };
    let _ = ort::set_api(api_copy);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_onnx() {
        init_onnx();
        init_onnx();
    }

    /// Regression guard for the rc.12 hang. With the `set_api`
    /// workaround in place this should pass on every platform; if
    /// `init_from` ever creeps back into the load path, this test will
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
