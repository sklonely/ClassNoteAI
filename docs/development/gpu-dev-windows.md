# Local GPU dev build on Windows

**TL;DR**: Getting `cargo ... --features gpu-cuda` to work locally on a
modern Windows dev box (VS 2026 + CUDA 13 + current CMake) requires
pinning a very specific stack. If you just want to **verify** Phase 2+
GPU acceleration, the release CI `cuda` variant is the low-friction
path. If you want to **develop against GPU locally** (iteration loop
without publishing release tags), use the
`src-tauri/scripts/gpu-dev-env-windows.bat` helper and read this
document.

## Why this is painful

The GPU pipeline (Whisper + M2M100 translation) depends on two C++
libraries pulled in via Rust crates:

| Crate | Role | CUDA via |
|---|---|---|
| `whisper-rs` | ASR | `whisper.cpp` GGML CUDA backend |
| `ct2rs` | Translation | `CTranslate2` C++ library with CUDA kernels |

Both go through CMake at build time. `ct2rs 0.9.13`'s `CMakeLists.txt`
(at `vendor/ct2rs/CTranslate2/`) still uses the legacy
`find_package(CUDA)` API, which means it relies on the
`FindCUDA.cmake` module. That module was:

- **deprecated in CMake 3.10** (circa 2017)
- **removed entirely in CMake 4.0** (policy CMP0146)
- has a **longstanding bug parsing Windows paths containing spaces
  and backslashes** — `C:\Program Files\NVIDIA...` trips the CMake
  string escape parser on `\P` / `\N` / `\C`

Meanwhile Windows dev boxes in 2026 tend to have:

- Visual Studio 2026 (version 18) as the default MSVC toolchain
- CMake 4.x from various package managers (WinGet's WinLibs MinGW
  bundle ships a stale 4.2 with a broken FindCUDA)
- CUDA Toolkit 13.x

Each of those newer pieces breaks one or more of `ct2rs`'s assumptions.

## The workaround stack

Six things have to be set up exactly right at the same time:

1. **A pinned portable CMake 3.31.9**. Last stable 3.x release; has
   FindCUDA; accepts the CMake policy version scheme `ct2rs` uses. Not
   on a package manager — download manually from
   <https://github.com/Kitware/CMake/releases/download/v3.31.9/cmake-3.31.9-windows-x86_64.zip>
   and extract to `D:\tools\cmake31\`.
2. **Visual Studio 2026 MSVC toolchain activated** via
   `vcvars64.bat`. `cl.exe` has to be on PATH before cargo launches,
   otherwise Ninja won't find the host compiler.
3. **`CMAKE_GENERATOR=Ninja`**. CMake 3.31 doesn't recognise the
   `Visual Studio 18 2026` generator name that `cmake-rs` auto-picks,
   and pinning it to `Visual Studio 17 2022` requires having VS 2022
   also installed.
4. **`CUDA_PATH` with forward slashes**. Substitute `/` for `\` in the
   toolkit path so FindCUDA's string interpolation doesn't crash on
   `Invalid character escape '\P'` etc.
5. **Clean CMake build caches** between runs where the generator
   changes. `target/debug/build/{ct2rs,sentencepiece-sys,whisper-rs-sys}-*`
   need to be cleared or CMake refuses with
   `generator does not match`.
6. **No lingering build processes**. `cargo.exe`, `cmake.exe`,
   `ninja.exe`, `cl.exe`, `nvcc.exe`, `link.exe` all need to exit
   between runs — otherwise they hold `.ninja_deps` files and the
   rm step in (5) fails.

## Using the helper

`src-tauri/scripts/gpu-dev-env-windows.bat` runs steps 1–4 in a cmd.exe
shell and leaves you in an environment where `npx tauri dev --features
gpu-cuda` just works. Steps 5–6 are manual cleanup when things go wrong.

From a **plain `cmd.exe`** (NOT Git Bash or MSYS — the nested quoting
around `vcvars64.bat` breaks in bash subshells):

```bat
call src-tauri\scripts\gpu-dev-env-windows.bat
npx tauri dev --features gpu-cuda
```

First build takes **20–40 minutes** (CUDA kernel compilation is single-
threaded inside nvcc even with `-j`). After that, sccache caches
incremental rebuilds in seconds.

When it works you'll see in the app's stderr:

```
[CT2] CUDA detected (NVIDIA GeForce RTX 4060 Ti), using Device::CUDA
[Whisper] ...GPU init...
[ORT] ORT_DYLIB_PATH set to bundled "...\onnxruntime.dll"
[VAD] Silero v5 initialised from bundle
```

## If it still fails

The underlying ct2rs + CUDA 13 + VS 2026 combination has surfaced
opaque compile errors in `target/debug/build/ct2rs-*/out/build/`.
Typical symptoms:

- `FAILED: ...` buried in the 700+ line ninja parallel output
- `nvcc fatal` on a specific kernel source
- unresolved `<type_traits>` or C++20 feature mismatches between
  MSVC 14.50 and CUDA 13.x host-compiler expectations

We don't currently have fixes for those — they're either:
- upstream `ct2rs` / `CTranslate2` compatibility gaps (waiting on a
  new CTranslate2 release that officially supports CUDA 13)
- or an MSVC version skew (would need VS 2022 17.x installed as a
  side-by-side toolchain)

**In those cases, switch to the release CI path** (see below).

## Alternative: the release CI `cuda` variant

GitHub Actions `windows-latest` runners have a pre-installed stack
that *does* work (VS 17 2022 + CMake 3.31 + CUDA 12.x + correct env
vars). The release workflow (`.github/workflows/release-windows.yml`)
builds a `-cuda-setup.exe` installer on every tag or manual dispatch.

To verify Phase 2+ GPU acceleration without touching your local
toolchain:

1. Push a tag or dispatch `release-windows.yml` with a prerelease
   version name (e.g. `v0.6.0-alpha.11`).
2. Wait ~20 min for the `cuda` matrix entry to finish.
3. Download the `ClassNoteAI-<version>-cuda-setup.exe` artifact.
4. Install locally. This bundles all of
   - `onnxruntime.dll` (for Silero VAD)
   - `cudart64_12.dll`, `cublas*.dll`, `cublasLt*.dll`
     (for CTranslate2 + whisper.cpp CUDA backends)

Launching the installed app will log the same `[CT2] CUDA detected`
line the local build would, with no tooling configuration on your side.

## When to fix this upstream

The right long-term fix is to upgrade `ct2rs` to a version that uses
the modern `find_package(CUDAToolkit)` CMake API (available since
CMake 3.17, and not affected by the FindCUDA removal or the `\P`
escape bug). That unblocks CMake 4.x and VS 2026. As of writing
(2026-04-24), `ct2rs` hasn't cut such a release.

If we end up forking `ct2rs` for other reasons, the `CUDAToolkit`
migration is the time to do it. Track the ct2rs / CTranslate2
release channels quarterly.
