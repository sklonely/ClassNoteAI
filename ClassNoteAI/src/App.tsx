import { useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import MainWindow from "./components/MainWindow";
import CourseListView from "./components/CourseListView";
import CourseDetailView from "./components/CourseDetailView";
import NotesView from "./components/NotesView";
import SettingsView from "./components/SettingsView";
import TranscriptionTest from "./components/TranscriptionTest";
import { TranslationModelTest } from "./components/TranslationModelTest";
import ErrorBoundary from "./components/ErrorBoundary";
import SetupWizard from "./components/SetupWizard";
import { storageService } from "./services/storageService";
import { setupService } from "./services/setupService";

type AppState = 'loading' | 'setup' | 'ready';

function App() {
  const navigate = useNavigate();
  const [appState, setAppState] = useState<AppState>('loading');

  // Check setup status on mount
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const isComplete = await setupService.isComplete();
        setAppState(isComplete ? 'ready' : 'setup');
      } catch (error) {
        console.error('Failed to check setup status:', error);
        // If check fails, assume setup is needed
        setAppState('setup');
      }
    };
    checkSetup();
  }, []);

  // 初始化主題
  useEffect(() => {
    const initTheme = async () => {
      try {
        const settings = await storageService.getAppSettings();
        if (settings?.theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } catch (error) {
        console.error('Failed to load theme settings:', error);
      }
    };
    initTheme();
  }, []);

  const handleSelectCourse = (courseId: string) => {
    navigate(`/course/${courseId}`);
  };

  const handleBackToCourses = () => {
    navigate('/');
  };

  const handleSelectLecture = (courseId: string, lectureId: string) => {
    navigate(`/course/${courseId}/lecture/${lectureId}`);
  };

  const handleCreateLecture = async (courseId: string) => {
    // 創建新課堂並跳轉
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
      navigate(`/course/${courseId}/lecture/${newLecture.id}`);
    } catch (error) {
      console.error('Failed to create lecture:', error);
    }
  };

  const handleSetupComplete = () => {
    setAppState('ready');
  };

  // Show loading screen while checking setup
  if (appState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-white text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>正在檢查環境...</p>
        </div>
      </div>
    );
  }

  // Show setup wizard if setup is not complete
  if (appState === 'setup') {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <ErrorBoundary>
      <MainWindow>
        <Routes>
          <Route
            path="/"
            element={<CourseListView onSelectCourse={handleSelectCourse} />}
          />
          <Route
            path="/course/:courseId"
            element={
              <CourseDetailViewWrapper
                onBack={handleBackToCourses}
                onSelectLecture={handleSelectLecture}
                onCreateLecture={handleCreateLecture}
              />
            }
          />
          <Route
            path="/course/:courseId/lecture/:lectureId"
            element={<NotesView />}
          />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/test" element={<TranscriptionTest />} />
          <Route path="/test-translation" element={<TranslationModelTest />} />
        </Routes>
      </MainWindow>
    </ErrorBoundary>
  );
}

// Wrapper to extract params for CourseDetailView
import { useParams } from "react-router-dom";

const CourseDetailViewWrapper: React.FC<{
  onBack: () => void;
  onSelectLecture: (courseId: string, lectureId: string) => void;
  onCreateLecture: (courseId: string) => void;
}> = ({ onBack, onSelectLecture, onCreateLecture }) => {
  const { courseId } = useParams<{ courseId: string }>();

  if (!courseId) return null;

  return (
    <CourseDetailView
      courseId={courseId}
      onBack={onBack}
      onSelectLecture={(lectureId: string) => onSelectLecture(courseId, lectureId)}
      onCreateLecture={onCreateLecture}
    />
  );
};

export default App;
