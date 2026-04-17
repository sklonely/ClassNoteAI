@echo off
REM Windows dev helper: wraps `cargo <args>` with MSVC + LLVM + CMake env.
REM Override any of the paths below via environment variables before running.

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

REM Add cargo, ninja (shipped with VS), and LLVM to PATH
set "PATH=%USERPROFILE%\.cargo\bin;%VS_NINJA_DIR%;%LIBCLANG_PATH%;%PATH%"

cargo %*
