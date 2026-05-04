import { invoke } from '@tauri-apps/api/core';
import { asrPipeline } from './streaming/asrPipeline';
import { subtitleStream, type SubtitleEvent } from './streaming/subtitleStream';
import { storageService } from './storageService';
import type { Lecture, Subtitle } from '../types';
import { isAudioOnlyMediaPath } from '../utils/mediaFileTypes';

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
    /** Set when a chunk's subtitles were just persisted so the
     *  consumer can re-fetch incrementally. */
    subtitlesChanged?: boolean;
}

export type TranscribeQuality = 'fast' | 'standard';

interface PcmExtractResult {
    pcm_path: string;
    sample_count: number;
    duration_sec: number;
}

const ASR_CHUNK_SAMPLES = 8_960;
const IMPORT_SLICE_SAMPLES = ASR_CHUNK_SAMPLES * 10; // 5.6 s of audio
function isAudioOnly(path: string): boolean {
    return isAudioOnlyMediaPath(path);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatProgress(done: number, total: number): string {
    if (total <= 0) return '0%';
    return `${Math.min(100, Math.round((done / total) * 100))}%`;
}

function subtitleFromEvent(
    lecture: Lecture,
    event: Extract<SubtitleEvent, { kind: 'sentence_committed' }>,
): Subtitle {
    const baseSec = lecture.created_at
        ? new Date(lecture.created_at).getTime() / 1000
        : Date.now() / 1000;
    return {
        id: event.id,
        lecture_id: lecture.id,
        timestamp: baseSec + event.audioStartSec,
        text_en: event.textEn,
        type: 'rough',
        source: 'imported',
        confidence: undefined,
        speaker_role: event.speakerRole,
        speaker_id: event.speakerId,
        created_at: new Date().toISOString(),
    };
}

export const videoImportService = {
    async importVideo(
        lectureId: string,
        sourcePath: string,
        options: {
            language?: string;
            initialPrompt?: string;
            quality?: TranscribeQuality;
            refineWithAI?: boolean;
            onProgress?: (p: ImportProgress) => void;
        } = {},
    ): Promise<{ videoPath: string; segmentCount: number; durationMs: number }> {
        let unsubscribe: (() => void) | null = null;
        let pcmPath: string | null = null;
        let persistTimer: ReturnType<typeof setTimeout> | null = null;
        let dirty = false;
        let persistChain = Promise.resolve();

        const lecture = await storageService.getLecture(lectureId);
        if (!lecture) {
            throw new Error(`Lecture not found: ${lectureId}`);
        }

        const audioOnly = isAudioOnly(sourcePath);
        const subtitles = new Map<string, Subtitle>();
        const pendingTranslations = new Set<string>();
        let sessionId: string | null = null;
        let translated = 0;

        const report = (progress: ImportProgress) => {
            options.onProgress?.(progress);
        };

        const persistNow = async (
            stage: ImportStage = 'saving',
            message = '保存字幕...',
            subtitlesChanged = false,
        ): Promise<void> => {
            if (!dirty) return persistChain;
            dirty = false;
            const rows = [...subtitles.values()];
            if (rows.length === 0) return persistChain;
            persistChain = persistChain.then(async () => {
                await storageService.saveSubtitles(rows);
                report({
                    stage,
                    message,
                    transcribed: rows.length,
                    translated,
                    total: rows.length,
                    subtitlesChanged,
                });
            });
            return persistChain;
        };

        const schedulePersist = () => {
            dirty = true;
            if (persistTimer) return;
            persistTimer = setTimeout(() => {
                persistTimer = null;
                void persistNow(
                    'transcribing',
                    `已產生 ${subtitles.size} 段字幕，翻譯 ${translated} 段...`,
                    true,
                );
            }, 500);
        };

        try {
            report({ stage: 'staging', message: audioOnly ? '匯入錄音檔...' : '匯入影片...' });
            const mediaPath = await invoke<string>('import_video_for_lecture', {
                srcPath: sourcePath,
                lectureId,
            });

            const updatedLecture: Lecture = {
                ...lecture,
                status: 'completed',
                updated_at: new Date().toISOString(),
                video_path: audioOnly ? lecture.video_path : mediaPath,
                audio_path: audioOnly ? mediaPath : lecture.audio_path,
            };
            await storageService.saveLecture(updatedLecture);

            report({
                stage: 'video_ready',
                message: audioOnly ? '錄音檔已就緒，開始抽取音訊...' : '影片已就緒，開始抽取音訊...',
                videoPath: mediaPath,
            });

            report({ stage: 'extracting', message: '使用 ffmpeg 轉成 16 kHz PCM...' });
            const pcm = await invoke<PcmExtractResult>('extract_video_pcm_to_temp', {
                videoPath: mediaPath,
            });
            pcmPath = pcm.pcm_path;

            unsubscribe = subtitleStream.subscribe((event) => {
                if (event.kind === 'session_started') {
                    sessionId = event.sessionId;
                    return;
                }
                if (!sessionId || !('sessionId' in event) || event.sessionId !== sessionId) {
                    return;
                }

                if (event.kind === 'sentence_committed') {
                    subtitles.set(event.id, subtitleFromEvent(updatedLecture, event));
                    pendingTranslations.add(event.id);
                    schedulePersist();
                    report({
                        stage: 'transcribing',
                        message: `已產生 ${subtitles.size} 段字幕...`,
                        transcribed: subtitles.size,
                        translated,
                        total: subtitles.size,
                    });
                    return;
                }

                if (event.kind === 'translation_ready') {
                    const row = subtitles.get(event.id);
                    if (row) {
                        row.text_zh = event.textZh;
                        subtitles.set(event.id, row);
                    }
                    pendingTranslations.delete(event.id);
                    translated += 1;
                    schedulePersist();
                    return;
                }

                if (event.kind === 'translation_failed') {
                    pendingTranslations.delete(event.id);
                    schedulePersist();
                }
            });

            report({ stage: 'transcribing', message: '開始轉錄媒體音訊...' });
            await asrPipeline.start(options.language === 'auto' ? undefined : options.language);

            let processed = 0;
            while (processed < pcm.sample_count) {
                const count = Math.min(IMPORT_SLICE_SAMPLES, pcm.sample_count - processed);
                const samples = await invoke<number[]>('read_pcm_slice', {
                    pcmPath,
                    startSample: processed,
                    count,
                });
                if (samples.length === 0) break;
                await asrPipeline.pushAudio(Int16Array.from(samples));
                processed += samples.length;
                report({
                    stage: 'transcribing',
                    message: `轉錄中 ${formatProgress(processed, pcm.sample_count)}...`,
                    transcribed: subtitles.size,
                    translated,
                    total: subtitles.size,
                });
            }

            await asrPipeline.stop();

            report({
                stage: 'translating',
                message: `等待翻譯完成... ${translated}/${subtitles.size}`,
                transcribed: subtitles.size,
                translated,
                total: subtitles.size,
            });

            const translationDeadline = Date.now() + 15 * 60_000;
            while (pendingTranslations.size > 0 && Date.now() < translationDeadline) {
                await delay(250);
                report({
                    stage: 'translating',
                    message: `等待翻譯完成... ${translated}/${subtitles.size}`,
                    transcribed: subtitles.size,
                    translated,
                    total: subtitles.size,
                });
            }

            if (persistTimer) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            dirty = true;
            await persistNow('saving', '保存字幕...', true);
            await persistChain;

            report({
                stage: 'done',
                message: audioOnly ? '錄音檔匯入完成' : '影片匯入完成',
                videoPath: mediaPath,
                transcribed: subtitles.size,
                translated,
                total: subtitles.size,
                subtitlesChanged: true,
            });

            return {
                videoPath: mediaPath,
                segmentCount: subtitles.size,
                durationMs: Math.round(pcm.duration_sec * 1000),
            };
        } catch (error) {
            report({
                stage: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        } finally {
            if (persistTimer) {
                clearTimeout(persistTimer);
            }
            if (unsubscribe) {
                unsubscribe();
            }
            try {
                await asrPipeline.stop();
            } catch {
                // Best effort cleanup; import may have failed before start.
            }
            if (pcmPath) {
                try {
                    await invoke('delete_temp_pcm', { pcmPath });
                } catch {
                    // Best effort cleanup of temp files.
                }
            }
        }
    },
};
