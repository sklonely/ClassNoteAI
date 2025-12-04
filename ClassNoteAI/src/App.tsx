import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import MainWindow from "./components/MainWindow";
import CourseListView from "./components/CourseListView";
import CourseDetailView from "./components/CourseDetailView";
import NotesView from "./components/NotesView";
import SettingsView from "./components/SettingsView";
import TranscriptionTest from "./components/TranscriptionTest";
import { TranslationModelTest } from "./components/TranslationModelTest";
import { storageService } from "./services/storageService";

function App() {
  const navigate = useNavigate();

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

  return (
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
