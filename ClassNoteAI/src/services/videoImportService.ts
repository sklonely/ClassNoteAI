import { invoke } from '@tauri-apps/api/core';
import { storageService } from './storageService';
import { ragService } from './ragService';
import type { Subtitle } from '../types';

/**
 * v0.6.0 — chunked video import pipeline.
 *
 * Previously the whole flow lived inside a single `transcribe_video_file`
 * call that would:
 *   1. Run ffmpeg to fully buffer the PCM,
 *   2. Run one monolithic Whisper pass over it,
 *   3. Return all segments — at which point we batch-translated.
 *
 * For a 70-minute lecture step 2 was 20–60 min of opaque work with
 * zero UI feedback — indistinguishable from a hang. We now:
 *
 *   a. Extract PCM once to a temp `.pcm` file (fast, ~3 s for 70 min),
 *   b. Slice into 5-min chunks and transcribe each via
 *      `transcribe_pcm_file_slice`,
 *   c. As each chunk's segments come back, immediately queue them for
 *      CT2 translation — transcription of chunk N+1 runs in parallel
 *      with translation of chunk N on the Rust side,
 *   d. After all chunks finish (both passes), persist subtitles +
 *      build the RAG index.
 *
 * Language detection is cached from the first chunk and passed to
 * every subsequent chunk. Whisper's auto-detector runs on the first
 * 30 s of audio; if the lecture opens with silence or background
 * noise, detection lands on garbage (we saw "af" with p=0.01 on one
 * English lecture). The UI also lets the user pick a language
 * explicitly for reliability.
 */

export type ImportStage =
    | 'staging'
    | 'extracting_audio'
    | 'transcribing'
    | 'translating'
    | 'saving_subtitles'
    | 'indexing'
    | 'done';

export interface ImportProgress {
    stage: ImportStage;
    message: string;
    /** Transcribed / total chunks when known, for a progress bar. */
    transcribedChunks?: number;
    translatedChunks?: number;
    totalChunks?: number;
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

interface PcmExtractResult {
    pcm_path: string;
    duration_sec: number;
    sample_count: number;
}

/** Default chunk length. Whisper.cpp's internal windows are 30 s, so
 *  any multiple of that is safe; 5 min gives ~14 chunks for a 70-min
 *  lecture which is enough progress granularity without paying too
 *  much per-chunk model warmup cost. */
const CHUNK_SEC = 300;
const TRANSLATE_BATCH = 64;

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

        // 1. Stage the source video under the app's video dir.
        emit({ stage: 'staging', message: '正在複製影片到應用目錄…' });
        const videoPath = await invoke<string>('import_video_for_lecture', {
            lectureId,
            sourcePath,
        });

        // 2. Extract PCM to a temp file next to the staged video. Disk
        //    write is I/O-bound and cheap (~3 s for 70 min); doing it
        //    once up-front means per-chunk transcription only seeks.
        emit({ stage: 'extracting_audio', message: '抽取音訊…' });
        const pcm = await invoke<PcmExtractResult>('extract_video_pcm_to_temp', {
            videoPath,
        });

        try {
            // 3. Plan chunks. Last chunk may be shorter than CHUNK_SEC.
            const chunks: { start: number; end: number }[] = [];
            for (let t = 0; t < pcm.duration_sec; t += CHUNK_SEC) {
                chunks.push({
                    start: t,
                    end: Math.min(t + CHUNK_SEC, pcm.duration_sec),
                });
            }
            const total = chunks.length;

            // 4. Transcribe + translate pipeline.
            //
            //    - Transcription runs sequentially (one Whisper context
            //      at a time; two in parallel would just contend for
            //      the same Mutex-guarded service).
            //    - Translation fires-and-forgets: each finished chunk's
            //      segments are handed to translate_ct2_batch in the
            //      background while the next chunk transcribes.
            //    - We join on all translation promises at the end before
            //      saving subtitles.
            const allSegments: WhisperSegment[] = [];
            const translationMap = new Map<WhisperSegment, string>();
            const translationPromises: Promise<void>[] = [];

            let transcribed = 0;
            let translated = 0;
            // Seed language from caller or leave null for auto-detect.
            // `'auto'` is the UI sentinel — Rust already normalises it
            // to None, but we want it to also be blank-ish here so the
            // first-chunk result can overwrite it.
            let currentLang: string | null =
                options.language && options.language.toLowerCase() !== 'auto'
                    ? options.language
                    : null;

            const reportTranscribing = (activeIdx: number | null) =>
                emit({
                    stage: 'transcribing',
                    message:
                        activeIdx !== null
                            ? `轉錄第 ${activeIdx + 1}/${total} 段中（已完成 ${transcribed}，翻譯 ${translated}/${total}）`
                            : `轉錄 ${transcribed}/${total}，翻譯 ${translated}/${total}`,
                    transcribedChunks: transcribed,
                    translatedChunks: translated,
                    totalChunks: total,
                });
            const reportTranslating = () =>
                emit({
                    stage: 'translating',
                    message: `翻譯 ${translated}/${total}（轉錄已完成）`,
                    transcribedChunks: transcribed,
                    translatedChunks: translated,
                    totalChunks: total,
                });

            console.log(
                '[videoImport] pipeline start — total chunks:',
                total,
                'duration:',
                pcm.duration_sec.toFixed(1),
                's, pcm:',
                pcm.pcm_path,
            );
            reportTranscribing(null);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const t0 = performance.now();
                console.log(
                    `[videoImport] chunk ${i + 1}/${total} transcribe start — ${chunk.start.toFixed(1)}..${chunk.end.toFixed(1)}s, lang=${currentLang ?? 'auto'}`,
                );
                reportTranscribing(i);

                const result = await invoke<TranscriptionResult>(
                    'transcribe_pcm_file_slice',
                    {
                        pcmPath: pcm.pcm_path,
                        startSec: chunk.start,
                        endSec: chunk.end,
                        initialPrompt: options.initialPrompt ?? null,
                        language: currentLang,
                        options: null,
                    },
                );

                const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
                console.log(
                    `[videoImport] chunk ${i + 1}/${total} transcribe done in ${elapsed}s — segments=${result.segments.length}, lang=${result.language ?? 'unknown'}`,
                );

                // Cache first successful language detection so later
                // chunks don't redo it (and more importantly so they
                // don't drift between languages if audio briefly goes
                // quiet).
                if (!currentLang && result.language) {
                    currentLang = result.language;
                    console.log('[videoImport] language cached as:', currentLang);
                }

                const chunkSegs = result.segments.slice();
                allSegments.push(...chunkSegs);
                transcribed++;
                const chunkIndex = i; // captured for translate promise below
                reportTranscribing(i + 1 < total ? i + 1 : null);

                // Kick off translation for just this chunk. Errors
                // degrade to English-only — same graceful fallback the
                // old code had.
                translationPromises.push(
                    (async () => {
                        const texts = chunkSegs.map((s) => s.text.trim());
                        const outputs: string[] = new Array(texts.length).fill('');
                        for (let i = 0; i < texts.length; i += TRANSLATE_BATCH) {
                            const slice = texts.slice(i, i + TRANSLATE_BATCH);
                            try {
                                const tr = await invoke<string[]>('translate_ct2_batch', {
                                    texts: slice,
                                });
                                for (let j = 0; j < slice.length; j++) {
                                    outputs[i + j] = tr[j] ?? '';
                                }
                            } catch (err) {
                                console.warn(
                                    '[videoImport] batch translate failed:',
                                    err,
                                );
                                // Leave outputs[i..i+slice.length] as '' —
                                // English subtitle still gets saved.
                            }
                        }
                        for (let k = 0; k < chunkSegs.length; k++) {
                            translationMap.set(chunkSegs[k], outputs[k]);
                        }
                        translated++;
                        console.log(
                            `[videoImport] chunk ${chunkIndex + 1}/${total} translate done — ${translated}/${total} total`,
                        );
                        if (transcribed < total) {
                            reportTranscribing(null);
                        } else {
                            reportTranslating();
                        }
                    })(),
                );
            }

            // Wait for every chunk's translation to finish before we
            // persist (saveSubtitles expects the full translated set).
            await Promise.all(translationPromises);

            // 5. Persist subtitles (mirrors the live-recording schema:
            //    `rough` subtitles with en + best-effort zh).
            emit({
                stage: 'saving_subtitles',
                message: `儲存 ${allSegments.length} 段字幕…`,
                transcribedChunks: total,
                translatedChunks: total,
                totalChunks: total,
            });
            const now = new Date().toISOString();
            const subtitles: Subtitle[] = allSegments.map((seg) => ({
                id: crypto.randomUUID(),
                lecture_id: lectureId,
                timestamp: seg.start_ms / 1000,
                text_en: seg.text.trim(),
                text_zh: translationMap.get(seg)?.trim() || undefined,
                type: 'rough',
                confidence: undefined,
                created_at: now,
            }));
            if (subtitles.length > 0) {
                await storageService.saveSubtitles(subtitles);
            }

            // 6. Update lecture with video_path + duration.
            const lecture = await storageService.getLecture(lectureId);
            if (lecture) {
                await storageService.saveLecture({
                    ...lecture,
                    video_path: videoPath,
                    duration: Math.max(
                        lecture.duration,
                        Math.round(pcm.duration_sec),
                    ),
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                });
            }

            // 7. RAG index: concat all transcript text.
            emit({ stage: 'indexing', message: '建立 AI 助教索引…' });
            const transcriptText = allSegments
                .map((s) => s.text.trim())
                .filter(Boolean)
                .join('\n');
            await ragService.indexLecture(lectureId, null, transcriptText);

            emit({ stage: 'done', message: '完成' });
            return {
                videoPath,
                segmentCount: allSegments.length,
                durationMs: Math.round(pcm.duration_sec * 1000),
            };
        } finally {
            // Best-effort cleanup of the temp PCM. If the user aborted
            // mid-run (unlikely in MVP — there's no cancel button), the
            // leftover .pcm is still deleted here.
            void invoke('delete_temp_pcm', { pcmPath: pcm.pcm_path }).catch(() => {});
        }
    },
};
