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

        // 2. Extract PCM via ffmpeg. Whole-file in-memory result is
        //    fine for lecture lengths; if we ever need to support 4 h+
        //    videos we switch to streaming PCM chunks.
        emit({ stage: 'extracting_audio', message: '抽取音訊中…' });
        const pcm = await invoke<number[]>('extract_pcm_from_video', {
            videoPath,
        });

        // 3. Whisper transcribe. Reuses the exact same command the
        //    live-recording path uses — no new model state, no new
        //    code path, same quality.
        emit({
            stage: 'transcribing',
            message: `轉錄中（約 ${Math.round(pcm.length / 16000)} 秒音訊）…`,
        });
        const result = await invoke<TranscriptionResult>('transcribe_audio', {
            audioData: pcm,
            sampleRate: 16000,
            initialPrompt: options.initialPrompt ?? null,
            language: options.language ?? null,
            options: null,
        });

        // 4. Persist segments as rough subtitles. `timestamp` on the
        //    Subtitle row is in seconds (float) per the existing
        //    schema; Whisper gives us ms, so divide.
        emit({ stage: 'saving_subtitles', message: '寫入字幕…' });
        const subtitles: Subtitle[] = result.segments.map((seg) => ({
            id: crypto.randomUUID(),
            lecture_id: lectureId,
            timestamp: seg.start_ms / 1000,
            text_en: seg.text.trim(),
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
