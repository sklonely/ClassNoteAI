@echo off
rem Windows dev-time helper for `cargo ... --features gpu-cuda` builds.
rem
rem Provisions the proven-working toolchain combination in one shot:
rem   - Visual Studio 2022 Build Tools (MSVC 14.4x via `vcvars64.bat`)
rem   - CMake 3.31.9 portable, pinned on PATH ahead of the system cmake
rem   - Ninja generator (skips CMake's VS-generator-name detection)
rem   - CUDA_PATH rewritten with FORWARD slashes so FindCUDA.cmake's
rem     string interpolation doesn't trip on `\P` / `\N` / `\C` escapes
rem
rem Why these hard-coded paths: nested for-loops and subroutine calls
rem with quoted args containing "Program Files (x86)" break cmd.exe's
rem parser in non-obvious ways ("\Microsoft was unexpected at this
rem time"). The flat, hard-coded form works every time. If your install
rem is elsewhere, set these env vars before calling this script and
rem it'll use your overrides instead:
rem
rem   set VCVARS_OVERRIDE=C:\path\to\vcvars64.bat
rem   set CMAKE_31_DIR=D:\other\cmake-3.31
rem   set CUDA_PATH_FWD=C:/my/CUDA/install      (forward slashes!)
rem
rem Usage (from a plain cmd.exe — NOT Git Bash):
rem
rem     call src-tauri\scripts\gpu-dev-env-windows.bat
rem     npx tauri dev --features gpu-cuda

if not defined VCVARS_OVERRIDE set "VCVARS_OVERRIDE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not defined CMAKE_31_DIR set "CMAKE_31_DIR=D:\tools\cmake31\cmake-3.31.9-windows-x86_64"
if not defined CUDA_PATH_FWD set "CUDA_PATH_FWD=C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v13.2"

rem NOTE: error branches use GOTO labels rather than `(...)` blocks.
rem Inside a block, cmd expands `%VCVARS_OVERRIDE%` at parse time, and
rem the `(x86)` substring's literal `)` closes the block prematurely —
rem error surfaces as "\Microsoft was unexpected at this time." Labels
rem sidestep the issue because the echo runs in top-level context.
if not exist "%VCVARS_OVERRIDE%" goto :no_vcvars
if not exist "%CMAKE_31_DIR%\bin\cmake.exe" goto :no_cmake31

call "%VCVARS_OVERRIDE%" >nul 2>&1
goto :after_vcvars

:no_vcvars
echo [gpu-dev-env] ERROR: vcvars64.bat not found at: %VCVARS_OVERRIDE%
echo Install VS 2022 Build Tools + "Desktop development with C++":
echo   https://aka.ms/vs/17/release/vs_BuildTools.exe
echo Or set VCVARS_OVERRIDE to your install's vcvars64.bat path.
exit /b 1

:no_cmake31
echo [gpu-dev-env] ERROR: CMake 3.31 not found at %CMAKE_31_DIR%
echo Download cmake-3.31.9-windows-x86_64.zip from
echo https://github.com/Kitware/CMake/releases/download/v3.31.9/cmake-3.31.9-windows-x86_64.zip
echo extract to D:\tools\cmake31\ or set CMAKE_31_DIR.
exit /b 1

:after_vcvars

set "PATH=%CMAKE_31_DIR%\bin;%PATH%"
set "CMAKE_GENERATOR=Ninja"
set "CUDA_PATH=%CUDA_PATH_FWD%"
set "CUDA_BIN_PATH=%CUDA_PATH%/bin"
set "CUDA_TOOLKIT_ROOT_DIR=%CUDA_PATH%"
set "CUDAToolkit_ROOT=%CUDA_PATH%"

rem CUDA 13 dropped support for compute_5x (Maxwell/Tegra). CTranslate2's
rem default "Common" arch list includes compute_53 and fails with
rem "nvcc fatal: Unsupported gpu architecture 'compute_53'". Override
rem with a modern-consumer-card list so nvcc is happy. Dev machine
rem target is RTX 4060 Ti (8.9); extras cover RTX 20/30 series so the
rem same env works on teammates' boxes.
if not defined CUDA_ARCH_LIST set "CUDA_ARCH_LIST=7.5;8.0;8.6;8.9"

echo [gpu-dev-env] vcvars : %VCVARS_OVERRIDE%
echo [gpu-dev-env] CMake  : %CMAKE_31_DIR%\bin
echo [gpu-dev-env] CUDA   : %CUDA_PATH%
echo [gpu-dev-env] Gen    : %CMAKE_GENERATOR%
echo [gpu-dev-env] Ready. Run: npx tauri dev --features gpu-cuda
