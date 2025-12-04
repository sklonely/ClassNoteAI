import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, FileText, Settings, Moon, Sun, FlaskConical } from "lucide-react";
import { applyTheme, getSystemTheme } from "../utils/theme";
import { ollamaService } from "../services/ollamaService";
import * as whisperService from "../services/whisperService";
import * as translationModelService from "../services/translationModelService";
import { storageService } from "../services/storageService";

export default function MainWindow({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [theme, setTheme] = useState<"light" | "dark">("light"); // Default to light, will update from storage
  const [ollamaStatus, setOllamaStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [whisperModel, setWhisperModel] = useState<string | null>(null);
  const [translationState, setTranslationState] = useState<{
    provider: 'local' | 'google';
    model: string | null;
  }>({ provider: 'local', model: null });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Load initial theme from storage
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const settings = await storageService.getAppSettings();
        if (settings && settings.theme) {
          setTheme(settings.theme);
        } else {
          // Fallback to system theme if no setting saved
          setTheme(getSystemTheme());
        }
      } catch (error) {
        console.error('Failed to load theme settings:', error);
        setTheme(getSystemTheme());
      }
    };
    loadTheme();
  }, []);

  useEffect(() => {
    // Check Ollama Status
    const checkOllama = async () => {
      const isConnected = await ollamaService.checkConnection();
      setOllamaStatus(isConnected ? 'connected' : 'disconnected');
    };

    checkOllama();
    const interval = setInterval(checkOllama, 30000); // Check every 30s

    // Check Whisper Model
    setWhisperModel(whisperService.getCurrentModel());

    // Check Translation State
    const checkTranslationState = async () => {
      const settings = await storageService.getAppSettings();
      const provider = settings?.translation?.provider || 'local';
      const localModel = translationModelService.getCurrentModel();

      setTranslationState({
        provider,
        model: localModel
      });
    };
    checkTranslationState();

    // Event Listeners
    const handleWhisperModelChange = (e: CustomEvent) => {
      if (e.detail && e.detail.model) {
        setWhisperModel(e.detail.model);
      }
    };

    const handleTranslationModelChange = (e: CustomEvent) => {
      if (e.detail && e.detail.model) {
        setTranslationState(prev => ({ ...prev, model: e.detail.model }));
      }
    };

    const handleSettingsChange = async () => {
      checkTranslationState();
      // Also reload theme in case it was changed in settings
      const settings = await storageService.getAppSettings();
      if (settings && settings.theme) {
        setTheme(settings.theme);
      }
    };

    window.addEventListener('classnote-whisper-model-changed', handleWhisperModelChange as EventListener);
    window.addEventListener('classnote-translation-model-changed', handleTranslationModelChange as EventListener);
    window.addEventListener('classnote-settings-changed', handleSettingsChange as EventListener);

    return () => {
      clearInterval(interval);
      window.removeEventListener('classnote-whisper-model-changed', handleWhisperModelChange as EventListener);
      window.removeEventListener('classnote-translation-model-changed', handleTranslationModelChange as EventListener);
      window.removeEventListener('classnote-settings-changed', handleSettingsChange as EventListener);
    };
  }, []);

  const toggleTheme = async () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    applyTheme(newTheme);

    // Save new theme preference
    try {
      // We need to update the full app settings object to persist the theme correctly
      // First get current settings
      const currentSettings = await storageService.getAppSettings();

      if (currentSettings) {
        // If settings exist, update theme
        await storageService.saveAppSettings({
          ...currentSettings,
          theme: newTheme
        });
      } else {
        console.warn('Cannot save theme: App settings not initialized');
      }
    } catch (error) {
      console.error('Failed to save theme preference:', error);
    }
  };

  const navItems = [
    { path: "/", label: "上課", icon: BookOpen },
    { path: "/notes", label: "筆記", icon: FileText },
    { path: "/settings", label: "設置", icon: Settings },
    { path: "/test", label: "測試", icon: FlaskConical },
    { path: "/test-translation", label: "翻譯測試", icon: FlaskConical },
  ];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      {/* 頂部導航欄 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">ClassNote AI</h1>
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isActive
                  ? "bg-blue-500 text-white"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="切換主題"
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </header>

      {/* 狀態欄 */}
      <div className="px-6 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span
            className="flex items-center gap-2 cursor-help"
            title={ollamaStatus === 'connected' ? "Ollama 服務已連接 (用於總結與關鍵詞)" : "無法連接到 Ollama 服務"}
          >
            <span className={`w-2 h-2 rounded-full ${ollamaStatus === 'connected' ? 'bg-green-500' :
              ollamaStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500'
              }`}></span>
            {ollamaStatus === 'connected' ? '已連接' : ollamaStatus === 'checking' ? '檢查中...' : '未連接'}
          </span>

          <span
            className="flex items-center gap-2 cursor-help"
            title={whisperModel ? `當前加載模型: ${whisperModel}` : "Whisper 模型尚未加載 (用於語音轉錄)"}
          >
            <span className={`w-2 h-2 rounded-full ${whisperModel ? 'bg-blue-500' : 'bg-gray-400'}`}></span>
            {whisperModel ? '模型就緒' : '模型未加載'}
          </span>

          {whisperModel && (
            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-full">
              {whisperModel}
            </span>
          )}

          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2"></div>

          <span
            className="flex items-center gap-2 cursor-help"
            title={translationState.provider === 'google'
              ? "使用 Google Cloud Translation API (在線)"
              : translationState.model
                ? `使用本地模型: ${translationModelService.getModelDisplayName(translationState.model)}`
                : "本地翻譯模型尚未加載"}
          >
            <span className={`w-2 h-2 rounded-full ${translationState.provider === 'google' ? 'bg-purple-500' :
              translationState.model ? 'bg-purple-500' : 'bg-gray-400'
              }`}></span>
            翻譯就緒
          </span>

          {(translationState.provider === 'google' || translationState.model) && (
            <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 rounded-full">
              {translationState.provider === 'google' ? 'Google Cloud' : translationState.model}
            </span>
          )}
        </div>
      </div>

      {/* 主內容區域 */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

