# llama.cpp Sidecar Release Smoke

Release builds must include a runnable `llama-server` sidecar:

- Windows CPU installer bundles the official `win-cpu-x64` llama.cpp build.
- Windows CUDA installer bundles the official `win-cuda-12.4-x64` build plus the matching cudart package.
- macOS Apple Silicon bundles the official `macos-arm64` llama.cpp build.

Quick binary smoke, no model required:

```powershell
powershell -ExecutionPolicy Bypass -File ClassNoteAI/src-tauri/scripts/smoke-llama-sidecar.ps1 `
  -BinaryDir ClassNoteAI/src-tauri/resources/binaries
```

Full local sidecar smoke with a downloaded TranslateGemma GGUF:

```powershell
powershell -ExecutionPolicy Bypass -File ClassNoteAI/src-tauri/scripts/smoke-llama-sidecar.ps1 `
  -BinaryDir ClassNoteAI/src-tauri/resources/binaries `
  -ModelPath "$env:APPDATA\com.classnoteai\models\llm\translategemma-4b_Q4_K_M.gguf"
```

For the CUDA installer, add `-ExpectCuda` and confirm the sidecar log mentions CUDA backend loading.
