/**
 * H18AudioPlayer · v0.7.0 Phase 6.4
 *
 * 對應 docs/design/h18-deep/h18-review-page.jsx L195-435 (H18AudioPlayer).
 * 底部 52px sticky audio bar。
 *
 * 跟 prototype 不同：用真的 <audio> element（不是模擬時間軸）。
 * Props 受控 currentTime / isPlaying — 父元件可以監聽 progress 餵
 * 給 transcript auto-follow。
 */

import { useEffect, useRef, useState } from 'react';
import s from './H18AudioPlayer.module.css';

const SPEED_OPTIONS = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

export interface H18AudioPlayerProps {
    src: string;
    lectureTitle: string;
    /** Notify parent of progress changes for transcript auto-follow. */
    onTimeUpdate?: (seconds: number) => void;
    /** Optional external seek requests (e.g. clicking transcript line). */
    seekTo?: number | null;
    onClose: () => void;
}

function fmtTime(s: number): string {
    if (!isFinite(s) || s < 0) return '00:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function IconPlay() {
    return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 4 L16 10 L5 16 Z" />
        </svg>
    );
}

function IconPause() {
    return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <rect x="5" y="4" width="4" height="12" rx="1" />
            <rect x="11" y="4" width="4" height="12" rx="1" />
        </svg>
    );
}

function IconSkipBack() {
    return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M11 5 L4 10 L11 15 Z" />
            <rect x="12" y="5" width="2" height="10" rx="0.5" />
        </svg>
    );
}

function IconSkipForward() {
    return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 5 L16 10 L9 15 Z" />
            <rect x="6" y="5" width="2" height="10" rx="0.5" />
        </svg>
    );
}

export default function H18AudioPlayer({
    src,
    lectureTitle,
    onTimeUpdate,
    seekTo,
    onClose,
}: H18AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
    const [error, setError] = useState<string | null>(null);

    // Wire <audio> element events
    useEffect(() => {
        const a = audioRef.current;
        if (!a) return;
        const onTime = () => {
            setCurrentTime(a.currentTime);
            onTimeUpdate?.(a.currentTime);
        };
        const onDur = () => setDuration(a.duration || 0);
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onEnded = () => setIsPlaying(false);
        const onErr = () => {
            setError('音訊載入失敗 — 檔案可能被刪除或路徑無法解析');
            setIsPlaying(false);
        };
        a.addEventListener('timeupdate', onTime);
        a.addEventListener('loadedmetadata', onDur);
        a.addEventListener('durationchange', onDur);
        a.addEventListener('play', onPlay);
        a.addEventListener('pause', onPause);
        a.addEventListener('ended', onEnded);
        a.addEventListener('error', onErr);
        return () => {
            a.removeEventListener('timeupdate', onTime);
            a.removeEventListener('loadedmetadata', onDur);
            a.removeEventListener('durationchange', onDur);
            a.removeEventListener('play', onPlay);
            a.removeEventListener('pause', onPause);
            a.removeEventListener('ended', onEnded);
            a.removeEventListener('error', onErr);
        };
    }, [onTimeUpdate]);

    // playback rate sync
    useEffect(() => {
        if (audioRef.current) audioRef.current.playbackRate = speed;
    }, [speed]);

    // external seek
    useEffect(() => {
        if (seekTo == null || !audioRef.current) return;
        try {
            audioRef.current.currentTime = seekTo;
        } catch (err) {
            console.warn('[H18AudioPlayer] seek failed:', err);
        }
    }, [seekTo]);

    const togglePlay = () => {
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) {
            void a.play().catch((err) => {
                console.warn('[H18AudioPlayer] play() rejected:', err);
                setError('播放被拒絕 — 點擊一次以授權');
            });
        } else {
            a.pause();
        }
    };

    const skip = (delta: number) => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = Math.max(0, Math.min(duration, a.currentTime + delta));
    };

    const cycleSpeed = () => {
        const idx = SPEED_OPTIONS.indexOf(speed);
        setSpeed(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
    };

    const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const a = audioRef.current;
        if (!a || duration <= 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        a.currentTime = pct * duration;
    };

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className={s.bar}>
            <audio ref={audioRef} src={src} preload="metadata" />

            <div className={s.context}>
                <div className={s.contextEyebrow}>▶ NOW PLAYING</div>
                <div className={s.contextTitle} title={lectureTitle}>
                    {lectureTitle}
                </div>
            </div>

            <button
                type="button"
                onClick={() => skip(-10)}
                className={s.btnSm}
                title="倒退 10 秒"
                aria-label="倒退"
                disabled={!!error}
            >
                <IconSkipBack />
            </button>

            <button
                type="button"
                onClick={togglePlay}
                className={s.btnPlay}
                title={isPlaying ? '暫停' : '播放'}
                aria-label={isPlaying ? '暫停' : '播放'}
                disabled={!!error}
            >
                {isPlaying ? <IconPause /> : <IconPlay />}
            </button>

            <button
                type="button"
                onClick={() => skip(10)}
                className={s.btnSm}
                title="前進 10 秒"
                aria-label="前進"
                disabled={!!error}
            >
                <IconSkipForward />
            </button>

            <span className={s.time}>{fmtTime(currentTime)}</span>

            {error ? (
                <div className={s.errorBar} title={error}>
                    {error}
                </div>
            ) : (
                <div className={s.progress} onClick={onProgressClick}>
                    <div className={s.progressFill} style={{ width: `${progressPct}%` }} />
                </div>
            )}

            <span className={`${s.time} ${s.timeDim}`}>{fmtTime(duration)}</span>

            <button
                type="button"
                onClick={cycleSpeed}
                className={s.speed}
                title="播放速度"
            >
                {speed}×
            </button>

            <button
                type="button"
                onClick={onClose}
                className={s.btnSm}
                title="關閉播放器"
                aria-label="關閉"
            >
                ✕
            </button>
        </div>
    );
}
