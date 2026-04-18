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
if not defined VS_VCVARS (
    set "VS_VCVARS="
    if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    )
    if not defined VS_VCVARS (
        echo ERROR: vcvars64.bat not found. Set VS_VCVARS env var to its full path.
        exit /b 1
    )
)
call "%VS_VCVARS%" >nul

REM ---- Locate libclang ------------------------------------------------------
if not defined LIBCLANG_PATH (
    if exist "%USERPROFILE%\llvm18\bin\libclang.dll" (
        set "LIBCLANG_PATH=%USERPROFILE%\llvm18\bin"
    ) else if exist "C:\Program Files\LLVM\bin\libclang.dll" (
        set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
    )
)

REM ---- CMake generator ------------------------------------------------------
REM vcvars64.bat from VS 2022 sets VisualStudioVersion=17.0; we trust that
REM rather than parsing the vcvars path string, which was the source of the
REM pipe-in-if parsing trouble before.
if not defined CMAKE_GENERATOR (
    set "CMAKE_GENERATOR=Visual Studio 17 2022"
)
set "CMAKE_TOOLCHAIN_FILE=%~dp0win-toolchain.cmake"

REM ---- PATH, only prepending what's NOT already present --------------------
REM The prior form `set "PATH=...cargo;llvm;%PATH%"` stacked onto vcvars's
REM already-inflated PATH every run and risked overflowing the 8191-char
REM limit used by CreateProcess when launching npx. Now we check before we
REM prepend.
set "_CARGO_BIN=%USERPROFILE%\.cargo\bin"
echo ;%PATH%; | find /i ";%_CARGO_BIN%;" >nul
if errorlevel 1 set "PATH=%_CARGO_BIN%;%PATH%"

if defined LIBCLANG_PATH (
    echo ;%PATH%; | find /i ";%LIBCLANG_PATH%;" >nul
    if errorlevel 1 set "PATH=%LIBCLANG_PATH%;%PATH%"
)

REM ---- WebView2 CDP for scripts/dev-ctl.mjs --------------------------------
if not defined CNAI_DEV_CDP_PORT set "CNAI_DEV_CDP_PORT=9222"
if not "%CNAI_DEV_CDP_PORT%"=="" (
    set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=%CNAI_DEV_CDP_PORT%"
)

cd /d "%~dp0..\.."
call npx tauri dev %*
endlocal
