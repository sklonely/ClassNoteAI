import { useState, useEffect } from "react";
import { User, LogOut, Cloud, RefreshCw, Smartphone, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import { storageService } from "../services/storageService";
import { syncService } from "../services/syncService";
import { useAuth } from "../contexts/AuthContext";

interface ProfileViewProps {
    onClose?: () => void;
}

export default function ProfileView({ onClose }: ProfileViewProps) {
    const { user, logout } = useAuth();
    const [syncConfig, setSyncConfig] = useState({
        username: '',
        deviceId: '',
        deviceName: '',
        autoSync: false,
        lastSyncTime: ''
    });

    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);
    const [connectedDevices, setConnectedDevices] = useState<any[]>([]);
    const [isLoadingDevices, setIsLoadingDevices] = useState(false);
    const [serverUrl, setServerUrl] = useState('');

    // Load Settings
    useEffect(() => {
        const loadData = async () => {
            const settings = await storageService.getAppSettings();
            if (settings) {
                setServerUrl(settings.server?.url || '');
                if (settings.sync) {
                    setSyncConfig({
                        username: settings.sync.username,
                        deviceId: settings.sync.deviceId || '',
                        deviceName: settings.sync.deviceName || '',
                        autoSync: settings.sync.autoSync,
                        lastSyncTime: settings.sync.lastSyncTime || ''
                    });

                    if (settings.sync.username && settings.server?.url) {
                        refreshDevicesList(settings.server.url, settings.sync.username);
                    }
                }
            }
        };
        loadData();
    }, []);

    const refreshDevicesList = async (baseUrl: string, username: string) => {
        setIsLoadingDevices(true);
        try {
            const devices = await syncService.getDevices(baseUrl, username);
            setConnectedDevices(devices);
        } catch (error) {
            console.error('Fetch devices failed:', error);
        } finally {
            setIsLoadingDevices(false);
        }
    };

    const handleSyncNow = async () => {
        if (!user || !serverUrl) return;

        setIsSyncing(true);
        setSyncMessage(null);
        try {


            // Use configured URL usually
            await syncService.sync(serverUrl, user.username);

            const now = new Date().toISOString();
            setSyncConfig(prev => ({ ...prev, lastSyncTime: now }));
            setSyncMessage('同步成功');

            // Update Settings
            const currentSettings = await storageService.getAppSettings();
            if (currentSettings) {
                await storageService.saveAppSettings({
                    ...currentSettings,
                    sync: { ...currentSettings.sync!, lastSyncTime: now }
                });
            }

            await refreshDevicesList(serverUrl, user.username);

        } catch (error) {
            console.error("同步失敗", error);
            setSyncMessage(`同步失敗: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsSyncing(false);
            setTimeout(() => setSyncMessage(null), 5000);
        }
    };

    const handleRemoveDevice = async (deviceId: string) => {
        if (!confirm('確定要移除此設備嗎？該設備將無法再同步數據。')) return;
        try {
            await syncService.deleteDevice(serverUrl, deviceId);
            if (user) refreshDevicesList(serverUrl, user.username);
        } catch (error) {
            alert('移除設備失敗: ' + error);
        }
    };

    const handleAutoSyncToggle = async (enabled: boolean) => {
        setSyncConfig(prev => ({ ...prev, autoSync: enabled }));
        const currentSettings = await storageService.getAppSettings();
        if (currentSettings && currentSettings.sync) {
            await storageService.saveAppSettings({
                ...currentSettings,
                sync: { ...currentSettings.sync, autoSync: enabled }
            });
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-bold">個人中心</h2>
                    <p className="text-gray-500 dark:text-gray-400">管理您的帳戶與同步設定</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                        關閉
                    </button>
                )}
            </div>

            {/* User Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-300">
                            <User size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold">{user?.username || '未登錄'}</h3>
                            <p className="text-sm text-gray-500">上次登錄: {user?.last_login ? new Date(user.last_login).toLocaleString() : '-'}</p>
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-red-200 dark:border-red-800"
                    >
                        <LogOut size={18} />
                        <span>登出</span>
                    </button>
                </div>
            </div>

            {/* Sync Status */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                    <h3 className="text-lg font-medium flex items-center gap-2">
                        <Cloud className="w-5 h-5 text-blue-500" />
                        雲端同步
                    </h3>
                </div>
                <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div>
                            <div className="font-medium">同步狀態</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                上次同步: {syncConfig.lastSyncTime ? new Date(syncConfig.lastSyncTime).toLocaleString() : '從未同步'}
                            </div>
                            {syncMessage && (
                                <div className={`text-sm mt-2 flex items-center gap-1 ${syncMessage.includes('失敗') ? 'text-red-500' : 'text-green-500'}`}>
                                    {syncMessage.includes('失敗') ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
                                    {syncMessage}
                                </div>
                            )}
                        </div>
                        <button
                            onClick={handleSyncNow}
                            disabled={isSyncing || !serverUrl}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
                            <span>{isSyncing ? '同步中...' : '立即同步'}</span>
                        </button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium">自動同步</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                應用啟動時自動同步數據
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={syncConfig.autoSync}
                                onChange={(e) => handleAutoSyncToggle(e.target.checked)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Connected Devices */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50 flex justify-between items-center">
                    <h3 className="text-lg font-medium flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-purple-500" />
                        已連接設備
                    </h3>
                    <button
                        onClick={() => user && serverUrl && refreshDevicesList(serverUrl, user.username)}
                        className="text-sm text-blue-500 hover:text-blue-600"
                    >
                        刷新列表
                    </button>
                </div>
                <div className="p-6">
                    {isLoadingDevices ? (
                        <div className="text-center py-4 text-gray-500">加載中...</div>
                    ) : connectedDevices.length === 0 ? (
                        <div className="text-center py-4 text-gray-500">無已連接設備</div>
                    ) : (
                        <div className="space-y-3">
                            {connectedDevices.map((device: any) => (
                                <div key={device.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                                            <Smartphone size={20} className="text-gray-500 dark:text-gray-400" />
                                        </div>
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                {device.name}
                                                {device.id === syncConfig.deviceId && (
                                                    <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
                                                        當前設備
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                上次活躍: {new Date(device.last_seen).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                    {device.id !== syncConfig.deviceId && (
                                        <button
                                            onClick={() => handleRemoveDevice(device.id)}
                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="移除設備"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
