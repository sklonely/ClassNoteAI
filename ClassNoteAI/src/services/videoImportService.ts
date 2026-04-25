/**
 * Video import service — TEMPORARILY STUBBED in the v2 streaming refactor.
 *
 * The v1 implementation drove a Whisper-based bulk transcription path
 * via Tauri commands `transcribe_pcm_file_slice`, `transcribe_video_file`,
 * `resolve_whisper_model_path`, `release_import_whisper`. All of those
 * commands were removed when the Whisper backend was deleted from the
 * Rust crate.
 *
 * The v2 replacement is straightforward but non-trivial:
 *
 *   1. Extract PCM via the kept ffmpeg commands
 *      (`extract_video_pcm_to_temp` + `read_pcm_slice`).
 *   2. Open a Parakeet ASR session via `asrPipeline.start()`.
 *   3. Stream PCM chunks into `asrPipeline.pushAudio()` — same flow as
 *      live mic capture, just with audio coming from a file instead of
 *      the recorder.
 *   4. Subscribe to `subtitleStream` to collect committed sentences +
 *      translations and persist them via `storageService.saveSubtitles`.
 *   5. End the session, release PCM temp file.
 *
 * That's a focused ~150 LOC rewrite that wasn't safe to complete in the
 * same PR cycle as the architecture switch — landing a partial would be
 * worse than a clear "not yet" because the renderer's progress UI gets
 * stuck. The stub below preserves the public surface so type-checking
 * passes; calling `importVideo` raises a clear error the import modal
 * already knows how to display.
 *
 * Tracking: a follow-up PR `feat/video-import-parakeet` does steps 1-5.
 */

export type ImportStage =
    | 'staging'
    | 'extracting'
    | 'video_ready'
    | 'transcribing'
    | 'translating'
    | 'saving'
    | 'fine_refining'
    | 'rag_indexing'
    | 'done'
    | 'error';

export interface ImportProgress {
    stage: ImportStage;
    message: string;
    videoPath?: string;
    transcribed?: number;
    translated?: number;
    total?: number;
    /** Set when a chunk's subtitles were just persisted — lets the
     *  consumer (NotesView) re-fetch the subtitle list incrementally
     *  instead of waiting for the full import to finish. */
    subtitlesChanged?: boolean;
}

export type TranscribeQuality = 'fast' | 'standard';

export const videoImportService = {
    async importVideo(
        _lectureId: string,
        _sourcePath: string,
        _options: {
            language?: string;
            initialPrompt?: string;
            quality?: TranscribeQuality;
            refineWithAI?: boolean;
            onProgress?: (p: ImportProgress) => void;
        } = {},
    ): Promise<{ videoPath: string; segmentCount: number; durationMs: number }> {
        throw new Error(
            '影片匯入功能正在重構為 Parakeet 串流管線（v2）。下一個 PR ' +
                '會接回。目前請使用即時錄音（同樣走 Parakeet sidecar + ' +
                'TranslateGemma），效果更好。',
        );
    },
};
