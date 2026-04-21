# Contributing to ClassNote AI

Prerequisites and build instructions for contributors. End-user documentation is in [`ClassNoteAI/README.md`](ClassNoteAI/README.md).

## Tech stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Vite
- **App shell**: Tauri v2 (Rust)
- **ASR**: whisper.cpp via `whisper-rs`
- **Rough MT**: Opus-MT (en→zh) via `ct2rs` (CTranslate2)
- **Embeddings**: Candle (`nomic-embed-text-v1`)
- **Storage**: SQLite (`rusqlite`, bundled)
- **LLM**: GitHub Models / OpenAI Platform / Anthropic / Google Gemini / ChatGPT Codex OAuth (client-side, through `src/services/llm/`)

## Prerequisites

### Both platforms

- Node.js 20+
- Rust stable (install via [rustup](https://rustup.rs))
- CMake 3.15+
- Git

### macOS

- Xcode Command Line Tools (`xcode-select --install`)
- Apple Silicon or Intel Mac on macOS 11+

### Windows

- Visual Studio 2022 or 2026 with **Desktop development with C++** workload (needs MSVC + Windows SDK)
- **LLVM 18** (newer is incompatible with the bindgen version used by `whisper-rs-sys` — see `src-tauri/scripts/winbuild.bat` for the version check)
- Git Bash (ships with Git for Windows)

## Build

```bash
# Clone
git clone https://github.com/sklonely/ClassNoteAI.git
cd ClassNoteAI/ClassNoteAI

# Hydrate vendored Windows-patch crates (no-op on macOS but required for cargo to resolve [patch.crates-io])
bash src-tauri/scripts/bootstrap-vendor.sh

# Frontend deps
npm ci

# Dev run
npm run tauri dev
```

On **Windows**, instead of `npm run tauri dev`, use the vcvars-wrapped batch:

```bat
src-tauri\scripts\win-tauri-build.bat
```

The wrapper auto-detects VS 2026 / VS 2022 / VS Build Tools. Override via env vars:

- `VS_VCVARS` — path to `vcvars64.bat`
- `LIBCLANG_PATH` — directory containing `libclang.dll` (LLVM 18)
- `CMAKE_GENERATOR` — CMake Visual Studio generator string

## Release build

```bash
# macOS
npm run tauri build

# Windows
src-tauri\scripts\win-tauri-build.bat
```

Output:

- `src-tauri/target/release/bundle/dmg/*.dmg` (macOS)
- `src-tauri/target/release/bundle/macos/*.app.tar.gz` (macOS, for updater)
- `src-tauri/target/release/bundle/msi/*.msi` (Windows, MSI)
- `src-tauri/target/release/bundle/nsis/*-setup.exe` (Windows, NSIS)

## Project layout

```
ClassNoteAI/
├── src/                       # React frontend
│   ├── components/            # UI
│   └── services/              # Client-side logic
│       ├── llm/               # LLMProvider abstraction + providers
│       ├── embeddingService.ts    # Candle wrapper
│       ├── embeddingStorageService.ts  # SQLite-backed RAG store
│       ├── ragService.ts      # Chunk + index + retrieve
│       └── transcriptionService.ts  # Streaming ASR + batching
├── src-tauri/                 # Tauri Rust backend
│   ├── src/
│   │   ├── whisper/           # ASR (whisper-rs + model downloads)
│   │   ├── translation/       # Rough MT (CTranslate2)
│   │   ├── embedding/         # Candle nomic-embed-text-v1
│   │   ├── storage/           # SQLite (courses, lectures, notes, subtitles, embeddings, chat)
│   │   ├── oauth.rs           # Localhost listener for ChatGPT OAuth callback
│   │   └── lib.rs             # Tauri command handlers
│   ├── scripts/               # Dev helpers (winbuild.bat etc.) + bootstrap
│   ├── vendor/                # Hydrated on demand — Windows patches for ct2rs/esaxx-rs
│   └── vendor-patches/        # Committed .patch files (tiny)
└── .github/workflows/         # Dual-platform CI (build-windows + build-macos)
```

## Branch strategy

Trunk-based development:

- **`main`** is the sole long-lived branch. Every merged PR lands here. CI runs on `main`. Dependabot targets `main`.
- **Releases are tags, not branches.** Stable: `v0.6.0`, `v0.7.0`. Pre-release: `v0.6.0-alpha.4`, `v0.6.0-beta.1`. The auto-updater fetches by tag, not by branch.
- **Short-lived `feat/*` branches** only for multi-week work (e.g. the v0.6.5 speech pipeline overhaul). Everyday fixes and small features land directly on `main`.
- **After a feature branch merges**, archive it as a tag and delete the branch: `git tag archive/<name> <old-tip-sha> && git push origin archive/<name> && git push origin --delete <name>`. History stays reachable; branch list stays clean.
- **PRs merge via squash** by default. Use merge-commit only when the branch's per-commit history is intentionally atomic and meaningful (rare).

### Current state

The state of `main` at any moment: it contains every merged PR, both stable and pre-release work. **Users should never `git clone main` for production use** — install from the [Releases page](https://github.com/sklonely/ClassNoteAI/releases) instead, where tagged builds are signed, notarized (macOS), and tested. `main` exists for contributors.

Latest stable tag: `v0.6.0`. Latest pre-release tag at time of writing: `v0.6.0-alpha.4`. Check the [Releases page](https://github.com/sklonely/ClassNoteAI/releases) for the current newest of each.

### Why not GitFlow / main-vs-develop split

Considered and rejected for a solo-maintainer alpha-stage project. GitFlow works when a dedicated release manager cuts stable releases on cadence; a two-long-lived-branch model creates dependabot-target confusion, merge-conflict tax at every stable cut, and "which branch is authoritative?" questions from visitors. Trunk-based with disciplined tagging solves the same problem with one moving part.

## CI

Every PR runs `build-windows` and `build-macos`. The ruleset on `main` requires both status checks + one approving review (bypassable by repo admins). See [.github/workflows/](.github/workflows/) for details.

Release is triggered on tag push matching `v*` — builds both platforms and uploads artifacts to the GitHub Release.

## Code style

- Conventional Commits for PR titles / commit messages (the CI release-notes generator parses these)
- `tsc --noEmit` must pass
- `cargo check` must pass on MSVC
- `npx vitest run` must pass (frontend tests only; Rust tests run via CI)

## Windows build notes

Two upstream crates force `/MT` static CRT in ways that break the rest of the build. We keep small `.patch` files under `src-tauri/vendor-patches/` and hydrate them on demand via `scripts/bootstrap-vendor.sh`. Do not commit the hydrated `vendor/` directory — it's in `.gitignore`.

If you change anything in `vendor/<crate>/`, regenerate the corresponding patch:

```bash
diff -u src-tauri/vendor/<crate>/<file> <path-to-original> \
  | sed '1s|.*|--- a/<file>|;2s|.*|+++ b/<file>|' \
  > src-tauri/vendor-patches/<crate>-<file>.patch
```

## License

MIT. By contributing, you agree your changes are licensed under MIT.
