@echo off
REM Windows dev helper: runs `npx tauri build <args>` with full MSVC + LLVM + CMake env.
REM Overrides via env vars: VS_VCVARS, LIBCLANG_PATH, CMAKE_GENERATOR.

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

if not defined LIBCLANG_PATH (
    if exist "%USERPROFILE%\llvm18\bin\libclang.dll" (
        set "LIBCLANG_PATH=%USERPROFILE%\llvm18\bin"
    ) else if exist "C:\Program Files\LLVM\bin\libclang.dll" (
        set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
    )
)

if not defined CMAKE_GENERATOR set "CMAKE_GENERATOR=Visual Studio 17 2022"
set "CMAKE_TOOLCHAIN_FILE=%~dp0win-toolchain.cmake"
set "PATH=%USERPROFILE%\.cargo\bin;%LIBCLANG_PATH%;%PATH%"

REM Tauri's project root is src-tauri/../ (where package.json lives)
cd /d "%~dp0..\.."
call npx tauri build %*
