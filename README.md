<div align="center">

# ClassNote AI

**A desktop study companion for recording lectures, turning them into searchable notes, and asking questions with your own AI tools.**

[![Release](https://img.shields.io/github/v/release/sklonely/ClassNoteAI)](https://github.com/sklonely/ClassNoteAI/releases/latest)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[Download](https://github.com/sklonely/ClassNoteAI/releases/latest) | [Landing Page](https://sklonely.github.io/ClassNoteAI/landing/) | [Contributing](CONTRIBUTING.md)

</div>

---

ClassNote AI is built for real classrooms: live lectures, imported recordings, slide PDFs, imperfect audio, long sessions, and the messy back-and-forth that happens around a course. It keeps the core note-taking workflow local-first, then lets you connect an AI provider when you want summaries, Q&A, or deeper cleanup.

## What It Does

| Area | Capability |
|---|---|
| Live recording | Record a class and generate transcript captions while the session is running. |
| Media import | Import lecture videos or audio-only recordings and process them through the same note pipeline. |
| Translation | Produce Chinese subtitles from English lecture audio, with final transcript text used for stable translation. |
| Course memory | Search across lecture transcripts, PDFs, notes, and course material. |
| AI assistant | Ask questions about a lecture or course using your configured AI provider. |
| Local-first data | Store lecture data, subtitles, notes, and indexes on your machine. |
| Desktop app | Runs as a macOS / Windows desktop app; no separate server setup for normal use. |

## Download

Get the latest build from [Releases](https://github.com/sklonely/ClassNoteAI/releases/latest).

| Platform | Asset |
|---|---|
| macOS | `ClassNoteAI_<version>_aarch64.dmg` |
| Windows | `ClassNoteAI_<version>_x64-setup.exe` |
| Windows GPU build | `ClassNoteAI_<version>_x64-cuda-setup.exe` |

On first launch, the app may download local speech or translation assets depending on the features you enable. The setup screen will show the current status and available variants.

## Typical Flow

1. Create a course and lecture.
2. Start recording, or import a video/audio file from a teacher.
3. Let the app build captions, translations, and searchable lecture text.
4. Add PDFs or notes when useful.
5. Ask the AI assistant course-specific questions or review the generated notes.

## Privacy

- Lecture data is stored locally by default.
- Local transcription and indexing do not require uploading class audio.
- AI features use the provider you configure, so provider privacy terms apply when you send content to them.
- There is no hidden telemetry pipeline for lecture content.

## Development

For setup, CI notes, and contribution guidance, see [CONTRIBUTING.md](CONTRIBUTING.md).

Common local commands live in the app directory:

```bash
cd ClassNoteAI
npm install
npm run tauri:dev
```

The app workspace also includes an opt-in agent CLI for local debugging, smoke checks, and high-level workflow validation.

## License

[MIT License](LICENSE)
