import React, { useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward } from 'lucide-react';

interface AudioPlayerProps {
    audioUrl?: string; // URL for the audio file (blob or remote)
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    volume: number;
    onPlayPause: () => void;
    onSeek: (time: number) => void;
    onVolumeChange: (volume: number) => void;
    onSkip?: (seconds: number) => void;
}

export default function AudioPlayer({
    // audioUrl,
    currentTime,
    duration,
    isPlaying,
    volume,
    onPlayPause,
    onSeek,
    onVolumeChange,
    onSkip
}: AudioPlayerProps) {
    const progressBarRef = useRef<HTMLDivElement>(null);

    const formatTime = (seconds: number) => {
        if (!isFinite(seconds) || isNaN(seconds)) return "00:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!progressBarRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        onSeek(percentage * duration);
    };

    return (
        <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 p-4 shadow-lg z-20">
            <div className="max-w-4xl mx-auto flex flex-col gap-2">
                {/* Progress Bar */}
                <div
                    ref={progressBarRef}
                    className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer relative group"
                    onClick={handleProgressBarClick}
                >
                    <div
                        className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-100"
                        style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                    />
                    {/* Hover Effect */}
                    <div className="absolute top-0 left-0 h-full w-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="h-full bg-blue-500/20 rounded-full" />
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="text-sm font-mono text-gray-500 dark:text-gray-400 w-20">
                        {formatTime(currentTime)}
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => onSkip?.(-10)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300 transition-colors"
                            title="Rewind 10s"
                        >
                            <SkipBack size={20} />
                        </button>

                        <button
                            onClick={onPlayPause}
                            className="p-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-md hover:shadow-lg transition-all transform active:scale-95"
                        >
                            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                        </button>

                        <button
                            onClick={() => onSkip?.(10)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300 transition-colors"
                            title="Forward 10s"
                        >
                            <SkipForward size={20} />
                        </button>
                    </div>

                    <div className="flex items-center gap-3 w-32 justify-end group relative">
                        <button
                            onClick={() => onVolumeChange(volume === 0 ? 100 : 0)}
                            className="text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                        >
                            {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={volume}
                            onChange={(e) => onVolumeChange(Number(e.target.value))}
                            className="w-20 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <div className="text-xs text-gray-400 w-8 text-right">
                            {formatTime(duration)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
