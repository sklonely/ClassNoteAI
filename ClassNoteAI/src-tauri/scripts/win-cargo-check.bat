@echo off
setlocal EnableExtensions
REM One-shot: runs `cargo check --features candle-embed` with the same
REM MSVC + LLVM + CMake env win-tauri-build.bat uses, so local compile
REM errors surface without having to spin up the full dev server.

set "_VS_TAG="
if not defined VS_VCVARS (
    if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=18"
    )
    if not defined VS_VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
        set "VS_VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
        set "_VS_TAG=17"
    )
)
if not defined VS_VCVARS (
    echo ERROR: vcvars64.bat not found.
    exit /b 1
)
call "%VS_VCVARS%" >nul

if exist "%USERPROFILE%\llvm18\bin\libclang.dll" (
    set "LIBCLANG_PATH=%USERPROFILE%\llvm18\bin"
)

if "%_VS_TAG%"=="18" (
    set "CMAKE_GENERATOR=Visual Studio 18 2026"
) else (
    set "CMAKE_GENERATOR=Visual Studio 17 2022"
)
set "CMAKE_TOOLCHAIN_FILE=%~dp0win-toolchain.cmake"
set "PATH=%USERPROFILE%\.cargo\bin;%LIBCLANG_PATH%;%PATH%"

cd /d "%~dp0.."
cargo check --features candle-embed %*
endlocal
