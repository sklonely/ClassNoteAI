@echo off
setlocal EnableExtensions

if not defined CNAI_DEV_CDP_PORT set "CNAI_DEV_CDP_PORT=9222"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=%CNAI_DEV_CDP_PORT%"

set "CNAI_EXE=%LOCALAPPDATA%\ClassNoteAI\classnoteai.exe"

if not exist "%CNAI_EXE%" (
    echo ERROR: ClassNoteAI not found at "%CNAI_EXE%"
    exit /b 1
)

echo Launching: %CNAI_EXE%
echo CDP port:  %CNAI_DEV_CDP_PORT%
start "" "%CNAI_EXE%"
endlocal
