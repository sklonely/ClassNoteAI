import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, ArrowLeft, Pencil, Cpu, Loader2, FileText, Mic, MicOff, Pause, Square, Save, BookOpen, FolderOpen, Wand2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { storageService } from "../services/storageService";
import { ollamaService } from "../services/ollamaService";
import { Lecture, Note, RecordingStatus } from "../types";
import CourseCreationDialog from "./CourseCreationDialog";
import { AudioRecorder } from "../services/audioRecorder";
import SubtitleDisplay from "./SubtitleDisplay";
import { transcriptionService } from "../services/transcriptionService";
import { loadModel, checkModelFile } from "../services/whisperService";
import * as translationModelService from "../services/translationModelService";
import { subtitleService } from "../services/subtitleService";
import PDFViewer, { PDFViewerHandle } from "./PDFViewer";
import DragDropZone from "./DragDropZone";
import { selectPDFFile } from "../services/fileService";
import { autoAlignmentService, AlignmentSuggestion } from "../services/autoAlignmentService";
import { embeddingService } from "../services/embeddingService";
import { pdfService } from "../services/pdfService";

type ViewMode = 'recording' | 'review';

export default function NotesView() {
  const navigate = useNavigate();
  const { courseId, lectureId } = useParams<{ courseId: string; lectureId: string }>();

  const [currentLectureData, setCurrentLectureData] = useState<Lecture | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('review');

  // Recording State
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [volume, setVolume] = useState(0);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [alignmentSuggestion, setAlignmentSuggestion] = useState<AlignmentSuggestion | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const pdfViewerRef = useRef<PDFViewerHandle>(null);
  const modelsLoadingRef = useRef(false);
  const modelLoadedRef = useRef(false);

  // Sync modelLoaded state to ref
  useEffect(() => {
    modelLoadedRef.current = modelLoaded;
  }, [modelLoaded]);

  // Load Lecture Data
  useEffect(() => {
    if (lectureId) {
      loadLectureData(lectureId);
    }

    return () => {
      // Cleanup on unmount
      transcriptionService.stop();
      if (audioRecorderRef.current) {
        audioRecorderRef.current.destroy();
      }
    };
  }, [lectureId]);

  // Load Models
  useEffect(() => {
    if (modelsLoadingRef.current) return;

    const checkAndLoadModels = async () => {
      modelsLoadingRef.current = true;
      try {
        const settings = await storageService.getAppSettings();
        const whisperModel = (settings?.models?.whisper || 'base') as 'tiny' | 'base' | 'small' | 'medium' | 'large';

        const whisperExists = await checkModelFile(whisperModel);
        if (whisperExists && !modelLoaded) {
          console.log('[NotesView] Loading Whisper model...', whisperModel);
          await loadModel(whisperModel);
          setModelLoaded(true);
          console.log('[NotesView] Whisper model loaded');
        }

        // Load Embedding Model for Auto Alignment
        try {
          console.log('[NotesView] Loading Embedding model for auto-alignment...');
          // Model files should be in app data directory
          const appDataDir = await invoke<string>('get_app_data_dir');
          const modelPath = `${appDataDir}/models/all-MiniLM-L6-v2.onnx`;
          const tokenizerPath = `${appDataDir}/models/all-MiniLM-L6-v2-tokenizer.json`;

          await embeddingService.loadModel(modelPath, tokenizerPath);
          console.log('[NotesView] Embedding model loaded successfully');
        } catch (embErr) {
          console.warn('[NotesView] Embedding model not available:', embErr);
          console.log('[NotesView] Starting automatic download of Embedding model...');

          try {
            // Automatically download the model
            await invoke('download_embedding_model_cmd');
            console.log('[NotesView] Embedding model downloaded successfully');

            // Try loading again
            const appDataDir = await invoke<string>('get_app_data_dir');
            const modelPath = `${appDataDir}/models/all-MiniLM-L6-v2.onnx`;
            const tokenizerPath = `${appDataDir}/models/all-MiniLM-L6-v2-tokenizer.json`;
            await embeddingService.loadModel(modelPath, tokenizerPath);
            console.log('[NotesView] Embedding model loaded successfully after download');
          } catch (downloadErr) {
            console.error('[NotesView] Failed to download Embedding model:', downloadErr);
            console.warn('[NotesView] Auto-alignment feature will be disabled');
          }
        }
        // Load Translation Model if provider is local
        const translationProvider = settings?.translation?.provider || 'local';
        if (translationProvider === 'local') {
          const translationModel = settings?.models?.translation || 'm2m100-418M-ct2-int8'; // CT2 model
          // Check if model is already loaded to avoid reloading
          const currentTranslationModel = translationModelService.getCurrentModel();

          if (currentTranslationModel !== translationModel) {
            console.log('[NotesView] Loading Translation model...', translationModel);
            try {
              await translationModelService.loadTranslationModelByName(translationModel);
              console.log('[NotesView] Translation model loaded successfully');
            } catch (transErr) {
              console.error('[NotesView] Failed to load Translation model:', transErr);
              // Try to download if not found? For now just log error
            }
          }
        }
      } catch (error) {
        console.error('[NotesView] Failed to load models:', error);
        modelsLoadingRef.current = false;
      }
    };

    checkAndLoadModels();
  }, []);

  // Initialize Audio Recorder
  useEffect(() => {
    const recorder = new AudioRecorder({
      sampleRate: 48000,
      channelCount: 1,
    });

    recorder.onStatusChange((status) => {
      const statusMap: Record<string, RecordingStatus> = {
        idle: 'idle',
        recording: 'recording',
        paused: 'paused',
        stopped: 'stopped',
        error: 'idle',
      };
      setRecordingStatus(statusMap[status] || 'idle');
    });

    recorder.onError((error) => {
      console.error('[NotesView] Audio recorder error:', error);
      alert(`Recording error: ${error.message}`);
    });

    recorder.onChunk((chunk) => {
      // Calculate volume
      const samples = chunk.data;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const normalized = samples[i] / 32768;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const volumeDb = 20 * Math.log10(rms + 0.0001);
      const volumePercent = Math.max(0, Math.min(100, (volumeDb + 60) / 60 * 100));
      setVolume(volumePercent);

      if (modelLoadedRef.current) {
        transcriptionService.addAudioChunk(chunk);
      }
    });

    audioRecorderRef.current = recorder;
  }, []);

  // Initialize Auto Alignment
  useEffect(() => {
    const initAlignment = async () => {
      if (modelLoaded && pdfData) {
        try {
          console.log("Processing PDF for alignment...");
          // Clone buffer to prevent detachment by worker
          const bufferCopy = pdfData.slice(0);
          const pages = await pdfService.extractAllPagesText(bufferCopy);
          const pageEmbeddings = [];
          for (const p of pages) {
            try {
              const emb = await embeddingService.generateEmbedding(p.text);
              pageEmbeddings.push({ pageNumber: p.page, text: p.text, embedding: emb });
            } catch (e) {
              console.error(`Failed to embed page ${p.page}`, e);
            }
          }
          autoAlignmentService.setPageEmbeddings(pageEmbeddings);
          console.log("PDF alignment data ready");
        } catch (e) {
          console.error("Failed to init alignment", e);
        }
      }
    };
    initAlignment();
  }, [pdfData, modelLoaded]);

  // Listen to Alignment Suggestions
  useEffect(() => {
    const unsubscribe = autoAlignmentService.onSuggestion((suggestion) => {
      setAlignmentSuggestion(suggestion);
      if (autoScrollEnabled && pdfViewerRef.current) {
        pdfViewerRef.current.scrollToPage(suggestion.pageNumber);
      }
    });
    return unsubscribe;
  }, [autoScrollEnabled]);

  const loadLectureData = async (id: string) => {
    try {
      setIsLoading(true);
      const lecture = await storageService.getLecture(id);
      if (lecture) {
        setCurrentLectureData(lecture);

        // Determine initial view mode
        if (lecture.status === 'recording') {
          setViewMode('recording');
        } else {
          setViewMode('review');
        }

        // Setup Transcription Service
        transcriptionService.setLectureId(lecture.id);

        // Fetch Course to get global keywords and syllabus info
        let courseKeywords = '';
        let contextPrompt = '';

        if (lecture.course_id) {
          const course = await storageService.getCourse(lecture.course_id);
          if (course) {
            if (course.keywords) {
              courseKeywords = course.keywords;
            }

            // Construct context from syllabus info
            if (course.syllabus_info) {
              const { topic } = course.syllabus_info;
              if (topic) {
                contextPrompt = `The following is a university lecture about ${topic}.`;
              }
            }
          }
        }

        // Combine keywords
        const allKeywords = [courseKeywords, lecture.keywords].filter(Boolean).join(', ');

        // Append keywords to prompt in a natural way
        if (allKeywords) {
          contextPrompt += ` Key terms include: ${allKeywords}.`;
        }

        // Set initial prompt with natural language context
        transcriptionService.setInitialPrompt(contextPrompt, allKeywords);

        // Load PDF if available
        // Load PDF if available
        if (lecture.pdf_path) {
          setPdfPath(lecture.pdf_path);

          // Load PDF data if path exists
          try {
            console.log('[NotesView] Loading PDF data from:', lecture.pdf_path);
            const pdfData = await invoke<number[]>('read_binary_file', { path: lecture.pdf_path });
            const arrayBuffer = new Uint8Array(pdfData).buffer;
            setPdfData(arrayBuffer);
            console.log('[NotesView] PDF data loaded successfully, size:', arrayBuffer.byteLength);
          } catch (error) {
            console.error('[NotesView] Failed to load PDF data:', error);
            // Don't clear pdfPath, so we can try again or show error
          }
        }

        // Load Subtitles
        const subtitles = await storageService.getSubtitles(lecture.id);
        if (subtitles.length > 0) {
          subtitleService.clear();
          subtitles.forEach((sub) => {
            subtitleService.addSegment({
              id: sub.id,
              roughText: sub.text_en,
              roughTranslation: sub.text_zh,
              displayText: sub.text_en,
              displayTranslation: sub.text_zh,
              startTime: sub.timestamp * 1000,
              endTime: (sub.timestamp + 5) * 1000,
              source: sub.type === 'fine' ? 'fine' : 'rough',
              translationSource: sub.text_zh ? (sub.type === 'fine' ? 'fine' : 'rough') : undefined,
              text: sub.text_en,
              translatedText: sub.text_zh,
            });
          });
        }

        // Load Notes
        const note = await storageService.getNote(id);
        setSelectedNote(note);
      } else {
        console.error('Lecture not found:', id);
      }
    } catch (error) {
      console.error('Failed to load lecture data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartRecording = async () => {
    try {
      if (!audioRecorderRef.current || !currentLectureData) return;
      if (!modelLoaded) {
        alert('Please load Whisper model in settings first');
        return;
      }

      // CRITICAL: Save lecture to DB BEFORE setting lectureId on transcription service
      // This ensures the lecture exists when auto-save tries to save subtitles
      const updatedLecture = { ...currentLectureData, status: 'recording' as const };
      await storageService.saveLecture(updatedLecture);
      setCurrentLectureData(updatedLecture);

      // Now it's safe to set lectureId and start transcription
      transcriptionService.clear();
      transcriptionService.setLectureId(currentLectureData.id);
      transcriptionService.start();

      await audioRecorderRef.current.start();
      setRecordingStatus("recording");
      setRecordingStartTime(Date.now());
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to start recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      if (!audioRecorderRef.current) return;

      transcriptionService.stop();
      await audioRecorderRef.current.stop();
      setRecordingStatus("stopped");
      setVolume(0);

      await handleSaveLecture();
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  const handlePauseRecording = () => {
    try {
      if (!audioRecorderRef.current) return;
      audioRecorderRef.current.pause();
      transcriptionService.pause();
      setRecordingStatus("paused");
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  };

  const handleResumeRecording = async () => {
    try {
      if (!audioRecorderRef.current) return;
      await audioRecorderRef.current.resume();
      transcriptionService.resume();
      setRecordingStatus("recording");
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  };

  const handleSaveLecture = async () => {
    if (!currentLectureData) return;

    try {
      setSaveStatus('saving');
      const segments = subtitleService.getSegments();
      const duration = recordingStartTime
        ? Math.floor((Date.now() - recordingStartTime) / 1000)
        : currentLectureData.duration;

      const updatedLecture: Lecture = {
        ...currentLectureData,
        duration,
        status: recordingStatus === "recording" ? "recording" : "completed",
        pdf_path: pdfPath || currentLectureData.pdf_path,
        updated_at: new Date().toISOString(),
      };

      await storageService.saveLecture(updatedLecture);

      if (segments.length > 0) {
        const now = new Date().toISOString();
        const subtitles = segments.map(seg => ({
          id: seg.id,
          lecture_id: currentLectureData.id,
          timestamp: seg.startTime / 1000,
          text_en: seg.displayText || seg.roughText || '',
          text_zh: seg.displayTranslation || seg.roughTranslation || undefined,
          type: (seg.source === 'fine' ? 'fine' : 'rough') as 'rough' | 'fine',
          confidence: undefined,
          created_at: now,
        }));
        await storageService.saveSubtitles(subtitles);
      }

      setCurrentLectureData(updatedLecture);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save lecture:', error);
      setSaveStatus('error');
    }
  };

  const updateLecturePDF = async (path: string) => {
    if (!currentLectureData) return;
    try {
      console.log('[NotesView] Updating lecture PDF path:', path);
      setPdfPath(path);

      const updatedLecture = {
        ...currentLectureData,
        pdf_path: path,
        updated_at: new Date().toISOString()
      };

      await storageService.saveLecture(updatedLecture);
      setCurrentLectureData(updatedLecture);
      console.log('[NotesView] Lecture PDF path saved successfully');
    } catch (error) {
      console.error('[NotesView] Failed to save lecture PDF path:', error);
    }
  };

  const handleSelectPDF = async () => {
    const result = await selectPDFFile();
    if (result) {
      // Check if it's a non-PDF file that needs conversion
      const fileName = result.path?.toLowerCase() || '';
      const needsConversion = fileName.endsWith('.ppt') || fileName.endsWith('.pptx') ||
        fileName.endsWith('.doc') || fileName.endsWith('.docx');

      if (needsConversion && result.path) {
        await convertAndLoadDocument(result.path);
      } else {
        setPdfData(result.data);
        if (result.path) {
          await updateLecturePDF(result.path);
        } else {
          setPdfPath(null);
        }
      }
    }
  };

  const handleFileDrop = async (file: File) => {
    const fileName = file.name.toLowerCase();
    const isPdf = fileName.endsWith('.pdf') || file.type === 'application/pdf';
    const isSupported = isPdf || fileName.endsWith('.ppt') || fileName.endsWith('.pptx') ||
      fileName.endsWith('.doc') || fileName.endsWith('.docx');

    if (!isSupported) {
      alert('Please drop a PDF, PPT, or Word file');
      return;
    }

    if (!isPdf) {
      // Need to convert - save to temp location first
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          // Save dropped file to temp location
          const tempDir = await invoke<string>('get_temp_dir').catch(() => '/tmp');
          const tempPath = `${tempDir}/${file.name}`;

          // Write file (we'll need a Tauri command for this)
          const arrayBuffer = event.target.result as ArrayBuffer;
          const uint8Array = new Uint8Array(arrayBuffer);

          try {
            await invoke('write_temp_file', {
              path: tempPath,
              data: Array.from(uint8Array)
            });
            await convertAndLoadDocument(tempPath);
          } catch (error) {
            console.error('Failed to save temp file:', error);
            alert('Failed to process file. Please try selecting it instead.');
          }
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Direct PDF load
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          setPdfData(event.target.result as ArrayBuffer);
          // Note: Dropped files might not have a persistent path we can use easily
          // unless we save them. For now, we just show them.
          // If we want persistence for dropped PDFs, we should save them to app data.
          setPdfPath(null);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const convertAndLoadDocument = async (filePath: string) => {
    setIsConverting(true);
    try {
      console.log('[NotesView] Converting document to PDF:', filePath);
      const pdfPath = await invoke<string>('convert_to_pdf', { filePath });
      console.log('[NotesView] Conversion successful:', pdfPath);

      // Read the converted PDF file directly as ArrayBuffer instead of using path
      console.log('[NotesView] Reading converted PDF file...');
      const pdfData = await invoke<number[]>('read_binary_file', { path: pdfPath });
      const arrayBuffer = new Uint8Array(pdfData).buffer;

      console.log('[NotesView] PDF loaded, size:', arrayBuffer.byteLength);
      setPdfData(arrayBuffer);

      // Persist the converted PDF path
      await updateLecturePDF(pdfPath);

    } catch (error) {
      console.error('[NotesView] Conversion failed:', error);
      alert(`Failed to convert document: ${error}`);
    } finally {
      setIsConverting(false);
    }
  };

  const handleTextExtract = (_text: string) => {
    // Only extract keywords from PDF if we don't have course keywords
    // or if the text is substantial.
    // But to avoid overwriting good keywords with generic ones, we should be careful.

    // For now, if we already have a prompt set (from course keywords), let's NOT overwrite it
    // with the simple regex extractor results, as they tend to be generic.
    // We only use this if the prompt is empty.

    // Check if transcriptionService already has keywords
    // Since we can't easily check private state, we'll rely on our local knowledge
    // that loadLectureData runs first.

    // If we want to merge, we need to be smarter.
    // For now, disabling the auto-overwrite from PDF text to fix the user's issue.
    console.log('[NotesView] PDF text extracted, skipping auto-keyword update to preserve course context.');

    /* 
    if (text && text.trim().length > 0) {
      const initialPrompt = extractKeywordsFromPDF(text);
      transcriptionService.setInitialPrompt(initialPrompt);
    }
    */
  };

  const handleBack = () => {
    if (recordingStatus === 'recording') {
      if (!confirm('Recording is in progress. Are you sure you want to leave? Recording will stop.')) {
        return;
      }
      handleStopRecording();
    }
    navigate(courseId ? `/course/${courseId}` : '/');
  };

  const handleGenerateSummary = async (language: 'zh' | 'en') => {
    if (!selectedNote) return;
    setIsGeneratingSummary(true);
    try {
      const content = selectedNote.sections.map(s => s.content).join('\n\n');
      if (!content.trim()) throw new Error('Content is empty');

      // Attempt to extract PDF context for Deep Summarization
      let pdfContext = undefined;
      if (pdfData) {
        try {
          console.log('[NotesView] Extracting PDF context for Deep Summarization...');
          const pages = await pdfService.extractAllPagesText(pdfData);
          pdfContext = pages.map(p => p.text).join('\n\n');
          console.log(`[NotesView] PDF context extracted: ${pdfContext.length} chars`);
        } catch (e) {
          console.warn('[NotesView] Failed to extract PDF context:', e);
        }
      }

      const summary = await ollamaService.summarizeCourse(content, language, pdfContext);
      const updatedNote = { ...selectedNote, summary };
      await storageService.saveNote(updatedNote);
      setSelectedNote(updatedNote);
      alert('Summary generated successfully!');
    } catch (error) {
      alert(`Failed to generate summary: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleExport = async (format: "markdown" | "pdf") => {
    if (!currentLectureData || !selectedNote) {
      alert('無法導出：數據不完整');
      return;
    }

    try {
      if (format === "markdown") {
        let markdown = `# ${selectedNote.title}\n\n`;
        markdown += `生成時間: ${new Date(selectedNote.generated_at).toLocaleString('zh-CN')}\n\n`;

        if (selectedNote.sections && selectedNote.sections.length > 0) {
          if (selectedNote.summary) {
            markdown += "## 課程總結\n\n";
            markdown += `${selectedNote.summary}\n\n`;
          }
          markdown += "## 課程內容\n\n";
          selectedNote.sections.forEach((section, index) => {
            markdown += `### ${section.title || `章節 ${index + 1}`}\n\n`;
            markdown += `${section.content}\n\n`;
            if (section.timestamp) {
              const minutes = Math.floor(section.timestamp / 60);
              const seconds = Math.floor(section.timestamp % 60);
              markdown += `*時間戳: ${minutes}:${seconds.toString().padStart(2, '0')}*\n\n`;
            }
          });
        }

        if (selectedNote.qa_records && selectedNote.qa_records.length > 0) {
          markdown += "## 問答記錄\n\n";
          selectedNote.qa_records.forEach((qa, index) => {
            markdown += `### 問題 ${index + 1}\n\n`;
            markdown += `**Q:** ${qa.question}\n\n`;
            markdown += `**A:** ${qa.answer}\n\n`;
            if (qa.timestamp) {
              const minutes = Math.floor(qa.timestamp / 60);
              const seconds = Math.floor(qa.timestamp % 60);
              markdown += `*時間戳: ${minutes}:${seconds.toString().padStart(2, '0')}*\n\n`;
            }
          });
        }

        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedNote.title.replace(/[^a-z0-9]/gi, '_')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert('PDF 導出功能尚未實現');
      }
    } catch (error) {
      console.error('導出失敗:', error);
      alert(`導出失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!currentLectureData) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 text-gray-500">
        <p className="text-lg mb-4">Lecture not found</p>
        <button onClick={handleBack} className="text-blue-500 hover:underline">Back</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={handleBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100">
              {currentLectureData.title}
              <button onClick={() => setIsEditDialogOpen(true)} className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
                <Pencil size={16} />
              </button>
            </h2>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-1">
              {recordingStatus === 'recording' && (
                <span className="flex items-center gap-1 text-red-500 animate-pulse">
                  <div className="w-2 h-2 bg-red-500 rounded-full" />
                  Recording
                </span>
              )}
              <span>{viewMode === 'recording' ? 'Live Mode' : 'Review Mode'}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {/* View Mode Toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 mr-2">
            <button
              onClick={() => setViewMode('recording')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${viewMode === 'recording'
                ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
            >
              Live Recording
            </button>
            <button
              onClick={() => setViewMode('review')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${viewMode === 'review'
                ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
            >
              Notes Review
            </button>

          </div>

          {/* Auto Scroll Toggle */}
          {viewMode === 'recording' && (
            <button
              onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
              className={`flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium transition-all mr-2 ${autoScrollEnabled
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                }`}
              title="Auto-follow slides based on speech"
            >
              <Wand2 size={16} />
              <span className="hidden sm:inline">Auto-Follow</span>
            </button>
          )}

          {/* Save Button (Visible in Recording Mode) */}
          {viewMode === 'recording' && (
            <button
              onClick={handleSaveLecture}
              disabled={saveStatus === 'saving'}
              className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
            >
              <Save size={18} />
              <span className="hidden sm:inline">{saveStatus === 'saving' ? 'Saving...' : 'Save'}</span>
            </button>
          )}

          {/* Summary & Export Buttons (Visible in Review Mode) */}
          {viewMode === 'review' && selectedNote && (
            <>
              <button onClick={() => handleGenerateSummary('zh')} disabled={isGeneratingSummary} className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50">
                {isGeneratingSummary ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                <span className="hidden sm:inline">Summary (ZH)</span>
              </button>
              <button onClick={() => handleExport("markdown")} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                <Download size={18} />
                <span className="hidden sm:inline">Export</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'recording' ? (
          // Recording Mode Layout (Split View)
          <div className="flex h-full">
            {/* Left: PDF Viewer */}
            <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700">
              {(pdfPath || pdfData) && (
                <div className="px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-md">
                    {pdfPath ? (pdfPath.startsWith('blob:') ? 'Dropped File' : pdfPath.split("/").pop()) : 'Selected PDF'}
                  </span>
                  <button onClick={handleSelectPDF} className="px-3 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    Change
                  </button>
                </div>
              )}
              <DragDropZone onFileDrop={handleFileDrop} className="flex-1 overflow-hidden">
                {pdfPath || pdfData ? (
                  <PDFViewer
                    ref={pdfViewerRef}
                    filePath={pdfPath || undefined}
                    pdfData={pdfData || undefined}
                    onTextExtract={handleTextExtract}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
                    <div className="text-center">
                      <FolderOpen size={64} className="mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                      <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">No PDF Selected</p>
                      <button onClick={handleSelectPDF} className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                        Select PDF
                      </button>
                      {isConverting && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Converting document to PDF...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </DragDropZone>
              {/* Alignment Suggestion Notification */}
              {alignmentSuggestion && !autoScrollEnabled && (
                <button
                  className="absolute bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-bounce z-50 hover:bg-blue-700 transition-colors"
                  onClick={() => {
                    if (pdfViewerRef.current) {
                      pdfViewerRef.current.scrollToPage(alignmentSuggestion.pageNumber);
                      setAlignmentSuggestion(null);
                    }
                  }}
                >
                  <Wand2 size={16} />
                  <span>Jump to Slide {alignmentSuggestion.pageNumber}</span>
                  <span className="text-xs opacity-75">({(alignmentSuggestion.confidence * 100).toFixed(0)}%)</span>
                </button>
              )}
            </div>

            {/* Right: Subtitles & Controls */}
            <div className="w-96 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800">
              <div className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">
                <h2 className="text-lg font-semibold mb-4 flex-shrink-0 dark:text-white">Live Subtitles</h2>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <SubtitleDisplay maxLines={10} fontSize={16} position="bottom" />
                </div>
              </div>

              {/* Recording Controls */}
              <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MicOff size={16} className="text-gray-400" />
                    <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all" style={{ width: `${volume}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">{recordingStatus === 'recording' ? 'Recording...' : 'Ready'}</span>
                </div>

                <div className="flex gap-2">
                  {recordingStatus === 'idle' || recordingStatus === 'stopped' ? (
                    <button onClick={handleStartRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium">
                      <Mic size={20} /> Start
                    </button>
                  ) : recordingStatus === 'recording' ? (
                    <>
                      <button onClick={handlePauseRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors font-medium">
                        <Pause size={20} /> Pause
                      </button>
                      <button onClick={handleStopRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium">
                        <Square size={20} /> Stop
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={handleResumeRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium">
                        <Mic size={20} /> Resume
                      </button>
                      <button onClick={handleStopRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium">
                        <Square size={20} /> Stop
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Review Mode Layout (Existing Notes View)
          <div className="h-full overflow-auto p-6 bg-gray-50 dark:bg-gray-900">
            {selectedNote ? (
              <div className="max-w-4xl mx-auto prose dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-100">
                {selectedNote.summary && (
                  <div className="mb-8 p-6 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                    <div className="flex items-center gap-2 mb-4 text-indigo-700 dark:text-indigo-400">
                      <FileText className="w-5 h-5" />
                      <h2 className="text-xl font-bold m-0">Summary</h2>
                    </div>
                    <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {selectedNote.summary}
                    </div>
                  </div>
                )}

                {selectedNote.sections?.map((section, index) => (
                  <div key={index} className="mb-6 p-4 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold mb-2">{section.title || `Section ${index + 1}`}</h3>
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{section.content}</p>
                    {section.timestamp && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        Timestamp: {Math.floor(section.timestamp / 60)}:{Math.floor(section.timestamp % 60).toString().padStart(2, '0')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
                <BookOpen className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-lg">No notes available yet</p>
                <p className="text-sm">Notes will be generated after recording is completed</p>
              </div>
            )}
          </div>
        )}
      </div>

      {
        currentLectureData && (
          <CourseCreationDialog
            isOpen={isEditDialogOpen}
            onClose={() => setIsEditDialogOpen(false)}
            onSubmit={async (title, keywords) => {
              const updated = { ...currentLectureData, title, keywords, updated_at: new Date().toISOString() };
              await storageService.saveLecture(updated);
              setCurrentLectureData(updated);
              setIsEditDialogOpen(false);
            }}
            initialTitle={currentLectureData.title}
            initialKeywords={currentLectureData.keywords}
            mode="edit"
          />
        )
      }
    </div >
  );
}
