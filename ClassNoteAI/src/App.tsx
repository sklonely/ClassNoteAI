import { Routes, Route } from "react-router-dom";
import MainWindow from "./components/MainWindow";
import LectureView from "./components/LectureView";
import NotesView from "./components/NotesView";
import SettingsView from "./components/SettingsView";
import TranscriptionTest from "./components/TranscriptionTest";
import { TranslationModelTest } from "./components/TranslationModelTest";

function App() {
  return (
    <MainWindow>
      <Routes>
        <Route path="/" element={<LectureView />} />
        <Route path="/notes" element={<NotesView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/test" element={<TranscriptionTest />} />
        <Route path="/test-translation" element={<TranslationModelTest />} />
      </Routes>
    </MainWindow>
  );
}

export default App;
