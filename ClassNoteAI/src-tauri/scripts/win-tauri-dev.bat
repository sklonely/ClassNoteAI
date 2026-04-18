@echo off
setlocal EnableExtensions
REM Windows dev helper: runs `npx tauri dev` with full MSVC + LLVM + CMake env
REM plus WebView2 CDP exposed on :9222 for scripts/dev-ctl.mjs.
REM
REM Rewrite rationale (2026-04-18): the previous version hit
REM "The input line is too long" on machines whose system PATH had grown
REM past ~6 KB. Root cause was a combination of:
REM   (1) `echo %VAR% | findstr ...` constructs inside `if` blocks, which
REM       cmd.exe parses unreliably when %VAR% contains spaces;
REM   (2) an unscoped `set "PATH=...prepend...%PATH%"` that stacked on top
REM       of `vcvars64.bat`'s already-massive PATH additions, pushing the
REM       exported-to-child-process command line past the 8191-char limit.
REM This version uses `setlocal` so changes are scoped to the batch
REM invocation only, replaces pipe-in-if with plain `if exist` chains,
REM and only prepends to PATH when the path isn't already there.

REM ---- Locate vcvars64.bat -------------------------------------------------
REM Ordered: VS 18 (2026 preview) first since that's the current dev
REM machine, then VS 2022 fallbacks. Each probe sets both VS_VCVARS and
REM _VS_TAG so the CMake generator pick below doesn't have to re-parse
REM the path string (which was the old pipe-in-if bug).
set "_VS_TAG="
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=18"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=18"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=18"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=18"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=17"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=17"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=17"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=17"
    )
    if not defined VS_VCVARS (
        echo ERROR: vcvars64.bat not found. Set VS_VCVARS env var to its full path.
        exit /b 1
    )
)
call "%VS_VCVARS%" >nul

REM ---- Locate libclang ------------------------------------------------------
REM llvm18 wins unconditionally if present. Any externally-set
REM LIBCLANG_PATH (e.g. pointing at scoop's LLVM 22) is deliberately
REM overridden -- newer libclang produces a different bindgen translation
REM for whisper.cpp's function-pointer-laden `whisper_full_params`
REM (emits opaque `_address` instead of real fields), which makes
REM `whisper-rs-sys 0.9.0` / `whisper-rs 0.11.1` fail to compile with
REM "no field `progress_callback_user_data` on type `whisper_full_params`".
REM Keeping this override pinned to libclang 18 is the one thing that
REM guarantees a clean cargo build in this project.
if exist "%USERPROFILE%\llvm18\bin\libclang.dll" (
    set "LIBCLANG_PATH=%USERPROFILE%\llvm18\bin"
) else if not defined LIBCLANG_PATH (
    if exist "C:\Program Files\LLVM\bin\libclang.dll" (
        set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
    )
)

REM ---- CMake generator ------------------------------------------------------
REM Pick based on _VS_TAG set above -- no path-string reparse, no pipe-in-if.
if not defined CMAKE_GENERATOR (
    if "%_VS_TAG%"=="18" (
        set "CMAKE_GENERATOR=Visual Studio 18 2026"
    ) else (
        set "CMAKE_GENERATOR=Visual Studio 17 2022"
    )
)
set "CMAKE_TOOLCHAIN_FILE=%~dp0win-toolchain.cmake"

REM ---- PATH prepend ---------------------------------------------------------
REM `setlocal` above already scopes all env mutations to this single
REM invocation, so the old cross-run stacking problem is already solved --
REM no dedup gymnastics needed. Plain prepend here adds ~70 chars onto
REM vcvars's ~4.6 KB PATH, which is well under the 8191-char limit that
REM bit us originally (that was a different codepath -- pipe-in-if parsing,
REM not PATH size per se).
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
if defined LIBCLANG_PATH set "PATH=%LIBCLANG_PATH%;%PATH%"

REM ---- WebView2 CDP for scripts/dev-ctl.mjs --------------------------------
if not defined CNAI_DEV_CDP_PORT set "CNAI_DEV_CDP_PORT=9222"
if not "%CNAI_DEV_CDP_PORT%"=="" (
    set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=%CNAI_DEV_CDP_PORT%"
)

cd /d "%~dp0..\.."
call npx tauri dev %*
endlocal
