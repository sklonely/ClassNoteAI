import { invoke } from '@tauri-apps/api/core';
import { storageService } from './storageService';
import { ragService } from './ragService';
import type { Subtitle } from '../types';

/**
 * v0.6.0 — import a recorded lecture video and produce the same
 * artifacts a live-recorded lecture produces:
 *
 *   1. Copy the user-selected video file into the app's video dir.
 *   2. Pipe it through ffmpeg to get 16 kHz mono i16 PCM.
 *   3. Run whisper-rs over the PCM to get timed segments.
 *   4. Persist the segments as `subtitles` rows (role = "rough";
 *      the streaming fine-refine pass can upgrade them to "fine"
 *      later if needed).
 *   5. Update the lecture row with `video_path` + durations.
 *   6. Re-index the lecture for RAG so AI 助教 can use the
 *      transcript immediately.
 *
 * Everything after step 1 is background work. The UI surfaces
 * progress via the callback.
 */

export type ImportStage =
    | 'staging'
    | 'extracting_audio'
    | 'transcribing'
    | 'saving_subtitles'
    | 'indexing'
    | 'done';

export interface ImportProgress {
    stage: ImportStage;
    message: string;
    /** 0..1 for stages that can report granular progress; undefined
     *  when the underlying step is opaque (e.g. ffmpeg doesn't stream
     *  progress over stdin, whisper doesn't either). */
    fraction?: number;
}

interface WhisperSegment {
    text: string;
    start_ms: number;
    end_ms: number;
}

interface TranscriptionResult {
    text: string;
    segments: WhisperSegment[];
    language?: string | null;
    duration_ms: number;
}

export const videoImportService = {
    async importVideo(
        lectureId: string,
        sourcePath: string,
        options: {
            language?: string;
            initialPrompt?: string;
            onProgress?: (p: ImportProgress) => void;
        } = {},
    ): Promise<{ videoPath: string; segmentCount: number; durationMs: number }> {
        const emit = (p: ImportProgress) => options.onProgress?.(p);

        // 1. Stage the source video under {app_data}/videos/{lectureId}.{ext}.
        emit({ stage: 'staging', message: '正在複製影片到應用目錄…' });
        const videoPath = await invoke<string>('import_video_for_lecture', {
            lectureId,
            sourcePath,
        });

        // 2 + 3. Extract PCM + run Whisper inside one Rust call. The
        // previous split would have serialised up to ~115 MB of i16
        // samples (1h video × 16kHz × 2 bytes) as JSON over Tauri's
        // IPC channel, which OOMs the webview. The combined command
        // keeps the PCM in the Rust process and only returns the
        // final segment list (a few KB).
        emit({
            stage: 'transcribing',
            message: '抽取音訊並轉錄中…',
        });
        const result = await invoke<TranscriptionResult>('transcribe_video_file', {
            videoPath,
            initialPrompt: options.initialPrompt ?? null,
            language: options.language ?? null,
            options: null,
        });

        // 4a. Batch translate the English segments into Chinese in
        //     ONE CTranslate2 call, then stitch back to their original
        //     timestamps. Translating one line at a time would have
        //     been N IPC round-trips and given the model no surrounding
        //     context; a batch call lets the local CT2 engine run the
        //     whole set on a single forward pass. We chunk at 64 lines
        //     per batch so a 90-min lecture (~1000 segments) doesn't
        //     push a single IPC payload over a megabyte — CTranslate2
        //     handles the internal batching anyway.
        emit({
            stage: 'saving_subtitles',
            message: `翻譯 ${result.segments.length} 段字幕…`,
        });
        const texts = result.segments.map((s) => s.text.trim());
        const translations: string[] = new Array(texts.length);
        const BATCH = 64;
        for (let i = 0; i < texts.length; i += BATCH) {
            const slice = texts.slice(i, i + BATCH);
            try {
                const translated = await invoke<string[]>('translate_ct2_batch', { texts: slice });
                for (let j = 0; j < slice.length; j++) {
                    translations[i + j] = translated[j] ?? '';
                }
            } catch (err) {
                // Degrade gracefully: if the local CT2 model isn't
                // loaded (user never configured translation, or model
                // download is pending), keep the English subtitles
                // and let the user add translations later.
                console.warn('[videoImport] batch translate failed, falling back to English-only:', err);
                for (let j = 0; j < slice.length; j++) {
                    translations[i + j] = '';
                }
            }
        }

        // 4b. Persist segments as rough subtitles with both English
        //     and (best-effort) Chinese text. Timestamp = Whisper's
        //     start_ms converted to seconds (the schema's `timestamp`
        //     column is seconds-as-float).
        const subtitles: Subtitle[] = result.segments.map((seg, idx) => ({
            id: crypto.randomUUID(),
            lecture_id: lectureId,
            timestamp: seg.start_ms / 1000,
            text_en: seg.text.trim(),
            text_zh: translations[idx]?.trim() || undefined,
            type: 'rough',
            confidence: undefined,
            created_at: new Date().toISOString(),
        }));
        if (subtitles.length > 0) {
            await storageService.saveSubtitles(subtitles);
        }

        // 5. Update the lecture row — video_path + duration. We leave
        //    status alone; if the lecture was 'recording' (rare for
        //    this flow since user usually imports into a fresh
        //    lecture), the user can manually flip via Save.
        const lecture = await storageService.getLecture(lectureId);
        if (lecture) {
            await storageService.saveLecture({
                ...lecture,
                video_path: videoPath,
                duration: Math.max(lecture.duration, Math.round(result.duration_ms / 1000)),
                status: 'completed',
                updated_at: new Date().toISOString(),
            });
        }

        // 6. RAG index. Concatenate all segments into one transcript
        //    string; ragService.indexLecture chunks it the same way
        //    live-recorded transcripts are chunked.
        emit({ stage: 'indexing', message: '建立 AI 助教索引…' });
        const transcriptText = result.segments
            .map((s) => s.text.trim())
            .filter(Boolean)
            .join('\n');
        // `indexLecture` will pull pdfText from the lecture's PDF on
        // next open if one is attached; here we pass null so only the
        // transcript goes in. PDF index picks up via its own flow.
        await ragService.indexLecture(lectureId, null, transcriptText);

        emit({ stage: 'done', message: '完成' });
        return {
            videoPath,
            segmentCount: result.segments.length,
            durationMs: result.duration_ms,
        };
    },
};
