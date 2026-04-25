import { useEffect, useRef, useState } from 'react';
import { Film, ClipboardPaste, X, Loader2, ArrowLeft } from 'lucide-react';
import { useTauriFileDrop } from '../hooks/useTauriFileDrop';
import { storageService } from '../services/storageService';

/**
 * v0.6.0 — unified "匯入" entry point for the Notes view.
 *
 * Replaces the standalone "匯入影片" button with a modal that offers
 * two matched paths:
 *   1. Import a local video file (ffmpeg → Whisper → CT2 → RAG).
 *   2. Paste subtitle text for courses that block video download but
 *      expose captions (SRT/VTT/plain text supported).
 *
 * The modal is also a drop zone: dragging a video file anywhere over
 * it jumps straight into the import flow.
 */

type Mode = 'menu' | 'paste';

export type SubtitleLanguage = 'en' | 'zh';

export interface PasteSubmission {
    rawText: string;
    language: SubtitleLanguage;
    translateToChinese: boolean;
}

export type VideoLanguage = 'auto' | 'en' | 'zh';
export type VideoQuality = 'fast' | 'standard';

export interface VideoImportOptions {
    language: VideoLanguage;
    quality: VideoQuality;
    /** Run the LLM-backed fine refinement pass after rough transcribe
     *  + CT2 translate. Default OFF because a 70-min lecture spends
     *  ~130k tokens on this pass, and cloud providers charge per token
     *  (GitHub Models free tier rate-limits). Users who have a local
     *  LLM or are OK burning tokens can toggle it on. */
    refineWithAI: boolean;
}

interface Props {
    open: boolean;
    /** Busy state (video import running) — disables interaction + closes. */
    isBusy: boolean;
    /** Progress message shown at the bottom while busy. */
    progressMessage?: string;
    onClose: () => void;
    /** User clicked "匯入影片檔" → run the native file picker. */
    onPickVideo: (options: VideoImportOptions) => void;
    /** User dropped a video file directly onto the modal. */
    onDropVideo: (path: string, options: VideoImportOptions) => void;
    /** User filled in the paste form and hit confirm. */
    onSubmitPaste: (submission: PasteSubmission) => void;
}

const MEDIA_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|wav|mp3|m4a|aac|flac|ogg|opus)$/i;

export default function ImportModal({
    open,
    isBusy,
    progressMessage,
    onClose,
    onPickVideo,
    onDropVideo,
    onSubmitPaste,
}: Props) {
    const [mode, setMode] = useState<Mode>('menu');
    const [pasteText, setPasteText] = useState('');
    const [pasteLang, setPasteLang] = useState<SubtitleLanguage>('en');
    const [translate, setTranslate] = useState(true);
    const [videoLang, setVideoLang] = useState<VideoLanguage>('auto');
    const [videoQuality, setVideoQuality] = useState<VideoQuality>('fast');
    const [refineWithAI, setRefineWithAI] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    // Load user's experimental-settings defaults once per mount. The
    // modal is mounted once and stays resident across opens, so a
    // single read covers the lifetime. Changing defaults in Settings
    // only takes effect on the next app load — intentional; we don't
    // want a settings change to silently overwrite a user's mid-modal
    // picks if they had it open at the time.
    useEffect(() => {
        (async () => {
            try {
                const s = await storageService.getAppSettings();
                const exp = s?.experimental;
                if (exp?.importSpeed) setVideoQuality(exp.importSpeed as VideoQuality);
                if (typeof exp?.importAiRefine === 'boolean') setRefineWithAI(exp.importAiRefine);
            } catch {
                /* stick with hardcoded defaults */
            }
        })();
    }, []);

    // Modal is its own drop zone — takes priority over the NotesView
    // drop zone below it because elementFromPoint returns the topmost
    // element, which is the modal while it's mounted.
    useTauriFileDrop({
        zoneRef: modalRef,
        enabled: open && !isBusy,
        onDrop: (paths) => {
            const video = paths.find((p) => MEDIA_EXT.test(p));
            if (video) {
                onDropVideo(video, {
                    language: videoLang,
                    quality: videoQuality,
                    refineWithAI,
                });
            }
        },
    });

    if (!open) return null;

    const handleClose = () => {
        if (isBusy) return;
        setMode('menu');
        setPasteText('');
        onClose();
    };

    const handlePasteSubmit = () => {
        if (!pasteText.trim()) return;
        onSubmitPaste({
            rawText: pasteText,
            language: pasteLang,
            translateToChinese: pasteLang === 'en' && translate,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                ref={modalRef}
                className="w-full max-w-2xl mx-4 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {mode === 'paste' && !isBusy && (
                            <button
                                onClick={() => setMode('menu')}
                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500"
                                title="返回"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        )}
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            {mode === 'menu' ? '匯入已錄製的課程' : '貼上字幕'}
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isBusy}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="關閉"
                    >
                        <X size={18} />
                    </button>
                </div>

                {mode === 'menu' && (
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button
                                onClick={() =>
                                    onPickVideo({
                                        language: videoLang,
                                        quality: videoQuality,
                                        refineWithAI,
                                    })
                                }
                                disabled={isBusy}
                                className="flex flex-col items-center text-center p-6 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Film size={36} className="text-purple-500 mb-2" />
                                <div className="font-medium text-gray-900 dark:text-gray-100">
                                    匯入影片檔
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                                    選擇或拖入 .mp4 / .mkv / .webm
                                    等檔案<br />
                                    自動抽音、轉錄、翻譯、建立 AI 助教索引
                                </div>
                            </button>
                            <button
                                onClick={() => setMode('paste')}
                                disabled={isBusy}
                                className="flex flex-col items-center text-center p-6 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ClipboardPaste size={36} className="text-blue-500 mb-2" />
                                <div className="font-medium text-gray-900 dark:text-gray-100">
                                    貼上字幕
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                                    課程不給下載但可複製字幕時<br />
                                    支援 SRT / VTT / 純文字
                                </div>
                            </button>
                        </div>
                        {/* Video-import options. Applies to both the
                            click-pick path and the drop path. Quality
                            defaults to 'fast' because bulk transcription
                            on CPU with the standard (large/turbo) model
                            runs at ~1x realtime — a 70-min video is
                            ~70 min of CPU. Base is ~5x faster and
                            accurate enough for English lectures; users
                            who need maximum accuracy can flip back. */}
                        <div className="space-y-2 pt-1">
                            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                <span className="min-w-[4rem]">轉錄速度：</span>
                                <select
                                    value={videoQuality}
                                    onChange={(e) =>
                                        setVideoQuality(e.target.value as VideoQuality)
                                    }
                                    disabled={isBusy}
                                    className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                >
                                    <option value="fast">快速（base 模型，約 5–10 分鐘/小時）</option>
                                    <option value="standard">標準（依設定，約 30–60 分鐘/小時）</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                <span className="min-w-[4rem]">影片語言：</span>
                                <select
                                    value={videoLang}
                                    onChange={(e) =>
                                        setVideoLang(e.target.value as VideoLanguage)
                                    }
                                    disabled={isBusy}
                                    className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                >
                                    <option value="auto">自動偵測</option>
                                    <option value="en">英文</option>
                                    <option value="zh">中文</option>
                                </select>
                                <span className="text-gray-400">
                                    自動偵測偶爾會失準 — 若已知語言建議直接指定
                                </span>
                            </div>
                            {/* AI 精修 toggle. Default OFF because a
                                70-min lecture consumes ~130k tokens through
                                the user's configured LLM provider, which
                                is real money on OpenAI/Claude and hits
                                rate limits on GitHub Models free tier.
                                Users who want it can opt in; warning copy
                                below makes the cost visible up-front. */}
                            <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400 pt-1">
                                <input
                                    type="checkbox"
                                    checked={refineWithAI}
                                    onChange={(e) => setRefineWithAI(e.target.checked)}
                                    disabled={isBusy}
                                    className="mt-0.5 accent-indigo-500"
                                />
                                <span>
                                    <span className="font-medium text-gray-700 dark:text-gray-300">
                                        使用 AI 精修字幕
                                    </span>
                                    <span className="block text-gray-400 dark:text-gray-500 mt-0.5">
                                        粗翻譯完成後再請 LLM 修正 ASR 錯誤 + 產生自然中文。
                                        <span className="text-amber-600 dark:text-amber-500">
                                            預估 1 小時影片約 130k tokens（GPT-4o ≈ $1、Claude Sonnet ≈ $1.5、GitHub Models 免費但可能撞 rate limit）
                                        </span>
                                        。預設關閉。
                                    </span>
                                </span>
                            </label>
                        </div>
                    </div>
                )}

                {mode === 'paste' && (
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                字幕內容
                            </label>
                            <textarea
                                value={pasteText}
                                onChange={(e) => setPasteText(e.target.value)}
                                disabled={isBusy}
                                placeholder={
                                    '支援 SRT：\n1\n00:00:01,000 --> 00:00:04,000\nHello, welcome.\n\n' +
                                    '或 VTT、或純文字段落（無時間戳會平均分配）'
                                }
                                className="w-full h-56 px-3 py-2 text-sm font-mono rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            />
                        </div>
                        <div className="flex items-center gap-6 flex-wrap">
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-700 dark:text-gray-300">
                                    字幕語言：
                                </label>
                                <select
                                    value={pasteLang}
                                    onChange={(e) => setPasteLang(e.target.value as SubtitleLanguage)}
                                    disabled={isBusy}
                                    className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                >
                                    <option value="en">英文</option>
                                    <option value="zh">中文</option>
                                </select>
                            </div>
                            {pasteLang === 'en' && (
                                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={translate}
                                        onChange={(e) => setTranslate(e.target.checked)}
                                        disabled={isBusy}
                                    />
                                    翻譯成中文（本機 CT2 模型）
                                </label>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setMode('menu')}
                                disabled={isBusy}
                                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={handlePasteSubmit}
                                disabled={isBusy || !pasteText.trim()}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isBusy && <Loader2 size={14} className="animate-spin" />}
                                確認匯入
                            </button>
                        </div>
                    </div>
                )}

                {isBusy && (
                    <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800/30 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Loader2 size={14} className="animate-spin text-blue-500" />
                        {progressMessage || '處理中…'}
                    </div>
                )}
                {!isBusy && mode === 'menu' && (
                    <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800/30 text-[11px] text-gray-500 dark:text-gray-400">
                        提示：影片檔可以直接拖入此視窗
                    </div>
                )}
            </div>
        </div>
    );
}
