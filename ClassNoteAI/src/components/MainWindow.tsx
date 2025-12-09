import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, FileText, Settings, Moon, Sun, FlaskConical } from "lucide-react";
import { applyTheme, getSystemTheme } from "../utils/theme";
import { ollamaService } from "../services/ollamaService";
import * as whisperService from "../services/whisperService";
import * as translationModelService from "../services/translationModelService";
import { storageService } from "../services/storageService";

// Import Views
import CourseListView from "./CourseListView";
import CourseDetailView from "./CourseDetailView";
import NotesView from "./NotesView";
import SettingsView from "./SettingsView";
import TranscriptionTest from "./TranscriptionTest";
import { TranslationModelTest } from "./TranslationModelTest";

type ActiveView = 'home' | 'course' | 'lecture' | 'settings' | 'test' | 'test-translation';

export default function MainWindow() {
  const navigate = useNavigate();
  const location = useLocation();

  // View State
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [activeLectureId, setActiveLectureId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [ollamaStatus, setOllamaStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [whisperModel, setWhisperModel] = useState<string | null>(null);
  const [translationState, setTranslationState] = useState<{
    provider: 'local' | 'google';
    model: string | null;
  }>({ provider: 'local', model: null });

  // Sync URL with internal state (optional, for deep linking)
  useEffect(() => {
    // This is a simplified sync. For full deep linking support, we'd parse the URL here.
    // For now, we prioritize internal state to prevent unmounting.
  }, []);

  // ... (Theme and Service Checks - Keep existing useEffects) ...
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const settings = await storageService.getAppSettings();
        if (settings && settings.theme) {
          setTheme(settings.theme);
        } else {
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
    const checkOllama = async () => {
      const isConnected = await ollamaService.checkConnection();
      setOllamaStatus(isConnected ? 'connected' : 'disconnected');
    };

    checkOllama();
    const interval = setInterval(checkOllama, 30000);

    setWhisperModel(whisperService.getCurrentModel());

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

    try {
      const currentSettings = await storageService.getAppSettings();
      if (currentSettings) {
        await storageService.saveAppSettings({
          ...currentSettings,
          theme: newTheme
        });
      }
    } catch (error) {
      console.error('Failed to save theme preference:', error);
    }
  };

  // Navigation Handlers
  const handleNavigateHome = () => {
    setActiveView('home');
    setIsSettingsOpen(false);
  };

  const handleNavigateSettings = () => {
    setIsSettingsOpen(true);
  };

  const handleSelectCourse = (courseId: string) => {
    setActiveCourseId(courseId);
    setActiveView('course');
  };

  const handleSelectLecture = (courseId: string, lectureId: string) => {
    setActiveCourseId(courseId);
    setActiveLectureId(lectureId);
    setActiveView('lecture');
  };

  const handleCreateLecture = async (courseId: string) => {
    try {
      const newLecture = {
        id: crypto.randomUUID(),
        course_id: courseId,
        title: '新課堂',
        date: new Date().toISOString(),
        duration: 0,
        status: 'recording' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await storageService.saveLecture(newLecture);
      handleSelectLecture(courseId, newLecture.id);
    } catch (error) {
      console.error('Failed to create lecture:', error);
    }
  };

  const handleNavigateNotes = () => {
    if (activeLectureId && activeCourseId) {
      setActiveView('lecture');
    } else {
      // If no active lecture, maybe go to home or show a message
      // For now, let's go to home as fallback, or maybe we should just switch to 'lecture' view 
      // which shows "No active lecture" message as implemented.
      setActiveView('lecture');
    }
    setIsSettingsOpen(false);
  };

  const handleBackToCourses = () => {
    setActiveView('home');
  };

  const handleBackToCourseDetail = () => {
    if (activeCourseId) {
      setActiveView('course');
    } else {
      setActiveView('home');
    }
  };

  const navItems = [
    { id: 'home', label: "上課", icon: BookOpen, action: handleNavigateHome },
    { id: 'notes', label: "筆記", icon: FileText, action: handleNavigateNotes },
    { id: 'settings', label: "設置", icon: Settings, action: handleNavigateSettings },
    { id: 'test', label: "測試", icon: FlaskConical, action: () => { setActiveView('test'); setIsSettingsOpen(false); } },
    { id: 'test-translation', label: "翻譯測試", icon: FlaskConical, action: () => { setActiveView('test-translation'); setIsSettingsOpen(false); } },
  ];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 relative">
      {/* 頂部導航欄 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 z-20 relative">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">ClassNote AI</h1>
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            // Highlight logic
            let isActive = false;
            if (item.id === 'settings') {
              isActive = isSettingsOpen;
            } else if (!isSettingsOpen) {
              if (item.id === 'home') isActive = ['home', 'course'].includes(activeView);
              if (item.id === 'notes') isActive = activeView === 'lecture';
              if (item.id === 'test') isActive = activeView === 'test';
              if (item.id === 'test-translation') isActive = activeView === 'test-translation';
            }

            return (
              <button
                key={item.id}
                onClick={item.action}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isActive
                  ? "bg-blue-500 text-white"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
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
      <div className="px-6 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 z-10 relative">
        <div className="flex items-center gap-4">
          <span
            className="flex items-center gap-2 cursor-help"
            title={ollamaStatus === 'connected' ? "Ollama 服務已連接" : "無法連接到 Ollama 服務"}
          >
            <span className={`w-2 h-2 rounded-full ${ollamaStatus === 'connected' ? 'bg-green-500' :
              ollamaStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500'
              }`}></span>
            {ollamaStatus === 'connected' ? '已連接' : ollamaStatus === 'checking' ? '檢查中...' : '未連接'}
          </span>

          <span
            className="flex items-center gap-2 cursor-help"
            title={whisperModel ? `當前加載模型: ${whisperModel}` : "Whisper 模型尚未加載"}
          >
            <span className={`w-2 h-2 rounded-full ${whisperModel ? 'bg-blue-500' : 'bg-gray-400'}`}></span>
            {whisperModel ? '模型就緒' : '模型未加載'}
          </span>

          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2"></div>

          <span
            className="flex items-center gap-2 cursor-help"
            title={translationState.provider === 'google' ? "Google Cloud API" : "本地翻譯模型"}
          >
            <span className={`w-2 h-2 rounded-full ${translationState.provider === 'google' || translationState.model ? 'bg-purple-500' : 'bg-gray-400'}`}></span>
            翻譯就緒
          </span>
        </div>
      </div>

      {/* 主內容區域 - 使用 Stack 方式管理視圖 */}
      <main className="flex-1 overflow-hidden relative">

        {/* 1. Home View (Course List) */}
        {activeView === 'home' && !isSettingsOpen && (
          <div className="absolute inset-0 overflow-auto bg-gray-50 dark:bg-gray-900">
            <CourseListView onSelectCourse={handleSelectCourse} />
          </div>
        )}

        {/* 2. Course Detail View */}
        {activeView === 'course' && activeCourseId && !isSettingsOpen && (
          <div className="absolute inset-0 overflow-auto bg-gray-50 dark:bg-gray-900">
            <CourseDetailView
              courseId={activeCourseId}
              onBack={handleBackToCourses}
              onSelectLecture={(lectureId) => handleSelectLecture(activeCourseId, lectureId)}
              onCreateLecture={() => handleCreateLecture(activeCourseId)}
            />
          </div>
        )}

        {/* 3. Lecture View (NotesView) - KEEP ALIVE */}
        {/* 始終渲染，但通過 CSS 控制顯示/隱藏 */}
        <div
          className="absolute inset-0 bg-white dark:bg-slate-900"
          style={{
            display: (activeView === 'lecture' && !isSettingsOpen) ? 'block' : 'none',
            zIndex: 0
          }}
        >
          {activeLectureId && activeCourseId ? (
            <NotesView
              courseId={activeCourseId}
              lectureId={activeLectureId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              No active lecture
            </div>
          )}
        </div>

        {/* 4. Settings Overlay */}
        {isSettingsOpen && (
          <div className="absolute inset-0 z-50 bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <SettingsView onClose={() => setIsSettingsOpen(false)} />
          </div>
        )}

        {/* 5. Test View */}
        {activeView === 'test' && !isSettingsOpen && (
          <div className="absolute inset-0 overflow-auto bg-white dark:bg-slate-900">
            <TranscriptionTest />
          </div>
        )}

        {/* 6. Translation Test View */}
        {activeView === 'test-translation' && !isSettingsOpen && (
          <div className="absolute inset-0 overflow-auto bg-white dark:bg-slate-900">
            <TranslationModelTest />
          </div>
        )}

      </main>
    </div>
  );
}

