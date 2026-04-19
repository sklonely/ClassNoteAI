@echo off
setlocal EnableExtensions

REM Dev launcher with CUDA backend enabled. Same as win-tauri-dev.bat
REM plus:
REM   - CUDA_PATH / PATH pointing at the CUDA 13 Toolkit install
REM   - NVCC visible so whisper-rs-sys + candle + ct2rs can compile CUDA kernels
REM   - --features gpu-cuda handed to npx tauri dev
REM
REM First build after switching to this script is slow (~30-40 min) because
REM the native CUDA kernels get built; subsequent rebuilds are fast thanks
REM to sccache / Rust's incremental.

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

REM --- CUDA environment ---------------------------------------------------
REM v13.2 installed via winget. DLLs live under bin\x64\ (not bin\) starting
REM with CUDA 13. Avoid `if ( ... )` blocks here — setting a variable inside
REM a paren block and reading it with %CUDA_PATH% in the same block hits
REM CMD's delayed-expansion trap (prints empty).
REM
REM Crucial: CUDA_PATH uses FORWARD slashes. CMake 4.x's deprecated
REM FindCUDA module (invoked from whisper.cpp's CMakeLists) fails to
REM parse paths that contain `\P` (from `C:\Program Files`) as an
REM escape sequence. Forward slashes dodge the issue entirely — CMake
REM on Windows happily accepts `C:/Program Files/...`, and every
REM downstream build step that cares (nvcc, the linker, cargo) also
REM takes them.
if not exist "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin\nvcc.exe" goto :no_cuda
set "CUDA_PATH=C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v13.2"
set "CUDA_HOME=%CUDA_PATH%"
set "CUDA_TOOLKIT_ROOT_DIR=%CUDA_PATH%"
REM PATH still uses backslashes — Windows shell resolves both, but native
REM tools (nvcc.exe location lookup) expect system conventions here.
set "PATH=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin;C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin\x64;%PATH%"
set "INCLUDE=%CUDA_PATH%/include;%INCLUDE%"
set "LIB=%CUDA_PATH%/lib/x64;%LIB%"
REM CUDA 13 dropped support for compute capabilities < 7.5 (Maxwell,
REM Pascal, Volta). Both whisper.cpp and ct2rs's bundled CMakeLists
REM hardcode arch lists that include compute_53/60/70; nvcc 13.x
REM rejects those as "Unsupported gpu architecture". Override via
REM CMAKE_CUDA_ARCHITECTURES (picked up by every cmake-based build)
REM + CT2_CUDA_ARCH_LIST (ct2rs-specific fallback). Covers the full
REM consumer GPU range shipped since 2018: Turing / Ampere / Ada /
REM Hopper / Blackwell.
set "CMAKE_CUDA_ARCHITECTURES=75;80;86;89;90;100"
set "CT2_CUDA_ARCH_LIST=Turing;Ampere;Ada;Hopper;Blackwell"
set "GGML_CUDA_ARCHITECTURES=75;80;86;89;90;100"
REM VS 18 (2026) isn't on CUDA 13's official-supported-compiler list —
REM CUDA Toolkit's `CUDA 13.2.props` reads CudaToolkitDir from
REM MSBuild properties (NOT CUDA_PATH), and nvcc rejects MSVC 14.50
REM without explicit override. Two workarounds combined per NVIDIA's
REM community guide (gist JoanTerra/ffe18eb5d5752e0f4df7d85c8e61f6b6):
REM   - set CudaToolkitDir so MSBuild can find it
REM   - pass -allow-unsupported-compiler via CMAKE_CUDA_FLAGS so nvcc
REM     skips its host-compiler version check
REM Trailing backslash is required by the props file's HasTrailingSlash
REM guard.
set "CudaToolkitDir=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2\"
set "CMAKE_CUDA_FLAGS=-allow-unsupported-compiler"
set "CMAKE_CUDA_HOST_COMPILER_FLAGS=-allow-unsupported-compiler"
echo Using CUDA at %CUDA_PATH%
goto :cuda_ok
:no_cuda
echo ERROR: CUDA 13.2 not found. Run "winget install Nvidia.CUDA" first.
exit /b 1
:cuda_ok

set "PATH=%USERPROFILE%\.cargo\bin;%LIBCLANG_PATH%;%PATH%"

cd /d "%~dp0.."
npx tauri dev --features gpu-cuda %*
endlocal
