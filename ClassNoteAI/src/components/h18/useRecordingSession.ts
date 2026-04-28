/**
 * useRecordingSession · v0.7.0 Phase 6.5+
 *
 * 從 NotesView 萃取出來的最小錄音 state machine，給 H18RecordingPage 用。
 *
 * 接的後端：
 *  - AudioRecorder (本機 instance) — 麥克風 + 16kHz 重採樣 + .pcm flush
 *  - transcriptionService — Parakeet ASR 訂閱
 *  - subtitleService — 字幕 stream 用 subscribe
 *  - storageService — saveLecture (status 翻 completed)
 *  - audioPathService — finalize .pcm → .wav
 *
 * 留白（NotesView 有但本 hook 不接 — 等 wiring audit）：
 *  - BatteryMonitor (低電量自動 stop)
 *  - recordingDeviceMonitor (麥克風變更提示)
 *  - recordingRecoveryService 標記 (已由 App.tsx scan)
 *  - alignment banner / unofficial channel warning
 *  - PDF + 投影片對齊
 *  - settings.translation.source/target language 從 storageService 讀
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AudioRecorder, type AudioRecorderStatus } from '../../services/audioRecorder';
import { transcriptionService } from '../../services/transcriptionService';
import { subtitleService } from '../../services/subtitleService';
import { audioDeviceService } from '../../services/audioDeviceService';
import { storageService } from '../../services/storageService';
import { toRelativeAudioPath } from '../../services/audioPathService';
import type { Lecture } from '../../types';
import type { SubtitleSegment } from '../../types/subtitle';

export type RecordingStatus = AudioRecorderStatus | 'stopping';

export type StopPhase =
    | 'idle'
    | 'transcribe' // flush transcription tail
    | 'segment'    // .pcm → .wav finalize
    | 'summary'    // (留白) AI summary trigger
    | 'index'      // (留白) RAG embedding
    | 'done';

/** Event dispatched on `window` whenever a lecture's recording status
 *  toggles (start/stop). H18DeepApp listens for this so it can refresh
 *  the active recording island instantly instead of waiting on the 4s
 *  poll. */
export const RECORDING_CHANGE_EVENT = 'classnote-lecture-recording-changed';

export interface UseRecordingSessionOpts {
    courseId: string;
    lectureId: string;
}

export interface RecordingSession {
    status: RecordingStatus;
    elapsed: number;
    segments: SubtitleSegment[];
    currentText: string;
    error: string | null;
    /** Current finalize phase while `status === 'stopping'`. */
    stopPhase: StopPhase;
    /** Wall-clock epoch ms when `start()` was called, or 0 before that.
     *  Subtract from `segment.startTime` (also epoch ms during live
     *  recording) to get a relative offset for display. */
    sessionStartMs: number;
    /** Start a fresh recording session (sets lecture status='recording'). */
    start: () => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    /** Stop + finalize. Resolves when WAV is on disk and lecture row is
     *  saved as 'completed'. */
    stop: () => Promise<void>;
}

export function useRecordingSession({
    courseId,
    lectureId,
}: UseRecordingSessionOpts): RecordingSession {
    const recorderRef = useRef<AudioRecorder | null>(null);
    const [status, setStatus] = useState<RecordingStatus>('idle');
    const [elapsed, setElapsed] = useState(0);
    const [segments, setSegments] = useState<SubtitleSegment[]>([]);
    const [currentText, setCurrentText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [stopPhase, setStopPhase] = useState<StopPhase>('idle');
    const startTimeRef = useRef<number>(0);

    // Lazy-create AudioRecorder
    const ensureRecorder = useCallback(() => {
        if (!recorderRef.current) {
            recorderRef.current = new AudioRecorder({});
        }
        return recorderRef.current;
    }, []);

    // Subscribe to subtitleService for live segments + currentText
    useEffect(() => {
        // initial state
        setSegments(subtitleService.getSegments());
        setCurrentText(subtitleService.getCurrentText());
        const unsub = subtitleService.subscribe((state) => {
            setSegments([...state.segments]);
            setCurrentText(state.currentText);
        });
        return unsub;
    }, []);

    // Tick when recording
    useEffect(() => {
        if (status !== 'recording') return;
        const id = setInterval(() => {
            const t0 = startTimeRef.current;
            if (t0 > 0) setElapsed(Math.floor((Date.now() - t0) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [status]);

    // Cleanup on unmount: stop recorder if still running so we don't leak mic
    useEffect(() => {
        return () => {
            const r = recorderRef.current;
            if (r) {
                try {
                    r.stop().catch(() => {});
                } catch {
                    /* swallow */
                }
            }
            try {
                transcriptionService.stop();
            } catch {
                /* swallow */
            }
        };
    }, []);

    const start = useCallback(async () => {
        try {
            setError(null);
            const recorder = ensureRecorder();

            // Mark lecture as recording (idempotent re-save)
            const lecture = await storageService.getLecture(lectureId);
            if (!lecture) throw new Error('找不到 lecture');
            if (lecture.status !== 'recording') {
                await storageService.saveLecture({
                    ...lecture,
                    status: 'recording',
                    updated_at: new Date().toISOString(),
                });
            }

            // Pick preferred input device
            try {
                const deviceId =
                    await audioDeviceService.preparePreferredInputDeviceForRecording();
                recorder.updateConfig({ deviceId });
            } catch (err) {
                console.warn('[useRecordingSession] pick device failed:', err);
            }

            // Reset subtitle stream
            subtitleService.clear();

            // Wire transcription
            transcriptionService.clear();
            transcriptionService.setLectureId(lectureId);
            try {
                const settings = await storageService.getAppSettings();
                const src = settings?.translation?.source_language || 'auto';
                const tgt = settings?.translation?.target_language || 'zh-TW';
                transcriptionService.setLanguages(src, tgt);
            } catch {
                transcriptionService.setLanguages('auto', 'zh-TW');
            }

            await transcriptionService.start();

            // ⚠ wire mic → ASR. Without this the audio never reaches
            // Parakeet and the subtitle stream stays empty even though
            // the recorder is happily flushing PCM to disk.
            // Legacy NotesView had this; the H18 hook lost it during
            // P6.5 extraction (silent regression — caught only when the
            // user noticed «雙語字幕» pane stayed blank during recording).
            recorder.onChunk((chunk) => {
                transcriptionService.addAudioChunk(chunk);
            });

            // Crash-safe persistence
            try {
                recorder.enablePersistence(lectureId);
            } catch (err) {
                console.warn('[useRecordingSession] enablePersistence failed:', err);
            }

            await recorder.start();
            startTimeRef.current = Date.now();
            setElapsed(0);
            setStatus('recording');
            window.dispatchEvent(
                new CustomEvent(RECORDING_CHANGE_EVENT, {
                    detail: { lectureId, courseId, kind: 'start' },
                }),
            );
        } catch (err) {
            console.error('[useRecordingSession] start failed:', err);
            setError(
                err instanceof Error ? err.message : String(err) || '錄音啟動失敗',
            );
            setStatus('error');
        }
    }, [ensureRecorder, lectureId]);

    const pause = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;
        try {
            await recorder.pause();
            setStatus('paused');
        } catch (err) {
            console.warn('[useRecordingSession] pause failed:', err);
        }
    }, []);

    const resume = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;
        try {
            await recorder.resume();
            setStatus('recording');
        } catch (err) {
            console.warn('[useRecordingSession] resume failed:', err);
        }
    }, []);

    const stop = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;
        setStatus('stopping');
        setStopPhase('transcribe');
        try {
            // Phase 1: stop transcription, drain in-memory tail
            transcriptionService.stop();

            // Snapshot in-memory WAV (NOT fatal if empty — .pcm on disk has it)
            let wav: ArrayBuffer | null = null;
            try {
                wav = await recorder.getWavData();
            } catch {
                /* okay */
            }

            await recorder.stop();

            // Phase 2: finalize .pcm → .wav (this is the real "segment" /
            // disk-write phase, not text segmentation per se)
            setStopPhase('segment');
            const audioDir = await invoke<string>('get_audio_dir');
            const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';
            const fullPath = `${audioDir}${sep}lecture_${lectureId}_${Date.now()}.wav`;

            let audioPath: string | null = null;
            try {
                const finalized = await recorder.finalizeToDisk(fullPath);
                if (finalized) audioPath = finalized;
            } catch (err) {
                console.warn('[useRecordingSession] finalizeToDisk failed:', err);
            }

            // In-memory fallback
            if (!audioPath && wav) {
                try {
                    await invoke('write_binary_file', {
                        path: fullPath,
                        data: Array.from(new Uint8Array(wav)),
                    });
                    audioPath = fullPath;
                } catch (err) {
                    console.warn('[useRecordingSession] in-memory fallback failed:', err);
                }
            }

            // Phase 3: persist lecture row → completed
            // (Real AI summary + RAG indexing live downstream — when those
            //  are wired this is where we'd `setStopPhase('summary')` and
            //  await llm.generateSummary, then 'index' for embedding.)
            setStopPhase('summary');
            const lecture = await storageService.getLecture(lectureId);
            const final: Lecture = {
                ...(lecture || {
                    id: lectureId,
                    course_id: courseId,
                    title: '新課堂',
                    date: new Date().toISOString(),
                    duration: 0,
                    status: 'completed',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    is_deleted: false,
                }),
                duration: Math.max(elapsed, lecture?.duration || 0),
                status: 'completed',
                audio_path: audioPath
                    ? toRelativeAudioPath(audioDir, audioPath)
                    : lecture?.audio_path,
                updated_at: new Date().toISOString(),
            };
            await storageService.saveLecture(final);

            setStopPhase('index');
            // No real RAG re-index in this hook — leaving the phase as
            // visual signal only. (App-level RAG service handles it
            // separately when summary/note tasks fire.)

            setStopPhase('done');
            setStatus('stopped');
            window.dispatchEvent(
                new CustomEvent(RECORDING_CHANGE_EVENT, {
                    detail: { lectureId, courseId, kind: 'stop' },
                }),
            );
        } catch (err) {
            console.error('[useRecordingSession] stop failed:', err);
            setError(err instanceof Error ? err.message : String(err) || '結束失敗');
            setStatus('stopped');
            setStopPhase('done');
            window.dispatchEvent(
                new CustomEvent(RECORDING_CHANGE_EVENT, {
                    detail: { lectureId, courseId, kind: 'stop' },
                }),
            );
        }
    }, [courseId, elapsed, lectureId]);

    return {
        status,
        elapsed,
        segments,
        currentText,
        error,
        stopPhase,
        sessionStartMs: startTimeRef.current,
        start,
        pause,
        resume,
        stop,
    };
}

export function fmtElapsed(seconds: number): string {
    if (seconds < 0 || !isFinite(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
