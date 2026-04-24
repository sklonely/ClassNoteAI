@echo off
rem Windows dev-time helper for `cargo ... --features gpu-cuda` builds.
rem
rem Works around a specific chain of tooling mismatches that block local
rem GPU builds on recent Windows developer machines. See
rem `docs/development/gpu-dev-windows.md` for the full narrative.
rem
rem Short version:
rem   1. Activates Visual Studio 2026 (VS 18) MSVC toolchain via
rem      `vcvars64.bat` so `cl.exe` is on PATH.
rem   2. Puts a pinned CMake 3.31 on PATH before the system CMake. CMake
rem      4.x removed the legacy `FindCUDA` module that `ct2rs 0.9.13`
rem      still calls via `find_package(CUDA)`.
rem   3. Forces the `Ninja` CMake generator. CMake 3.31 doesn't know
rem      about `Visual Studio 18 2026`, which is what `cmake-rs` picks
rem      by default when rustc targets MSVC 14.50+.
rem   4. Re-exports `CUDA_PATH` (and the three derived vars) with
rem      FORWARD slashes. `FindCUDA.cmake` interpolates `$ENV{CUDA_PATH}`
rem      literally into a semicolon-delimited list passed through CMake's
rem      string parser, which trips on `\P` / `\N` / `\C` as invalid
rem      escape sequences when the path contains `\Program Files\NVIDIA...`.
rem
rem Usage:
rem   1. Edit the CUDA_VERSION / VS_EDITION constants if your install
rem      differs from this default.
rem   2. Optionally set CMAKE_31_DIR if your portable CMake lives
rem      somewhere other than D:\tools\cmake31\.
rem   3. Run from a plain cmd.exe or double-click. Do NOT wrap in Git
rem      Bash / MSYS — the vcvars64.bat quoting breaks in nested shells.
rem
rem After this script exits you have a fully-provisioned GPU dev shell —
rem run your cargo / tauri commands directly:
rem
rem     npx tauri dev --features gpu-cuda
rem     cargo build --release --features gpu-cuda
rem
rem On first build, `cmake` will pre-clear `target/debug/build/{ct2rs,
rem sentencepiece-sys,whisper-rs-sys}-*` caches before recompiling.
rem If you hit "generator does not match" errors, delete those dirs and
rem retry.

set "VS_EDITION=Community"
set "CUDA_VERSION=v13.2"
if not defined CMAKE_31_DIR set "CMAKE_31_DIR=D:\tools\cmake31\cmake-3.31.9-windows-x86_64"

rem --- Step 1: MSVC toolchain --------------------------------------
call "C:\Program Files\Microsoft Visual Studio\18\%VS_EDITION%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
    echo [gpu-dev-env] ERROR: vcvars64.bat failed. Check VS_EDITION.
    exit /b 1
)

rem --- Step 2: CMake 3.31 first on PATH -----------------------------
if not exist "%CMAKE_31_DIR%\bin\cmake.exe" (
    echo [gpu-dev-env] ERROR: CMake 3.31 not found at %CMAKE_31_DIR%
    echo Download cmake-3.31.9-windows-x86_64.zip from
    echo https://github.com/Kitware/CMake/releases/download/v3.31.9/cmake-3.31.9-windows-x86_64.zip
    echo extract to D:\tools\cmake31\ and retry.
    exit /b 1
)
set "PATH=%CMAKE_31_DIR%\bin;%PATH%"

rem --- Step 3: Force Ninja generator --------------------------------
set "CMAKE_GENERATOR=Ninja"

rem --- Step 4: CUDA_PATH with forward slashes -----------------------
rem Normalise the standard NVIDIA install path. If your CUDA Toolkit
rem lives elsewhere, override CUDA_PATH_FWD in the environment before
rem invoking this script.
if not defined CUDA_PATH_FWD set "CUDA_PATH_FWD=C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/%CUDA_VERSION%"
set "CUDA_PATH=%CUDA_PATH_FWD%"
set "CUDA_BIN_PATH=%CUDA_PATH%/bin"
set "CUDA_TOOLKIT_ROOT_DIR=%CUDA_PATH%"
set "CUDAToolkit_ROOT=%CUDA_PATH%"

echo [gpu-dev-env] MSVC   : %VCINSTALLDIR%
echo [gpu-dev-env] CMake  : %CMAKE_31_DIR%\bin
echo [gpu-dev-env] CUDA   : %CUDA_PATH%
echo [gpu-dev-env] Gen    : %CMAKE_GENERATOR%
echo [gpu-dev-env] Ready. Run: npx tauri dev --features gpu-cuda
