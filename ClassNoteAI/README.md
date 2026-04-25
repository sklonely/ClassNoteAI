# ClassNote AI App

ClassNote AI is a local-first desktop app for lecture capture and study workflows. It records or imports class audio, produces transcript captions and translations, indexes course material, and lets you ask questions against your own course context.

This README is for the app workspace. For the project overview, release links, and contribution entry points, see the repository-level [README](../README.md).

## Core Workflows

### Record A Lecture

- Create or open a course.
- Start a lecture recording from the desktop app.
- Watch captions appear during the session.
- Stop the session to commit the final transcript and translation state.

### Import Media

- Import either video files or audio-only recordings.
- The app extracts the audio and runs it through the same transcript pipeline used by live recording.
- Video files are stored as lecture media; audio-only files are stored as lecture audio.

### Review And Search

- Review transcript captions and translations in the lecture view.
- Add PDFs, notes, or syllabus material to the course.
- Search across course material and ask the AI assistant contextual questions.

## Local Data

The app keeps course data, lecture metadata, captions, notes, and local indexes on your machine. Some optional AI actions may send selected content to the provider you configure.

## Requirements

For normal use:

- macOS or Windows desktop environment
- Enough disk space for local speech assets
- An AI provider account or API key only if you want assistant features

You do not need to run a separate web server for the desktop app.

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run tauri:dev
```

Run frontend tests:

```bash
npm test -- --run
```

Run a production frontend build:

```bash
npm run build
```

Rust checks live under `src-tauri`:

```bash
cd src-tauri
cargo check
```

## Notes For Contributors

- Keep user-facing docs focused on capabilities and workflows.
- Avoid naming internal models or backend libraries in general README copy unless they are part of a user-visible choice.
- Put implementation-specific details in focused docs under `docs/` or in PR notes instead.
