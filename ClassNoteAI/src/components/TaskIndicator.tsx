import { useState, useEffect, useRef } from "react";
import { Cloud, Loader2, CheckCircle2, Upload, WifiOff, Wifi } from "lucide-react";
import { offlineQueueService, PendingAction } from "../services/offlineQueueService";

/**
 * Bottom-right status indicator. Surfaces two signals:
 *   - current offline-queue state (sync pushes, etc.)
 *   - network availability
 *
 * v0.4.x also showed "server-side AI tasks" here; with v0.5.0 moving
 * LLM work client-side and retiring ClassNoteServer, that section is
 * gone.
 */
export default function TaskIndicator() {
    const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        const loadPending = async () => {
            await offlineQueueService.init();
            const actions = await offlineQueueService.listActions();
            setPendingActions(
                actions.filter(
                    (a) => a.status === 'pending' || a.status === 'failed' || a.status === 'processing'
                )
            );
        };
        loadPending();
        return offlineQueueService.subscribe(loadPending);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const hasPending = pendingActions.length > 0;
    const hasActivity = hasPending;
    const totalCount = pendingActions.length;

    const getActionLabel = (type: string) => {
        switch (type) {
            case 'SYNC_PUSH': return '同步上傳';
            case 'SYNC_PULL': return '同步下載';
            case 'DEVICE_REGISTER': return '裝置註冊';
            case 'DEVICE_DELETE': return '移除裝置';
            case 'AUTH_REGISTER': return '用戶註冊';
            case 'PURGE_ITEM': return '永久刪除';
            default: return type;
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${hasActivity
                    ? "text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    }`}
                title={hasActivity ? `${totalCount} Active Items` : "No Active Tasks"}
            >
                {hasActivity ? (
                    <Loader2 className="animate-spin" size={20} />
                ) : isOnline ? (
                    <Cloud size={20} className="text-gray-400" />
                ) : (
                    <WifiOff size={20} className="text-orange-500" />
                )}
                {hasActivity && <span className="text-sm font-medium">{totalCount}</span>}
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-slate-800/50">
                        <h3 className="font-medium text-sm text-gray-700 dark:text-gray-200">任務狀態</h3>
                        <div className="flex items-center gap-2">
                            {isOnline ? (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                    <Wifi size={12} /> 在線
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-xs text-orange-500">
                                    <WifiOff size={12} /> 離線
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {hasPending && (
                            <>
                                <div className="px-4 py-2 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800">
                                    <div className="flex items-center gap-2 text-xs text-orange-700 dark:text-orange-300">
                                        <Upload size={14} />
                                        <span>待上傳 ({pendingActions.length})</span>
                                    </div>
                                </div>
                                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {pendingActions.map((action) => (
                                        <li key={action.id} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                                    {getActionLabel(action.actionType)}
                                                </span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${action.status === 'failed'
                                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                                                    : 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                                                    }`}>
                                                    {action.status === 'failed' ? '失敗' : '待處理'}
                                                </span>
                                            </div>
                                            {action.retryCount > 0 && (
                                                <span className="text-xs text-gray-400">重試: {action.retryCount}/3</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}

                        {!hasActivity && (
                            <div className="p-8 text-center text-gray-500 flex flex-col items-center gap-2">
                                <CheckCircle2 size={32} className="text-green-500 opacity-50" />
                                <p className="text-sm">無待處理項目</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
