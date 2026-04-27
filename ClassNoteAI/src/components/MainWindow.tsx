import { useState, useEffect } from "react";
import { BookOpen, Settings, Moon, Sun, User } from "lucide-react";
import { applyTheme, getSystemTheme } from "../utils/theme";
import * as translationModelService from "../services/translationModelService";
import { storageService } from "../services/storageService";

// Import Views
import CourseListView from "./CourseListView";
import CourseDetailView from "./CourseDetailView";
import NotesView from "./NotesView";
import SettingsView from "./SettingsView";
import ProfileView from "./ProfileView";
import TaskIndicator from "./TaskIndicator";
import TrashView from "./TrashView";

type ActiveView = 'home' | 'course' | 'lecture' | 'settings' | 'test' | 'test-translation';

export default function MainWindow() {

  // View State
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [activeLectureId, setActiveLectureId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showTrashView, setShowTrashView] = useState(false);

  // Expose setShowTrashView globally for SettingsView to access
  useEffect(() => {
    (window as any).__setShowTrashView = setShowTrashView;
    return () => {
      delete (window as any).__setShowTrashView;
    };
  }, []);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [whisperModel, setWhisperModel] = useState<string | null>(null);
  const [translationState, setTranslationState] = useState<{
    provider: 'local' | 'gemma' | 'google';
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
    // v2: ASR is Parakeet, model name is fixed. The whisperModel state
    // remains for badge/UI purposes; we just label it with the active
    // engine instead of querying a stateful service.
    setWhisperModel('parakeet-tdt-0.6b-v2');

    const checkTranslationState = async () => {
      const settings = await storageService.getAppSettings();
      let provider = settings?.translation?.provider || 'gemma';

      // Stale-settings migration: if the saved provider is `local` but
      // this binary was built without `nmt-local` (no CT2 backend), the
      // user would otherwise hit "翻譯失敗" on every translation. Auto-
      // migrate to gemma (the new default) and persist so the next
      // launch is clean. Only attempts persistence when settings exist
      // (otherwise there's nothing to migrate yet).
      try {
        const { getBuildFeatures } = await import('../services/buildFeaturesService');
        const features = await getBuildFeatures();
        if (provider === 'local' && !features.nmt_local && settings) {
          console.warn(
            '[MainWindow] saved provider=local but this build has no nmt-local; migrating to gemma',
          );
          provider = 'gemma';
          await storageService.saveAppSettings({
            ...settings,
            translation: {
              ...(settings.translation || {}),
              provider: 'gemma',
            },
          });
        }
      } catch (e) {
        console.warn('[MainWindow] build features query failed during migration:', e);
      }

      const localModel = translationModelService.getCurrentModel();
      setTranslationState({
        provider,
        model: localModel,
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
    setIsProfileOpen(false);
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
    { id: 'settings', label: "設置", icon: Settings, action: handleNavigateSettings },
    // { id: 'test', label: "測試", icon: FlaskConical, action: () => setActiveView('test') },
  ];

  return (
    <div
      data-agent-id="app.main"
      className="flex flex-col h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 relative"
    >
      {/* 頂部導航欄。z-[60] 高於 Settings/Profile/Trash overlay 的 z-50，
          讓 TaskIndicator 等向下展開的氣泡（它繼承 header 的 stacking
          context）能蓋在全螢幕 overlay 上面而不被截斷。 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 z-[60] relative">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">ClassNote AI</h1>
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            // Highlight Home if we are in home, course, or lecture view (unless settings is open)
            const isActive = item.id === 'settings' ? isSettingsOpen : (!isSettingsOpen && !isProfileOpen && ['home', 'course', 'lecture'].includes(activeView) && item.id === 'home');


            return (
              <button
                key={item.id}
                data-agent-id={`nav.${item.id}`}
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
          <TaskIndicator />
          <button
            data-agent-id="nav.profile"
            onClick={() => setIsProfileOpen(true)}
            className={`p-2 rounded-lg transition-colors ${isProfileOpen ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            aria-label="個人中心"
          >
            <User size={20} />
          </button>
          <button
            data-agent-id="nav.theme"
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
        {activeView === 'home' && !isSettingsOpen && !isProfileOpen && (
          <div data-agent-id="view.home" className="absolute inset-0 overflow-auto bg-gray-50 dark:bg-gray-900">
            <CourseListView onSelectCourse={handleSelectCourse} />
          </div>
        )}

        {/* 2. Course Detail View */}
        {activeView === 'course' && activeCourseId && !isSettingsOpen && !isProfileOpen && (
          <div data-agent-id="view.course" className="absolute inset-0 overflow-auto bg-gray-50 dark:bg-gray-900">
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
          data-agent-id="view.lecture"
          className="absolute inset-0 bg-white dark:bg-slate-900"
          style={{
            display: (activeView === 'lecture' && !isSettingsOpen && !isProfileOpen) ? 'block' : 'none',
            zIndex: 0
          }}
        >
          {activeLectureId && activeCourseId ? (
            <NotesView
              courseId={activeCourseId}
              lectureId={activeLectureId}
              onBack={handleBackToCourseDetail}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              No active lecture
            </div>
          )}
        </div>

        {/* 4. Settings Overlay */}
        {isSettingsOpen && (
          <div data-agent-id="view.settings" className="absolute inset-0 z-50 bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <SettingsView onClose={() => setIsSettingsOpen(false)} />
          </div>
        )}

        {/* 5. Profile Overlay */}
        {isProfileOpen && (
          <div data-agent-id="view.profile" className="absolute inset-0 z-50 bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <ProfileView onClose={() => setIsProfileOpen(false)} />
          </div>
        )}

        {/* 6. Trash Bin Overlay */}
        {showTrashView && (
          <div data-agent-id="view.trash" className="absolute inset-0 z-50 bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <TrashView onBack={() => setShowTrashView(false)} />
          </div>
        )}

      </main>
    </div>
  );
}
