@echo off
setlocal EnableExtensions

REM Windows dev helper: runs npx tauri dev with MSVC + LLVM + CMake env
REM plus WebView2 CDP on :9222 for scripts/dev-ctl.mjs.

if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
    echo ERROR: vcvars64.bat not found. Set VS_VCVARS env var to its full path.
    exit /b 1
)

call "%VS_VCVARS%" >nul

REM libclang: pin to llvm18 unconditionally if present; newer libclang
REM breaks whisper-rs-sys bindgen with an opaque whisper_full_params.
if exist "%USERPROFILE%\llvm18\bin\libclang.dll" set "LIBCLANG_PATH=%USERPROFILE%\llvm18\bin"
if not defined LIBCLANG_PATH (
    if exist "C:\Program Files\LLVM\bin\libclang.dll" set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
)

REM CMake generator based on which VS was picked above.
if not defined CMAKE_GENERATOR (
    set "CMAKE_GENERATOR=Visual Studio 17 2022"
    echo "%VS_VCVARS%" | findstr /C:"\\18\\" >nul && set "CMAKE_GENERATOR=Visual Studio 18 2026"
)
set "CMAKE_TOOLCHAIN_FILE=%~dp0win-toolchain.cmake"

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
if defined LIBCLANG_PATH set "PATH=%LIBCLANG_PATH%;%PATH%"

if not defined CNAI_DEV_CDP_PORT set "CNAI_DEV_CDP_PORT=9222"
if not "%CNAI_DEV_CDP_PORT%"=="" set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=%CNAI_DEV_CDP_PORT%"

cd /d "%~dp0..\.."
call npx tauri dev %*
endlocal
