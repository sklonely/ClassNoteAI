import { useState, useEffect } from "react";
import { Save, CheckCircle, RefreshCw, Download, Upload, AlertCircle, Mic, Languages, Type, Database, Cpu, Info, Server, Brain, ChevronRight, Trash2 } from "lucide-react";
import { AppSettings } from "../types";
import { getVersion } from "@tauri-apps/api/app";

import WhisperModelManager from './WhisperModelManager';
import TranslationModelManager from './TranslationModelManager';
import { ollamaService, OllamaModel } from "../services/ollamaService";

import { storageService } from "../services/storageService";
import { audioDeviceService, AudioDevice } from "../services/audioDeviceService";



interface SettingsViewProps {
  onClose?: () => void;
}

export default function SettingsView({ }: SettingsViewProps) {

  // ... (keep existing state)


  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [whisperModelPath, setWhisperModelPath] = useState<string>('');
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);


  // AI & Server Configuration
  const [aiServerHost, setAiServerHost] = useState("http://100.117.82.111");
  const [ollamaModel, setOllamaModel] = useState("qwen3:235b-a22b");
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
  const [taskServerStatus, setTaskServerStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');

  // AI 模型分層配置
  const [aiModelConfig, setAiModelConfig] = useState({
    embedding: 'nomic-embed-text',
    light: 'qwen3:8b',       // 輕量任務：關鍵詞提取、對話壓縮
    standard: 'qwen3:8b',    // 標準任務：RAG 問答、AI 助教
    heavy: 'qwen3:235b-a22b' // 重量任務：課程總結
  });

  // 同步配置


  // Auth State


  // ... (省略中間代碼)

  // 自動保存 Ollama 設定
  useEffect(() => {
    // 避免在初始加載時觸發保存
    if (ollamaStatus === 'unknown' && taskServerStatus === 'unknown') return;

    const autoSave = async () => {
      try {
        const currentSettings = await storageService.getAppSettings();
        if (!currentSettings) return;

        // 構建完整的 Host URL
        const cleanHost = aiServerHost.replace(/\/$/, ''); // 移除結尾斜線
        const fullOllamaHost = `${cleanHost}:11434`;
        const fullServerUrl = `${cleanHost}:3001`;

        // 檢查是否真的有變化
        const currentAiModels = currentSettings.ollama?.aiModels;
        const aiModelsChanged = !currentAiModels ||
          currentAiModels.embedding !== aiModelConfig.embedding ||
          currentAiModels.light !== aiModelConfig.light ||
          currentAiModels.standard !== aiModelConfig.standard ||
          currentAiModels.heavy !== aiModelConfig.heavy;



        if (currentSettings.ollama?.host === fullOllamaHost &&
          currentSettings.server?.url === fullServerUrl &&
          currentSettings.ollama?.model === ollamaModel &&
          !aiModelsChanged) {
          return;
        }

        const updatedSettings: AppSettings = {
          ...currentSettings,
          ollama: {
            host: fullOllamaHost,
            model: ollamaModel,
            enabled: ollamaStatus === 'connected',
            aiModels: aiModelConfig
          },
          server: {
            ...currentSettings.server,
            url: fullServerUrl,
            port: 3001,
            enabled: taskServerStatus === 'connected'
          }
        };
        await storageService.saveAppSettings(updatedSettings);
        console.log('[SettingsView] AI settings auto-saved');
      } catch (error) {
        console.error('[SettingsView] Auto-save failed:', error);
      }
    };

    const timer = setTimeout(autoSave, 1000); // Debounce 1s
    return () => clearTimeout(timer);
  }, [aiServerHost, ollamaModel, ollamaStatus, taskServerStatus, aiModelConfig]);

  const checkUnifiedConnection = async (host: string) => {
    setIsCheckingConnection(true);
    setOllamaStatus('unknown');
    setTaskServerStatus('unknown');

    const cleanHost = host.replace(/\/$/, ''); // 移除結尾斜線

    // 1. Check Ollama (:11434)
    const checkOllama = async () => {
      try {
        const ollamaUrl = `${cleanHost}:11434`;
        const models = await ollamaService.listModels(ollamaUrl);
        setOllamaModels(models);
        setOllamaStatus('connected');

        if (models.length > 0 && !ollamaModel) {
          setOllamaModel(models[0].name);
        }
      } catch (error) {
        console.error('Ollama 連接失敗:', error);
        setOllamaStatus('error');
        setOllamaModels([]);
      }
    };

    // 2. Check Task Server (:3001)
    const checkServer = async () => {
      try {
        const serverUrl = `${cleanHost}:3001`;
        // Check health endpoint
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        try {
          await fetch(`${serverUrl}/health`, { signal: controller.signal });
          setTaskServerStatus('connected');
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        console.error('Task Server 連接失敗:', error);
        setTaskServerStatus('error');
      }
    };

    await Promise.all([checkOllama(), checkServer()]);
    setIsCheckingConnection(false);
  };

  const [activeTab, setActiveTab] = useState<string>('transcription-translation');
  const [appVersion, setAppVersion] = useState<string>('...');

  // 更新相關狀態
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ available: boolean; version?: string } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

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
    ollama: {
      host: "http://100.117.82.111:11434",
      model: "llama3",
      enabled: false
    }
  });

  // 讀取應用版本號
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
  }, []);

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
        setAudioDevices([]);
      } finally {
        setIsLoadingDevices(false);
      }
    };

    loadAudioDevices();

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
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = await storageService.getAppSettings();
      if (savedSettings) {
        const mergedSettings: AppSettings = {
          server: {
            url: savedSettings.server?.url || "http://localhost",
            port: savedSettings.server?.port || 8080,
            enabled: savedSettings.server?.enabled || false,
          },
          audio: {
            device_id: savedSettings.audio?.device_id,
            sample_rate: savedSettings.audio?.sample_rate || 16000,
            chunk_duration: savedSettings.audio?.chunk_duration || 2,
          },
          subtitle: {
            font_size: savedSettings.subtitle?.font_size || 18,
            font_color: savedSettings.subtitle?.font_color || "#FFFFFF",
            background_opacity: savedSettings.subtitle?.background_opacity || 0.8,
            position: savedSettings.subtitle?.position || "bottom",
            display_mode: savedSettings.subtitle?.display_mode || "both",
          },
          theme: savedSettings.theme || "light",
          models: savedSettings.models,
          translation: savedSettings.translation,
          ollama: savedSettings.ollama || { host: "http://100.117.82.111:11434", model: "qwen3:235b-a22b", enabled: false },
          sync: savedSettings.sync || { username: '', autoSync: false }
        };

        setSettings(mergedSettings);

        if (savedSettings.audio?.device_id) {
          setSelectedDeviceId(savedSettings.audio.device_id);
        }

        if (savedSettings.ollama) {
          const host = savedSettings.ollama.host.replace(/:11434$/, '').replace(/\/$/, '');
          setAiServerHost(host);
          setOllamaModel(savedSettings.ollama.model);
          checkUnifiedConnection(host);

          // 載入 AI 模型分層配置
          if (savedSettings.ollama.aiModels) {
            setAiModelConfig({
              embedding: savedSettings.ollama.aiModels.embedding || 'nomic-embed-text',
              light: savedSettings.ollama.aiModels.light || 'qwen3:8b',
              standard: savedSettings.ollama.aiModels.standard || 'qwen3:8b',
              heavy: savedSettings.ollama.aiModels.heavy || 'qwen3:235b-a22b',
            });
          }
        } else {
          checkUnifiedConnection("http://100.117.82.111");
        }
      }



      const whisperPath = await storageService.getSetting('whisper_model_path');
      if (whisperPath) {
        setWhisperModelPath(whisperPath);
      }

    } catch (error) {
      console.error('加載設置失敗:', error);
    }
  };



  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      // 構建完整的 Host URL
      const cleanHost = aiServerHost.replace(/\/$/, '');
      const fullOllamaHost = `${cleanHost}:11434`;
      const fullServerUrl = `${cleanHost}:3001`;

      const updatedSettings: AppSettings = {
        ...settings,
        audio: {
          ...settings.audio,
          device_id: selectedDeviceId || undefined,
        },
        ollama: {
          host: fullOllamaHost,
          model: ollamaModel,
          enabled: ollamaStatus === 'connected',
          aiModels: aiModelConfig // 確保保存模型配置
        },

        server: {
          ...settings.server,
          url: fullServerUrl,
          port: 3001,
          enabled: taskServerStatus === 'connected'
        }
      };

      await storageService.saveAppSettings(updatedSettings);

      // 立即應用主題更改
      if (updatedSettings.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      if (whisperModelPath) {
        await storageService.saveSetting('whisper_model_path', whisperModelPath);
      }



      if (selectedDeviceId) {
        audioDeviceService.setDefaultDevice(selectedDeviceId);
      }

      setSaveStatus('success');

      // Notify other components about settings change
      window.dispatchEvent(new CustomEvent('classnote-settings-changed'));

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
      setImportStatus({ success: false, message: `導出失敗: ${error instanceof Error ? error.message : String(error)} ` });
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
        message: `成功導入 ${result.imported} 個課程${result.errors.length > 0 ? `，${result.errors.length} 個錯誤` : ''} `,
      });
      setTimeout(() => setImportStatus(null), 5000);
    } catch (error) {
      setImportStatus({ success: false, message: `導入失敗: ${error instanceof Error ? error.message : String(error)} ` });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };



  const translationProvider = settings.translation?.provider || 'local';

  const navigationItems = [
    { id: 'transcription-translation', label: '轉錄與翻譯', icon: Languages, description: '配置語音識別和翻譯模型' },
    { id: 'ollama-settings', label: 'AI 增強 (Ollama)', icon: Cpu, description: '配置本地 LLM 進行總結和關鍵詞提取' },
    { id: 'audio', label: '音頻設置', icon: Mic, description: '麥克風和採樣率設置' },


    { id: 'data-management', label: '數據管理', icon: Database, description: '導入和導出應用數據' },
    { id: 'about-update', label: '關於與更新', icon: Info, description: '版本信息和檢查更新' },
  ];

  // 檢查更新處理函數
  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    try {
      const { updateService } = await import('../services/updateService');
      const result = await updateService.checkForUpdates();
      setUpdateInfo(result);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '檢查更新失敗');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 下載並安裝更新
  const handleDownloadUpdate = async () => {
    setIsDownloading(true);
    try {
      const { updateService } = await import('../services/updateService');
      await updateService.downloadAndInstall((progress) => {
        setDownloadProgress(progress.percentage);
      });
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '下載更新失敗');
    } finally {
      setIsDownloading(false);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'transcription-translation':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Mic className="w-5 h-5 text-blue-500" />
                  轉錄模型 (Whisper)
                </h3>
              </div>
              <div className="p-6">
                <WhisperModelManager
                  onModelLoaded={() => {
                    console.log('模型加載完成');
                  }}
                />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Languages className="w-5 h-5 text-green-500" />
                  翻譯服務
                </h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">翻譯提供商</label>
                  <select
                    value={translationProvider}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        translation: {
                          ...settings.translation,
                          provider: e.target.value as 'local' | 'google',
                        },
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="local">本地 ONNX 模型（離線，免費）</option>
                    <option value="google">Google Cloud Translation API（在線，需 API 密鑰）</option>
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {translationProvider === 'google'
                      ? '使用 Google 翻譯服務，可選填 API 密鑰使用官方 API'
                      : '使用本地 ONNX 模型進行翻譯，完全離線'}
                  </p>
                </div>

                {translationProvider === 'local' && (
                  <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    <TranslationModelManager />
                  </div>
                )}

                {translationProvider === 'google' && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                      Google Cloud Translation API 密鑰（可選）
                    </label>
                    <input
                      type="password"
                      value={settings.translation?.google_api_key || ''}
                      onChange={(e) => {
                        setSettings({
                          ...settings,
                          translation: {
                            ...settings.translation,
                            google_api_key: e.target.value,
                          },
                        });
                      }}
                      placeholder="留空使用非官方接口，或輸入 API 密鑰"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <label className="block text-sm font-medium mb-2">目標語言 (AI 生成內容)</label>
                  <select
                    value={settings.translation?.target_language || 'zh-TW'}
                    onChange={(e) => {
                      setSettings({
                        ...settings,
                        translation: {
                          ...settings.translation,
                          target_language: e.target.value,
                        },
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="zh-TW">繁體中文 (Traditional Chinese)</option>
                    <option value="zh-CN">簡體中文 (Simplified Chinese)</option>
                    <option value="en">English</option>
                    <option value="ja">日本語 (Japanese)</option>
                    <option value="ko">한국어 (Korean)</option>
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    此設置將應用於 AI 自動生成的課程大綱、總結與筆記翻譯。
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case 'ollama-settings':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-purple-500" />
                  Ollama 連接設置
                </h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    AI Server Host (Unified)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    請輸入 Ollama 與 Task Server 所在的主機地址 (e.g., http://10.0.0.1)
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiServerHost}
                      onChange={(e) => setAiServerHost(e.target.value)}
                      placeholder="http://localhost"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                    />
                    <button
                      onClick={() => checkUnifiedConnection(aiServerHost)}
                      disabled={isCheckingConnection}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                      {isCheckingConnection ? '檢查連接...' : '重新連接'}
                    </button>
                  </div>

                  {/* Status Indicators */}
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div className={`flex items-center gap-2 p-2 rounded-lg border ${ollamaStatus === 'connected' ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'}`}>
                      <Brain className={`w-5 h-5 ${ollamaStatus === 'connected' ? 'text-green-600' : 'text-red-500'}`} />
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Ollama (LLM)</div>
                        <div className={`text-sm ${ollamaStatus === 'connected' ? 'text-green-600' : 'text-red-500'}`}>
                          {ollamaStatus === 'connected' ? '已連接' : '未連接'}
                        </div>
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 p-2 rounded-lg border ${taskServerStatus === 'connected' ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'}`}>
                      <Server className={`w-5 h-5 ${taskServerStatus === 'connected' ? 'text-green-600' : 'text-gray-500'}`} />
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Task Server</div>
                        <div className={`text-sm ${taskServerStatus === 'connected' ? 'text-green-600' : 'text-gray-500'}`}>
                          {taskServerStatus === 'connected' ? '已連接' : taskServerStatus === 'error' ? '連接失敗' : '未知'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    預設模型（舊版相容）
                  </label>
                  <select
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    disabled={ollamaModels.length === 0}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-50"
                  >
                    {ollamaModels.length === 0 && <option value={ollamaModel}>{ollamaModel || '(未檢測到模型)'}</option>}
                    {ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name} ({Math.round(model.size / 1024 / 1024 / 1024 * 10) / 10} GB)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* AI 模型分層配置 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-indigo-500" />
                  AI 功能模型配置
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  為不同任務指定不同模型，優化性能與質量
                </p>
              </div>
              <div className="p-6 space-y-6">

                {/* Embedding 模型 */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-blue-700 dark:text-blue-300">
                      📊 Embedding 模型
                    </label>
                    <span className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded">
                      專用
                    </span>
                  </div>
                  <input
                    type="text"
                    value={aiModelConfig.embedding}
                    onChange={(e) => setAiModelConfig({ ...aiModelConfig, embedding: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-800"
                  />
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    用於：RAG 搜尋、PDF 對齊、知識庫索引
                  </p>
                </div>

                {/* 輕量模型 */}
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-green-700 dark:text-green-300">
                      ⚡ 輕量任務模型
                    </label>
                    <span className="text-xs bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300 px-2 py-0.5 rounded">
                      快速
                    </span>
                  </div>
                  <select
                    value={aiModelConfig.light}
                    onChange={(e) => setAiModelConfig({ ...aiModelConfig, light: e.target.value })}
                    disabled={ollamaModels.length === 0}
                    className="w-full px-3 py-2 rounded-lg border border-green-300 dark:border-green-600 bg-white dark:bg-gray-800"
                  >
                    {ollamaModels.length === 0 && <option value={aiModelConfig.light}>{aiModelConfig.light}</option>}
                    {ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name} ({Math.round(model.size / 1024 / 1024 / 1024 * 10) / 10} GB)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    用於：關鍵詞提取、對話歷史壓縮、大綱提取
                  </p>
                </div>

                {/* 標準模型 */}
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-yellow-700 dark:text-yellow-300">
                      💬 標準任務模型
                    </label>
                    <span className="text-xs bg-yellow-100 dark:bg-yellow-800 text-yellow-600 dark:text-yellow-300 px-2 py-0.5 rounded">
                      平衡
                    </span>
                  </div>
                  <select
                    value={aiModelConfig.standard}
                    onChange={(e) => setAiModelConfig({ ...aiModelConfig, standard: e.target.value })}
                    disabled={ollamaModels.length === 0}
                    className="w-full px-3 py-2 rounded-lg border border-yellow-300 dark:border-yellow-600 bg-white dark:bg-gray-800"
                  >
                    {ollamaModels.length === 0 && <option value={aiModelConfig.standard}>{aiModelConfig.standard}</option>}
                    {ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name} ({Math.round(model.size / 1024 / 1024 / 1024 * 10) / 10} GB)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    用於：RAG 問答、AI 助教對話
                  </p>
                </div>

                {/* 重量模型 */}
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-purple-700 dark:text-purple-300">
                      🧠 重量任務模型
                    </label>
                    <span className="text-xs bg-purple-100 dark:bg-purple-800 text-purple-600 dark:text-purple-300 px-2 py-0.5 rounded">
                      高質量
                    </span>
                  </div>
                  <select
                    value={aiModelConfig.heavy}
                    onChange={(e) => setAiModelConfig({ ...aiModelConfig, heavy: e.target.value })}
                    disabled={ollamaModels.length === 0}
                    className="w-full px-3 py-2 rounded-lg border border-purple-300 dark:border-purple-600 bg-white dark:bg-gray-800"
                  >
                    {ollamaModels.length === 0 && <option value={aiModelConfig.heavy}>{aiModelConfig.heavy}</option>}
                    {ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name} ({Math.round(model.size / 1024 / 1024 / 1024 * 10) / 10} GB)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    用於：課程總結生成 (Deep Summarization)
                  </p>
                </div>

              </div>
            </div>
          </div>
        );

      case 'audio':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Mic className="w-5 h-5 text-red-500" />
                  音頻輸入
                </h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">麥克風設備</label>
                    <button
                      onClick={handleRefreshDevices}
                      disabled={isLoadingDevices}
                      className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
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
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>8kHz</span>
                    <span>48kHz</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'subtitle':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Type className="w-5 h-5 text-orange-500" />
                  字幕樣式
                </h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    字體大小: {settings.subtitle.font_size}px
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="32"
                    value={settings.subtitle.font_size}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        subtitle: { ...settings.subtitle, font_size: parseInt(e.target.value) },
                      })
                    }
                    className="w-full accent-orange-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
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
            </div>
          </div>
        );







      case 'data-management':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Database className="w-5 h-5 text-teal-500" />
                  數據備份與恢復
                </h3>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h4 className="font-medium mb-2">導出數據</h4>
                    <p className="text-xs text-gray-500 mb-4">
                      將所有課程、字幕、筆記和設置導出為 JSON 文件。
                    </p>
                    <button
                      onClick={handleExportData}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Download size={16} />
                      導出備份
                    </button>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h4 className="font-medium mb-2">導入數據</h4>
                    <p className="text-xs text-gray-500 mb-4">
                      從 JSON 文件恢復數據。注意：這將覆蓋現有數據。
                    </p>
                    <button
                      onClick={handleImportData}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Upload size={16} />
                      導入備份
                    </button>
                  </div>
                </div>
                {importStatus && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg ${importStatus.success
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                    }`}>
                    <AlertCircle size={18} />
                    <span className="text-sm">{importStatus.message}</span>
                  </div>
                )}

                {/* Trash Bin Link */}
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium flex items-center gap-2">
                        <Trash2 size={18} className="text-red-500" />
                        回收桶
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">
                        查看已刪除的項目，可還原或永久刪除。
                      </p>
                    </div>
                    <button
                      onClick={() => (window as any).__setShowTrashView?.(true)}
                      className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 flex items-center gap-1"
                    >
                      開啟
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div >
        );

      case 'about-update':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-500" />
                  關於 ClassNote AI
                </h3>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 dark:text-gray-400">版本</span>
                  <span className="font-mono">{appVersion}</span>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={isCheckingUpdate || isDownloading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                  >
                    {isCheckingUpdate ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> 正在檢查...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> 檢查更新</>
                    )}
                  </button>
                </div>
                {updateInfo && (
                  <div className={`p-4 rounded-lg ${updateInfo.available
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700'
                    }`}>
                    {updateInfo.available ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                          <CheckCircle className="w-5 h-5" />
                          <span className="font-medium">發現新版本: {updateInfo.version}</span>
                        </div>
                        <button
                          onClick={handleDownloadUpdate}
                          disabled={isDownloading}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                        >
                          {isDownloading ? (
                            <><Download className="w-4 h-4 animate-bounce" /> 下載中 {downloadProgress}%</>
                          ) : (
                            <><Download className="w-4 h-4" /> 下載並安裝</>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <CheckCircle className="w-5 h-5" />
                        <span>已是最新版本</span>
                      </div>
                    )}
                  </div>
                )}
                {updateError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                    {updateError}
                  </div>
                )}
              </div>
            </div>
          </div >
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">設置</h2>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-all ${isActive
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                <span className="flex-1 text-left">{item.label}</span>
                {isActive && <ChevronRight className="w-4 h-4 opacity-50" />}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-center text-gray-400">
            ClassNote AI v0.1.0
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="h-16 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-8 flex-shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white">
              {navigationItems.find(i => i.id === activeTab)?.label}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {navigationItems.find(i => i.id === activeTab)?.description}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveStatus === 'success' && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm animate-in fade-in slide-in-from-right-4">
                <CheckCircle size={16} />
                已保存
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Save size={18} />
              {saveStatus === 'saving' ? '保存中...' : '保存設置'}
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
