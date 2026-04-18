@echo off
REM Windows dev helper: runs `npx tauri dev` with full MSVC + LLVM + CMake env.
REM Mirrors win-tauri-build.bat. Not committed to v0.5.1 — created for local
REM bug-investigation on the v0.5.1 tag.

if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
    ) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    ) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
    ) else (
        echo ERROR: vcvars64.bat not found. Set VS_VCVARS env var.
        exit /b 1
    )
)
call "%VS_VCVARS%" >nul

if exist "%USERPROFILE%\llvm18\bin\libclang.dll" (
    set "LIBCLANG_PATH=%USERPROFILE%\llvm18\bin"
) else if not defined LIBCLANG_PATH (
    if exist "C:\Program Files\LLVM\bin\libclang.dll" (
        set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
    )
)

if not defined CMAKE_GENERATOR (
    echo %VS_VCVARS% | findstr /C:"\\18\\" >nul && set "CMAKE_GENERATOR=Visual Studio 18 2026"
    if not defined CMAKE_GENERATOR echo %VS_VCVARS% | findstr /C:"\\2022\\" >nul && set "CMAKE_GENERATOR=Visual Studio 17 2022"
    if not defined CMAKE_GENERATOR set "CMAKE_GENERATOR=Visual Studio 17 2022"
)
set "CMAKE_TOOLCHAIN_FILE=%~dp0win-toolchain.cmake"
set "PATH=%USERPROFILE%\.cargo\bin;%LIBCLANG_PATH%;%PATH%"

REM Expose WebView2 as a Chrome DevTools Protocol target on :9222 so the
REM scripts/dev-ctl.mjs helper (and any other CDP tool) can drive the dev
REM window remotely. Set CNAI_DEV_CDP_PORT to override or empty to disable.
if not defined CNAI_DEV_CDP_PORT set "CNAI_DEV_CDP_PORT=9222"
if not "%CNAI_DEV_CDP_PORT%"=="" (
    set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=%CNAI_DEV_CDP_PORT%"
)

cd /d "%~dp0..\.."
call npx tauri dev %*
