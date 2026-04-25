# Parakeet (Nemotron) integration — Windows ort hang RESOLVED

**Branch**: `refactor/streaming-pipeline`
**Resolved**: 2026-04-25
**Status**: Workaround landed, lib test green, INT8/FP32 bake-off run, INT8 chosen as default.

---

## TL;DR

The "ort `Session::builder` hangs forever" symptom on Windows + load-dynamic
+ ort 2.0.0-rc.12 was **not** a System32 DLL-precedence conflict
(WinML 1.17). It was an **ORT API version mismatch**: ort 2.0.0-rc.12
asks the runtime for `ORT_API_VERSION = 24`, but the
`onnxruntime.dll` shipped with `parakeet-rs` is 1.23.0, whose API
table only goes up to 23. ort's `setup_api()` doesn't degrade
gracefully — it asserts non-null on the returned table — and on
Windows the failure path stalls before the parent process can observe
a panic, producing a silent infinite hang.

The fix: bypass `ort::init_from` entirely. Manually `LoadLibraryExW`
our DLL, call `OrtGetApiBase` and `GetApi` ourselves, walk down from
the requested version until the runtime returns a non-NULL table, then
hand that table to `ort::set_api`. From that point ort uses our
pointer for every API call and never re-enters its broken loader.

Implementation: `src-tauri/src/utils/onnx.rs`,
`init_onnx_from(dylib)`. The Tauri setup hook already calls
`utils::onnx::init_onnx()` after pinning `ORT_DYLIB_PATH`, so the
production path picks this up automatically.

---

## How the diagnosis went

The original handoff blamed System32's `onnxruntime.dll` v1.17 (the
WinML stack) shadowing our v1.23 via Windows' default DLL search order.
That theory had circumstantial backing (`sherpa-onnx#3059`,
`pykeio/ort#559`) but two diagnostic steps proved it wrong:

1. **`Get-Process | Modules` enumeration before any ort call** showed
   no onnxruntime DLL preloaded. WinML's chain isn't auto-loaded into
   a vanilla Rust process — so it can't be shadowing anything.
2. **Manually loading our DLL with `LoadLibraryExW(LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)`**
   then calling `OrtGetApiBase()` → `GetVersionString()` → `GetApi(23)`
   all returned in 0–3 ms with valid pointers and the version string
   "1.23.0". The C-level runtime is healthy.

But:

3. **`GetApi(24)`** (what ort 2.0.0-rc.12 internally requests via
   `ort_sys::ORT_API_VERSION`) prints to stderr:
   > `The requested API version [24] is not available, only API versions [1, 23] are supported in this build. Current ORT Version is: 1.23.0`
   …and returns NULL.

4. ort's `setup_api()` then does
   `ApiPointer(NonNull::new(api.cast_mut()).expect("Failed to initialize ORT API"))`,
   which on Windows under cargo's release profile manifests as a
   silent hang rather than a panic (the buffered stderr + unwind +
   parent-pipe interaction never delivers the panic message before the
   process is killed by `timeout`). That's why every previous attempt
   thought the hang was inside `libloading::Library::new` — it isn't,
   it's two function calls later.

`AddDllDirectory` + `SetDefaultDllDirectories` are still in the fix
because they're cheap belt-and-suspenders for the legitimate-but-not-
load-bearing System32-ordering concern. They don't affect the API-
version path.

---

## Bake-off results (2026-04-25, this machine)

`cargo run --release --example nemotron_eval -- C:/Users/.../parakeet_test/1.wav`
on a 16.72 s LibriSpeech "Scarlet Letter" excerpt (16 kHz mono):

| metric             | INT8       | FP32       |
|--------------------|------------|------------|
| load (cold)        | 1545 ms    | 3377 ms    |
| RTF                | **10.61×** | 2.05×      |
| first delta wall   | **0.10 s** | 0.55 s     |
| per-chunk p95      | **56 ms**  | 316 ms     |
| per-chunk max      | **107 ms** | 621 ms     |
| transcript chars   | 252        | 249        |
| disk footprint     | **852 MB** | 2.51 GB    |

Transcripts are essentially identical — only differences are American
vs British spelling ("dishonored"/"dishonoured") and that FP32 omits
a few commas. **INT8 ships as default**; FP32 stays available as an
opt-in for users who want maximum accuracy or who plan to fine-tune.

`Variant::all()` already returns `[Int8, Fp32]`, and the setup hook's
auto-load uses `first_present()` which iterates in that order — no
code change needed to make INT8 the default.

---

## What's now in the tree

| File                                         | Why                                                                              |
|----------------------------------------------|----------------------------------------------------------------------------------|
| `src-tauri/src/utils/onnx.rs`                | `init_onnx_from` workaround + lib regression test (no longer `#[ignore]`)        |
| `src-tauri/Cargo.toml`                       | adds `windows-sys` (Win32 LibraryLoader / ProcessStatus) on `cfg(windows)`       |
| `src-tauri/examples/ort_minimal.rs`          | smoke test — init + `Session::builder` + `commit_from_file` on real model        |
| `src-tauri/examples/nemotron_eval.rs`        | bake-off harness; switched from `ort::init().commit()` → `init_onnx()`           |
| `src-tauri/examples/ort_smoke.rs` (deleted)  | superseded by `ort_minimal.rs` once the bug was understood                       |
| `src-tauri/examples/loadlib_test.rs` (deleted) | one-shot LoadLibraryEx flag-matrix probe; served its purpose                   |

The Tauri setup hook in `lib.rs` was already calling
`utils::onnx::init_onnx()` after setting `ORT_DYLIB_PATH`, so the
production app inherits the fix automatically.

---

## When this might bite again

- **Bumping ort to a newer rc / 2.0 stable**: the workaround walks
  down from `ort_sys::ORT_API_VERSION`, so it's resilient to ort
  asking for API 25/26/etc. as long as the bundled DLL still exposes
  one of the versions we walk through.
- **Bumping the bundled `onnxruntime.dll` to 1.24+**: at that point
  the version mismatch goes away and `ort::init_from` may start working
  again. The workaround stays correct (set_api wins the OnceLock race
  before anything else), but if you want to switch back to the
  upstream loader, drop `windows_load_and_set_api` and just call
  `ort::init_from(path)`. Run `examples/ort_minimal` to verify.
- **parakeet-rs publishing a new release with a different bundled
  ONNX runtime**: same as above — re-run `ort_minimal` to confirm
  the API-version negotiation lands somewhere sensible.

---

## References

- pykeio/ort #559 (originally suspected, mostly unrelated):
  https://github.com/pykeio/ort/issues/559
- k2-fsa/sherpa-onnx #3059 (System32 DLL conflict, similar symptom on
  a different cause): https://github.com/k2-fsa/sherpa-onnx/issues/3059
- ort 2.0.0-rc.12 source —
  `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ort-2.0.0-rc.12/src/lib.rs:92-140` (`load_dylib_from_path`) and lines 180-212 (`setup_api`).
- parakeet-rs streaming example:
  https://github.com/altunenes/parakeet-rs/blob/main/examples/streaming.rs
