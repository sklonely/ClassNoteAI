import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { toastService, type Toast, type ToastType } from '../services/toastService';

/**
 * Top-right stacked toast renderer. Mounted once at the App root; all
 * code anywhere in the app uses `toastService.success('...')` etc. to
 * post a toast. Replaces the scattered `alert()` calls that each
 * blocked the UI thread.
 *
 * Positioning: `fixed top-4 right-4 z-50` — sits above everything
 * including modals, doesn't push layout around. Toasts animate in
 * from the top with `animate-in slide-in-from-top`. Stacked vertically
 * with 0.5rem gap.
 *
 * Accessibility: each toast is a `role="status"` region so screen
 * readers announce it. Dismiss button is an actual `<button>` with
 * aria-label.
 */

const ICON_BY_TYPE: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />,
    info: <Info className="w-5 h-5 text-blue-500 shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />,
};

const RING_BY_TYPE: Record<ToastType, string> = {
    success: 'border-green-200 dark:border-green-900/40',
    error: 'border-red-200 dark:border-red-900/40',
    info: 'border-blue-200 dark:border-blue-900/40',
    warning: 'border-amber-200 dark:border-amber-900/40',
};

export default function ToastContainer() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    useEffect(() => {
        return toastService.subscribe(setToasts);
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed top-4 right-4 z-100 flex flex-col gap-2 max-w-sm pointer-events-none"
            aria-live="polite"
            aria-atomic="false"
        >
            {toasts.map((t) => (
                <div
                    key={t.id}
                    role="status"
                    className={`pointer-events-auto flex items-start gap-3 p-3 pr-2 rounded-lg border bg-white dark:bg-slate-900 shadow-lg animate-in slide-in-from-top-2 fade-in duration-200 ${RING_BY_TYPE[t.type]}`}
                >
                    {ICON_BY_TYPE[t.type]}
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 wrap-break-word">
                            {t.message}
                        </div>
                        {t.detail && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 wrap-break-word">
                                {t.detail}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => toastService.dismiss(t.id)}
                        className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                        aria-label="關閉通知"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
    );
}
