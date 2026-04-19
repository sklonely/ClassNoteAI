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
    | 'video_ready'
    | 'extracting_audio'
    | 'transcribing'
    | 'translating'
    | 'indexing'
    | 'done';

export interface ImportProgress {
    stage: ImportStage;
    message: string;
    /** Transcribed / total chunks when known, for a progress bar. */
    transcribedChunks?: number;
    translatedChunks?: number;
    totalChunks?: number;
    /** `video_ready` fires as soon as the staged video file is playable
     *  from its final path (step 1 of the pipeline). Frontend can then
     *  close the import modal, flip the UI into Review mode and show
     *  the <video> while transcription continues in the background. */
    videoPath?: string;
    /** `subtitles_changed` fires whenever a chunk's subtitles have
     *  been persisted. Frontend re-reads from the DB to refresh its
     *  display — cheap, and keeps a single source of truth. */
    subtitlesChanged?: boolean;
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

/** Chunk length trade-off. Smaller chunks → first subtitles appear
 *  faster (better perceived latency) at the cost of more per-chunk
 *  warmup overhead. 60 s is the sweet spot for batch import:
 *    - base model transcribes 60 s of audio in ~10–15 s on CPU, so
 *      subtitles stream in well ahead of 1× playback.
 *    - 70-min video → 70 chunks; per-chunk state-create cost is
 *      ~0.1 s, total overhead ~7 s, negligible vs total runtime.
 *    - A 30 s chunk would be faster still but whisper.cpp's decoder
 *      wants at least its internal 30 s window, so going smaller
 *      forces padding and wastes compute.
 *
 *  Industry reference: whisper_streaming / SimulStreaming target
 *  sub-second latency for *live* captioning via LocalAgreement-2 on
 *  continuously-growing audio. Our case is *batch* — a pre-recorded
 *  video where we already have the whole file — so we don't need
 *  LocalAgreement; just a small-enough chunk to feel responsive. */
const CHUNK_SEC = 60;
const TRANSLATE_BATCH = 64;

/** LLM-backed fine refinement pass. Runs AFTER rough transcribe +
 *  CT2 translate have landed all subtitles to DB. Each batch asks the
 *  user's configured LLM provider to correct ASR mistakes and produce
 *  a natural Chinese translation in one shot, then writes those back
 *  as `type='fine'`. Mirrors what transcriptionService does inline for
 *  live recordings — we just didn't have a hook to reach it from the
 *  batch video-import pipeline.
 *
 *  Skips entirely when no LLM provider is configured (same check
 *  `refreshFineRefinementAvailability` does for live), so users
 *  running fully offline don't pay a per-batch "no provider" retry.
 *
 *  Errors are treated as soft — we keep whatever rough refinement got
 *  through and move on. The user can retry later by deleting the
 *  lecture and re-importing, or we can add a "refine again" button.
 */
async function runFineRefinementPass(
    lectureId: string,
    emit: (p: ImportProgress) => void,
): Promise<void> {
    let refineTranscriptsFn: typeof import('./llm').refineTranscripts;
    try {
        const llm = await import('./llm');
        refineTranscriptsFn = llm.refineTranscripts;
        // Cheap availability check — probe a zero-length batch. If the
        // provider isn't configured, refineTranscripts itself bails
        // fast; we just catch that and skip silently.
    } catch (err) {
        console.warn('[videoImport] llm module unavailable, skipping fine refine:', err);
        return;
    }

    const subs = await storageService.getSubtitles(lectureId);
    if (subs.length === 0) return;

    // Work in batches of 20 — same as the live-recording path's
    // FINE_BATCH_SIZE. Large enough that per-call LLM overhead
    // amortises, small enough that a single failure only costs 20
    // segments of progress.
    const BATCH = 20;
    let done = 0;
    const total = subs.length;

    for (let i = 0; i < subs.length; i += BATCH) {
        const slice = subs.slice(i, i + BATCH);
        const input = slice
            .map((s) => ({ id: s.id, text: s.text_en || '' }))
            .filter((s) => s.text.length > 0);
        if (input.length === 0) {
            done += slice.length;
            continue;
        }

        try {
            const refinements = await refineTranscriptsFn(input);
            const byId = new Map(refinements.map((r) => [r.id, r]));
            const updates: Subtitle[] = slice.map((s) => {
                const r = byId.get(s.id);
                if (!r) return s;
                return {
                    ...s,
                    text_en: r.en,
                    text_zh: r.zh,
                    type: 'fine' as const,
                };
            });
            await storageService.saveSubtitles(updates);
            done += slice.length;
            emit({
                stage: 'translating',
                message: `精翻中 ${Math.min(done, total)}/${total}…`,
                subtitlesChanged: true,
            });
        } catch (err) {
            // Most likely cause: no AI provider configured. Bail out
            // entirely rather than spamming N failed batches.
            console.warn('[videoImport] refineTranscripts batch failed, stopping:', err);
            return;
        }
    }

    emit({ stage: 'done', message: '精翻完成', subtitlesChanged: true });
}

/** Which model Rust should use for this import's transcription.
 *  - `'fast'`: swap in ggml-base.bin (~5x faster than turbo on CPU).
 *  - `'standard'`: use whatever WHISPER_SERVICE already has loaded
 *    (what the user picked in settings for live recording). */
export type TranscribeQuality = 'fast' | 'standard';

export const videoImportService = {
    async importVideo(
        lectureId: string,
        sourcePath: string,
        options: {
            language?: string;
            initialPrompt?: string;
            quality?: TranscribeQuality;
            /** When true, run the LLM fine-refinement pass after rough
             *  transcribe + CT2 translate finish. Off by default (see
             *  ImportModal rationale about token cost). */
            refineWithAI?: boolean;
            onProgress?: (p: ImportProgress) => void;
        } = {},
    ): Promise<{ videoPath: string; segmentCount: number; durationMs: number }> {
        const emit = (p: ImportProgress) => options.onProgress?.(p);
        const quality = options.quality ?? 'fast';
        const refineWithAI = options.refineWithAI ?? false;

        // Per-stage wall-time profiler. Logs a breakdown at the end so
        // we can see exactly where the pipeline spent its minutes
        // ("stage"/"extract"/"transcribe+translate"/"rag"/"fine") and
        // target the slowest bit next round.
        const t0 = performance.now();
        const stageTimes: Record<string, number> = {};
        const markStage = (name: string) => {
            stageTimes[name] = (performance.now() - t0) / 1000;
        };

        // 1. Stage the source video under the app's video dir, AND
        //    persist the video_path on the lecture row immediately.
        //    Prior to v0.6.1 we only wrote video_path at the very end,
        //    which meant the user stared at a progress modal for 30+
        //    min before the video was even playable. The industry
        //    pattern for batch import UX is "media available
        //    immediately, captions stream in progressively" — same
        //    approach YouTube's auto-captions and Descript use.
        emit({ stage: 'staging', message: '正在複製影片到應用目錄…' });
        const videoPath = await invoke<string>('import_video_for_lecture', {
            lectureId,
            sourcePath,
        });
        const lectureBefore = await storageService.getLecture(lectureId);
        if (lectureBefore) {
            await storageService.saveLecture({
                ...lectureBefore,
                video_path: videoPath,
                updated_at: new Date().toISOString(),
            });
        }
        markStage('stage_copy');
        emit({
            stage: 'video_ready',
            message: '影片已就緒，可以先開始觀看。轉錄中…',
            videoPath,
        });

        // 1.5. Resolve model override up-front. Failing early lets us
        //      surface "fast mode requires ggml-base.bin" before the
        //      user waits through ffmpeg + chunk planning only to hit
        //      the error on slice #1. 'standard' skips this entirely
        //      and keeps model_override_path null.
        let modelOverridePath: string | null = null;
        if (quality === 'fast') {
            try {
                modelOverridePath = await invoke<string>('resolve_whisper_model_path', {
                    preset: 'base',
                });
                console.log(
                    '[videoImport] fast mode — using model:',
                    modelOverridePath,
                );
            } catch (err) {
                console.warn(
                    '[videoImport] fast-mode model unavailable, falling back to standard:',
                    err,
                );
                // Degrade gracefully to the user's main model. An
                // alternative would be to abort with a "please
                // download base first" dialog; preferring to just
                // work-slowly-but-work for the MVP.
            }
        }

        // 2. Extract PCM to a temp file next to the staged video. Disk
        //    write is I/O-bound and cheap (~3 s for 70 min); doing it
        //    once up-front means per-chunk transcription only seeks.
        emit({ stage: 'extracting_audio', message: '抽取音訊…' });
        const pcm = await invoke<PcmExtractResult>('extract_video_pcm_to_temp', {
            videoPath,
        });
        markStage('ffmpeg_pcm_extract');

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

            // 4. Transcribe + translate pipeline, with progressive
            //    persistence. Each chunk flows through three distinct
            //    "commit" points so the UI can reflect partial state:
            //
            //      a) transcribe finishes → save rough en subtitles to
            //         DB and emit `subtitlesChanged`. User sees English
            //         captions roll in chunk-by-chunk.
            //      b) translate finishes → update those rows with
            //         text_zh and emit again. Chinese fills in behind
            //         the English.
            //      c) all chunks done → RAG index + mark completed.
            //
            //    Industry reference: this is the "progressive captions"
            //    pattern used by Descript / Otter — media plays while
            //    the transcript materialises behind it. We don't need
            //    whisper_streaming's LocalAgreement-2 because we have
            //    the full audio up-front; LocalAgreement is for live
            //    captioning where partial results get rewritten as
            //    more audio arrives.
            const savedSubtitleIds = new Map<WhisperSegment, string>();
            const allSegments: WhisperSegment[] = [];
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
                        modelOverridePath,
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

                // (a) Persist this chunk's subtitles immediately with
                //     only the English text. Each row's UUID is captured
                //     so the translation step (b) can update the exact
                //     same row without reading back from DB.
                //
                //     Timestamp convention: we store *absolute epoch
                //     seconds* to match the live-recording path (which
                //     stores Date.now()/1000 at the moment the segment
                //     was captured). The SubtitleDisplay component and
                //     section-timestamp math in NotesView both subtract
                //     `lecture.created_at` at display time to get the
                //     relative offset. Storing the video's in-media
                //     offset as epoch seconds = `created_at + start_ms`
                //     keeps both paths unified.
                const nowIso = new Date().toISOString();
                const createdAtEpochSec = lectureBefore
                    ? new Date(lectureBefore.created_at).getTime() / 1000
                    : Date.now() / 1000;
                const chunkSubtitles: Subtitle[] = chunkSegs.map((seg) => {
                    const id = crypto.randomUUID();
                    savedSubtitleIds.set(seg, id);
                    return {
                        id,
                        lecture_id: lectureId,
                        timestamp: createdAtEpochSec + seg.start_ms / 1000,
                        text_en: seg.text.trim(),
                        text_zh: undefined,
                        type: 'rough',
                        confidence: undefined,
                        created_at: nowIso,
                    };
                });
                if (chunkSubtitles.length > 0) {
                    try {
                        await storageService.saveSubtitles(chunkSubtitles);
                        emit({
                            stage: 'transcribing',
                            message: `轉錄第 ${i + 1}/${total} 段中（已完成 ${transcribed}，翻譯 ${translated}/${total}）`,
                            transcribedChunks: transcribed,
                            translatedChunks: translated,
                            totalChunks: total,
                            subtitlesChanged: true,
                        });
                    } catch (err) {
                        console.warn(
                            `[videoImport] chunk ${i + 1} subtitle save failed:`,
                            err,
                        );
                    }
                }

                // (b) Kick off translation for just this chunk. When it
                //     finishes we update the rows saved in (a) in place
                //     with the Chinese text. Errors degrade to
                //     English-only — same graceful fallback as before.
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
                                // English subtitle stays as-is.
                            }
                        }
                        // Re-save those rows with text_zh filled in.
                        // saveSubtitles uses INSERT ... ON CONFLICT(id)
                        // DO UPDATE, so reusing the captured id updates
                        // in place without touching other rows.
                        const translatedRows: Subtitle[] = chunkSegs.map((seg, k) => ({
                            id: savedSubtitleIds.get(seg)!,
                            lecture_id: lectureId,
                            timestamp: createdAtEpochSec + seg.start_ms / 1000,
                            text_en: seg.text.trim(),
                            text_zh: outputs[k]?.trim() || undefined,
                            type: 'rough',
                            confidence: undefined,
                            created_at: nowIso,
                        }));
                        try {
                            await storageService.saveSubtitles(translatedRows);
                        } catch (err) {
                            console.warn(
                                `[videoImport] chunk ${chunkIndex + 1} translate-save failed:`,
                                err,
                            );
                        }
                        translated++;
                        console.log(
                            `[videoImport] chunk ${chunkIndex + 1}/${total} translate done — ${translated}/${total} total`,
                        );
                        emit({
                            stage: transcribed < total ? 'transcribing' : 'translating',
                            message:
                                transcribed < total
                                    ? `轉錄 ${transcribed}/${total}，翻譯 ${translated}/${total}`
                                    : `翻譯 ${translated}/${total}（轉錄已完成）`,
                            transcribedChunks: transcribed,
                            translatedChunks: translated,
                            totalChunks: total,
                            subtitlesChanged: true,
                        });
                    })(),
                );
            }

            // Wait for every chunk's translation to finish before we
            // mark the lecture completed. Fine refinement + RAG index
            // run AFTER completion in the background (see below) so the
            // UI can exit the "importing" state as soon as rough +
            // Google-translated captions are all saved.
            await Promise.all(translationPromises);
            markStage('transcribe_plus_translate');

            // 5. Update lecture duration + mark completed. video_path
            //    was written up-front at the staging step so this is
            //    just a status flip.
            const lecture = await storageService.getLecture(lectureId);
            if (lecture) {
                await storageService.saveLecture({
                    ...lecture,
                    duration: Math.max(
                        lecture.duration,
                        Math.round(pcm.duration_sec),
                    ),
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                });
            }

            // 6. Fine refinement + 7. RAG index can run in parallel:
            //    fine uses the configured LLM (remote/local), RAG uses
            //    the local embedding model. They don't contend for any
            //    shared resource. RAG uses the rough English text —
            //    fine's mutation of `text_zh` doesn't affect retrieval
            //    quality (which embeds English).
            //
            //    Fine refinement is opt-in per-import via the `refineWithAI`
            //    flag. Default OFF: a 70-min lecture burns ~130k tokens.
            //    Users who want it see the cost estimate in ImportModal
            //    before opting in.
            const fineTask = refineWithAI
                ? runFineRefinementPass(lectureId, emit).catch((err) => {
                      console.warn('[videoImport] fine refinement failed:', err);
                  })
                : Promise.resolve();

            emit({ stage: 'indexing', message: '建立 AI 助教索引…' });
            const ragTask = (async () => {
                try {
                    const finalSubs = await storageService.getSubtitles(lectureId);
                    const transcriptText = finalSubs
                        .map((s) => (s.text_en || '').trim())
                        .filter(Boolean)
                        .join('\n');
                    await ragService.indexLecture(lectureId, null, transcriptText);
                } catch (err) {
                    console.warn('[videoImport] RAG index failed:', err);
                }
            })();

            await Promise.all([fineTask, ragTask]);
            markStage('fine_plus_rag');

            // Log a compact per-stage breakdown. Previous stages were
            // cumulative from t0; turn them into deltas for readability.
            const prev = { name: 'start', t: 0 };
            const breakdown: string[] = [];
            for (const [name, t] of Object.entries(stageTimes)) {
                breakdown.push(`${name}=${(t - prev.t).toFixed(1)}s`);
                prev.name = name;
                prev.t = t;
            }
            console.log(
                `[videoImport] TIMING total=${((performance.now() - t0) / 1000).toFixed(1)}s  |  ${breakdown.join('  ')}`,
            );

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
            // Also release the import-side Whisper model so we're not
            // holding ~150 MB idle. Next import will reload on first
            // slice (~1 s).
            if (modelOverridePath) {
                void invoke('release_import_whisper').catch(() => {});
            }
        }
    },
};
