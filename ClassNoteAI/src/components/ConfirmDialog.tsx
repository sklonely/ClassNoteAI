import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { confirmService } from '../services/confirmService';

/**
 * Global themed confirm dialog. Mounted once at the App root (next to
 * ToastContainer) and subscribes to `confirmService` — when any caller
 * awaits `confirmService.ask(...)`, this renders a backdrop + card
 * matching the dark/purple design system. Replaces every
 * `window.confirm(...)` call; native OS dialog broke the visual
 * consistency of the app (white OS chrome, system font, wrong position).
 *
 * Dismissal paths:
 *   - 「取消」 button, Escape key, backdrop click  → resolve(false)
 *   - 「確定」/ confirmLabel button, Enter key     → resolve(true)
 */
export default function ConfirmDialog() {
    const [active, setActive] = useState(confirmService.current());

    useEffect(() => confirmService.subscribe(setActive), []);

    useEffect(() => {
        if (!active) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') confirmService.dismiss();
            else if (e.key === 'Enter') confirmService.accept();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active?.id]);

    if (!active) return null;

    const variant = active.variant ?? 'default';
    const confirmBtn =
        variant === 'danger'
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-blue-500 hover:bg-blue-600 text-white';
    const iconTint = variant === 'danger' ? 'text-red-500' : 'text-amber-500';

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => confirmService.dismiss()}
        >
            <div
                className="w-full max-w-md mx-4 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                    <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${iconTint}`} />
                    <h2 className="flex-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                        {active.title}
                    </h2>
                    <button
                        onClick={() => confirmService.dismiss()}
                        className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500"
                        title="關閉"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {active.message}
                </div>
                <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800/40 flex justify-end gap-2">
                    <button
                        onClick={() => confirmService.dismiss()}
                        className="px-4 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        {active.cancelLabel ?? '取消'}
                    </button>
                    <button
                        onClick={() => confirmService.accept()}
                        className={`px-4 py-1.5 text-sm rounded-md transition-colors ${confirmBtn}`}
                        autoFocus
                    >
                        {active.confirmLabel ?? '確定'}
                    </button>
                </div>
            </div>
        </div>
    );
}
