import { useState, useEffect } from "react";
import { Save, CheckCircle, RefreshCw, Download, Upload, AlertCircle } from "lucide-react";
import { AppSettings } from "../types";

import WhisperModelManager from './WhisperModelManager';
import TranslationModelManager from './TranslationModelManager';
import { remoteService } from "../services/remoteService";
import { storageService } from "../services/storageService";
import { audioDeviceService, AudioDevice } from "../services/audioDeviceService";

export default function SettingsView() {
  const [remoteServiceUrl, setRemoteServiceUrl] = useState<string>('');
  const [isRemoteServiceAvailable, setIsRemoteServiceAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [whisperModelPath, setWhisperModelPath] = useState<string>('');
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);

  // 加載音頻設備
  useEffect(() => {
    const loadAudioDevices = async () => {
      setIsLoadingDevices(true);
      try {
        const devices = await audioDeviceService.getAudioInputDevices();
        setAudioDevices(devices);
        
        // 設置默認設備
        const defaultDeviceId = audioDeviceService.getDefaultDeviceId();
        if (defaultDeviceId) {
          setSelectedDeviceId(defaultDeviceId);
        }
      } catch (error) {
        console.error('加載音頻設備失敗:', error);
        // 即使失敗也設置為空列表，避免頁面卡住
        setAudioDevices([]);
      } finally {
        setIsLoadingDevices(false);
      }
    };

    loadAudioDevices();

    // 監聽設備變化（如果可用）
    let cleanup: (() => void) | undefined;
    try {
      cleanup = audioDeviceService.onDeviceChange((devices) => {
        setAudioDevices(devices);
      });
    } catch (error) {
      console.warn('無法監聽設備變化:', error);
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  // 加載設置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // 從數據庫加載應用設置
        const savedSettings = await storageService.getAppSettings();
        if (savedSettings) {
          setSettings(savedSettings);
          
          // 設置音頻設備
          if (savedSettings.audio.device_id) {
            setSelectedDeviceId(savedSettings.audio.device_id);
          }
        }

        // 從本地存儲讀取遠程服務 URL（向後兼容）
        const savedUrl = localStorage.getItem('remoteServiceUrl') || '';
        if (savedUrl) {
          setRemoteServiceUrl(savedUrl);
          remoteService.setServiceUrl(savedUrl);
          remoteService.checkAvailability().then(available => {
            setIsRemoteServiceAvailable(available);
          });
        } else if (savedSettings?.server?.enabled) {
          // 如果數據庫中有設置，使用數據庫中的 URL
          const url = `${savedSettings.server.url}:${savedSettings.server.port}`;
          setRemoteServiceUrl(url);
          remoteService.setServiceUrl(url);
          remoteService.checkAvailability().then(available => {
            setIsRemoteServiceAvailable(available);
          });
        }

        // 加載模型路徑
        const whisperPath = await storageService.getSetting('whisper_model_path');
        if (whisperPath) {
          setWhisperModelPath(whisperPath);
        }

      } catch (error) {
        console.error('加載設置失敗:', error);
      }
    };

    loadSettings();
  }, []);

  const handleRemoteServiceUrlChange = async (url: string) => {
    setRemoteServiceUrl(url);
    localStorage.setItem('remoteServiceUrl', url);
    
    if (url.trim()) {
      remoteService.setServiceUrl(url);
      const available = await remoteService.checkAvailability();
      setIsRemoteServiceAvailable(available);
    } else {
      remoteService.setServiceUrl(null);
      setIsRemoteServiceAvailable(false);
    }
  };
  const [settings, setSettings] = useState<AppSettings>({
    server: {
      url: "http://localhost",
      port: 8080,
      enabled: false,
    },
    audio: {
      sample_rate: 16000,
      chunk_duration: 2,
    },
    subtitle: {
      font_size: 18,
      font_color: "#FFFFFF",
      background_opacity: 0.8,
      position: "bottom",
      display_mode: "both",
    },
    theme: "light",
  });

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      // 更新設置中的音頻設備 ID
      const updatedSettings: AppSettings = {
        ...settings,
        audio: {
          ...settings.audio,
          device_id: selectedDeviceId || undefined,
        },
      };

      // 保存應用設置到數據庫
      await storageService.saveAppSettings(updatedSettings);
      
      // 保存模型路徑
      if (whisperModelPath) {
        await storageService.saveSetting('whisper_model_path', whisperModelPath);
      }
      
      // 同時保存遠程服務 URL 到 localStorage（向後兼容）
      if (remoteServiceUrl) {
        localStorage.setItem('remoteServiceUrl', remoteServiceUrl);
      }

      // 更新音頻設備服務的默認設備
      if (selectedDeviceId) {
        audioDeviceService.setDefaultDevice(selectedDeviceId);
      }

      setSaveStatus('success');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (error) {
      console.error('保存設置失敗:', error);
      setSaveStatus('error');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    }
  };

  const handleRefreshDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const devices = await audioDeviceService.getAudioInputDevices();
      setAudioDevices(devices);
    } catch (error) {
      console.error('刷新設備列表失敗:', error);
      // 即使失敗也設置為空列表
      setAudioDevices([]);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const handleExportData = async () => {
    try {
      await storageService.exportDataToFile();
      setImportStatus({ success: true, message: '數據導出成功' });
      setTimeout(() => setImportStatus(null), 3000);
    } catch (error) {
      setImportStatus({ success: false, message: `導出失敗: ${error instanceof Error ? error.message : String(error)}` });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  const handleImportData = async () => {
    if (!confirm('導入數據將覆蓋現有數據，是否繼續？')) {
      return;
    }

    try {
      const result = await storageService.importDataFromFile();
      setImportStatus({
        success: true,
        message: `成功導入 ${result.imported} 個課程${result.errors.length > 0 ? `，${result.errors.length} 個錯誤` : ''}`,
      });
      setTimeout(() => setImportStatus(null), 5000);
    } catch (error) {
      setImportStatus({ success: false, message: `導入失敗: ${error instanceof Error ? error.message : String(error)}` });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">設置</h1>
          <div className="flex items-center gap-3">
            {saveStatus === 'success' && (
              <span className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
                <CheckCircle size={18} />
                保存成功
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-600 dark:text-red-400 text-sm">
                保存失敗
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              {saveStatus === 'saving' ? '保存中...' : '保存設置'}
            </button>
          </div>
        </div>

        {/* 遠程服務設置 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">遠程服務設置（精修功能）</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">遠程服務 URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="http://localhost:8000"
                  value={remoteServiceUrl}
                  onChange={(e) => handleRemoteServiceUrlChange(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                />
                {isRemoteServiceAvailable && (
                  <span className="flex items-center px-3 text-green-600 dark:text-green-400">
                    ✓ 可用
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                設置遠程服務 URL 以啟用精轉錄和精翻譯功能（可選）
              </p>
            </div>
          </div>
        </div>

        {/* 音頻設置 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">音頻設置</h2>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium">麥克風設備</label>
                <button
                  onClick={handleRefreshDevices}
                  disabled={isLoadingDevices}
                  className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                  title="刷新設備列表"
                >
                  <RefreshCw size={14} className={isLoadingDevices ? 'animate-spin' : ''} />
                  刷新
                </button>
              </div>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                disabled={isLoadingDevices}
              >
                {audioDevices.length === 0 ? (
                  <option value="">{isLoadingDevices ? '加載中...' : '無可用設備'}</option>
                ) : (
                  audioDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))
                )}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                選擇用於錄音的麥克風設備
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                採樣率: {settings.audio.sample_rate} Hz
              </label>
              <input
                type="range"
                min="8000"
                max="48000"
                step="8000"
                value={settings.audio.sample_rate}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    audio: { ...settings.audio, sample_rate: parseInt(e.target.value) },
                  })
                }
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Whisper 模型管理 */}
        <div className="mb-6">
          <WhisperModelManager
            onModelLoaded={() => {
              console.log('模型加載完成');
            }}
          />
        </div>

        {/* 翻譯模型管理 */}
        <div className="mb-6">
          <TranslationModelManager />
        </div>

        {/* 字幕設置 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">字幕設置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                字體大小: {settings.subtitle.font_size}px
              </label>
              <input
                type="range"
                min="12"
                max="24"
                value={settings.subtitle.font_size}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: { ...settings.subtitle, font_size: parseInt(e.target.value) },
                  })
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">顯示模式</label>
              <select
                value={settings.subtitle.display_mode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: { ...settings.subtitle, display_mode: e.target.value as any },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              >
                <option value="en">僅英文</option>
                <option value="zh">僅中文</option>
                <option value="both">中英對照</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">字幕位置</label>
              <select
                value={settings.subtitle.position}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: { ...settings.subtitle, position: e.target.value as any },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              >
                <option value="bottom">底部</option>
                <option value="top">頂部</option>
                <option value="floating">浮動</option>
              </select>
            </div>
          </div>
        </div>

        {/* 數據管理 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">數據管理</h2>
          <div className="space-y-4">
            {importStatus && (
              <div className={`flex items-center gap-2 p-3 rounded-lg ${
                importStatus.success 
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' 
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
                <AlertCircle size={18} />
                <span className="text-sm">{importStatus.message}</span>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleExportData}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <Download size={18} />
                導出數據
              </button>
              <button
                onClick={handleImportData}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Upload size={18} />
                導入數據
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              導出/導入所有課程、字幕、筆記和設置數據（JSON 格式）
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

