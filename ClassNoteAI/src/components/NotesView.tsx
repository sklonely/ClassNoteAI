import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Download, ArrowLeft, Pencil, Cpu, Loader2, FileText, Mic, MicOff, Pause, Square, Save, BookOpen, FolderOpen, Wand2, Bot } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { storageService } from "../services/storageService";
import { ollamaService } from "../services/ollamaService";
import { taskService } from "../services/taskService";
import { Lecture, Note, RecordingStatus } from "../types";
import CourseCreationDialog from "./CourseCreationDialog";
import { AudioRecorder } from "../services/audioRecorder";
import SubtitleDisplay from "./SubtitleDisplay";
import AudioPlayer from "./AudioPlayer";
import { transcriptionService } from "../services/transcriptionService";
import { loadModel, checkModelFile } from "../services/whisperService";
import * as translationModelService from "../services/translationModelService";
import { subtitleService } from "../services/subtitleService";
import PDFViewer, { PDFViewerHandle } from "./PDFViewer";
import DragDropZone from "./DragDropZone";
import { selectPDFFile } from "../services/fileService";
import { autoAlignmentService, AlignmentSuggestion } from "../services/autoAlignmentService";
import { pdfService } from "../services/pdfService";
import { syncService } from "../services/syncService";
import AIChatPanel from "./AIChatPanel";

type ViewMode = 'recording' | 'review';

interface NotesViewProps {
  courseId?: string;
  lectureId?: string;
  onBack?: () => void;
}

export default function NotesView({ courseId: propCourseId, lectureId: propLectureId, onBack }: NotesViewProps) {
  const navigate = useNavigate();
  const params = useParams<{ courseId: string; lectureId: string }>();

  const courseId = propCourseId || params.courseId;
  const lectureId = propLectureId || params.lectureId;

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
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [pdfTextContent, setPdfTextContent] = useState<string>('');
  const [transcriptContent, setTranscriptContent] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);

  // Note Editing State
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editedNote, setEditedNote] = useState<Note | null>(null);
  const [, setNoteSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');


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
      // Stop recording when switching lectures, but don't destroy recorder instance
      // unless component unmounts (handled by recorder effect)
      transcriptionService.stop();
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stop();
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

        // Embedding Model: 使用 Ollama 遠程 nomic-embed-text，無需本地加載
        console.log('[NotesView] Using Ollama remote nomic-embed-text for auto-alignment');
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

  // DEBUG: Check lecture data
  useEffect(() => {
    if (currentLectureData) {
      console.log('[NotesView DEBUG] Current Lecture:', {
        id: currentLectureData.id,
        title: currentLectureData.title,
        audio_path: currentLectureData.audio_path,
        hasAudio: !!currentLectureData.audio_path,
        viewMode
      });
    }
  }, [currentLectureData, viewMode]);

  // Audio & Review State
  const [activeTab, setActiveTab] = useState<'note' | 'subtitles'>('note');
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackVolume, setPlaybackVolume] = useState(100); // Output volume for playback

  // Initialize audio when review mode starts or lecture loads
  // Initialize audio when review mode starts or lecture loads
  useEffect(() => {
    let objectUrl: string | null = null;

    const loadAudio = async () => {
      if (viewMode === 'review' && currentLectureData?.audio_path && audioRef.current) {
        try {
          console.log('[NotesView] Loading audio file:', currentLectureData.audio_path);
          // Use readFile from plugin-fs to bypass asset protocol issues
          const data = await readFile(currentLectureData.audio_path);
          const blob = new Blob([data], { type: 'audio/wav' }); // Default to wav as per recorder
          objectUrl = URL.createObjectURL(blob);

          if (audioRef.current) {
            audioRef.current.src = objectUrl;
            audioRef.current.load();
            console.log('[NotesView] Audio loaded via Blob URL');
          }
        } catch (error) {
          console.error('[NotesView] Failed to load audio file:', error);
          // Fallback to convertFileSrc if readFile fails (e.g. permission error but assuming asset protocol works?)
          // But since asset URL is failing, better to just log error.
        }
      }
    };

    loadAudio();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [viewMode, currentLectureData?.audio_path]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(console.error);
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setAudioCurrentTime(time);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setAudioCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
    }
  };

  const handleSubtitleSeek = (timestamp: number) => {
    // timestamp is absolute Date time (ms). We need relative seconds.
    // Assuming recording started at lecture.created_at? 
    // Or first segment start time? 
    // Ideally we store 'recording_start_time' in lecture.
    // Fallback: Use 1st segment start time as rough base 
    // OR assume 0 if we can't determine.
    // In "Live Recording", usually the first segment starts at ~0-5s.
    // Let's rely on segment data if available.
    // Actually, simpler approach:
    // If we use `created_at` of the lecture as start time.
    if (!currentLectureData) return;

    const lectureStart = new Date(currentLectureData.created_at).getTime();
    const seekTime = (timestamp - lectureStart) / 1000;

    // Sanity check: seek time should be positive.
    // If user started recording later than creation? 
    // This is tricky without explicit 'recording_start_timestamp'.
    // But usually acceptable to assume created_at ~= start.
    // Better: check first segment.
    // If seekTime < 0, maybe use 0.
    handleSeek(Math.max(0, seekTime));
  };

  // Check Ollama Connection
  useEffect(() => {
    const checkOllama = async () => {
      try {
        const connected = await ollamaService.checkConnection();
        setOllamaConnected(connected);
      } catch {
        setOllamaConnected(false);
      }
    };
    checkOllama();
    // Re-check every 30 seconds
    const interval = setInterval(checkOllama, 30000);
    return () => clearInterval(interval);
  }, []);

  // Update transcript content when note changes
  useEffect(() => {
    if (selectedNote?.sections) {
      const content = selectedNote.sections.map(s => s.content).join('\n\n');
      setTranscriptContent(content);
    }
  }, [selectedNote]);

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

    // Cleanup on unmount
    return () => {
      if (audioRecorderRef.current) {
        audioRecorderRef.current.destroy();
      }
    };
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

          // Map to server format
          const pageData = pages.map(p => ({ page_number: p.page, text: p.text }));

          if (currentLectureData) {
            console.log('[NotesView] Triggering server-side PDF indexing...');
            const task = await taskService.triggerIndexing(currentLectureData.id, pageData);

            if (!task) {
              console.log('[NotesView] Indexing queued (offline).');
              return;
            }

            console.log('[NotesView] Indexing task started:', task.id);

            await taskService.pollUntilCompletion(task.id);
            console.log('[NotesView] Indexing task completed. Fetching embeddings...');

            const serverEmbeddings = await taskService.getLectureEmbeddings(currentLectureData.id);

            const alignmentEmbeddings = serverEmbeddings.map(e => ({
              pageNumber: e.page_number,
              text: e.content,
              embedding: e.embedding
            }));

            autoAlignmentService.setPageEmbeddings(alignmentEmbeddings);
            console.log("PDF alignment data ready (from server)");
          } else {
            console.warn('Cannot index PDF: Lecture ID not available');
          }
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

      // Reset State to prevent data leakage between lectures
      setPdfPath(null);
      setPdfData(null);
      setPdfTextContent('');
      setAudioDuration(0);
      setAudioCurrentTime(0);
      setTranscriptContent('');
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load();
      }

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
        if (lecture.pdf_path) {
          setPdfPath(lecture.pdf_path);

          // Loaf PDF data
          try {
            // ...
          } catch (e) { /* ... */ }
        }

        // Try to recover audio path if missing (Fix for Schema migration issue)
        if (!lecture.audio_path) {
          console.log('[NotesView] Audio path missing, attempting recovery...');
          try {
            const recoveredPath = await invoke<string | null>('try_recover_audio_path', { lectureId: lecture.id });
            if (recoveredPath) {
              console.log('[NotesView] Audio path recovered:', recoveredPath);
              lecture.audio_path = recoveredPath;
              // Update state immediately so UI renders
              setCurrentLectureData({ ...lecture });
            } else {
              console.log('[NotesView] No audio file found for recovery.');
            }
          } catch (recErr) {
            console.error('[NotesView] Audio recovery failed:', recErr);
          }
        }

        // Initial PDF load logic was here, merging...
        if (lecture.pdf_path) {
          // ... (existing PDF loading logic)
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
        subtitleService.clear();
        subtitleService.setLectureId(lecture.id); // Enable database sync
        if (subtitles.length > 0) {
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

        // ===== AUTO-GENERATE NOTES FOR EXISTING LECTURES =====
        // If no notes exist but subtitles do, generate notes from subtitles
        // Check BOTH database subtitles AND in-memory subtitleService segments
        const inMemorySegments = subtitleService.getSegments();
        const hasSubtitles = subtitles.length > 0 || inMemorySegments.length > 0;

        console.log('[NotesView] Notes check - note exists:', !!note, ', db subtitles:', subtitles.length, ', in-memory segments:', inMemorySegments.length);

        if (!note && hasSubtitles) {
          console.log('[NotesView] No notes found but subtitles exist. Auto-generating notes...');

          const SECTION_DURATION_SEC = 300; // 5 minutes per section
          const sections: { title: string; content: string; timestamp: number }[] = [];

          let currentSectionStart = 0;
          let currentSectionContent: string[] = [];
          let sectionIndex = 1;

          // Use database subtitles if available, otherwise use in-memory segments
          if (subtitles.length > 0) {
            for (const sub of subtitles) {
              const segTimestamp = sub.timestamp;

              if (segTimestamp - currentSectionStart >= SECTION_DURATION_SEC && currentSectionContent.length > 0) {
                sections.push({
                  title: `Section ${sectionIndex}`,
                  content: currentSectionContent.join(' '),
                  timestamp: currentSectionStart,
                });
                sectionIndex++;
                currentSectionStart = segTimestamp;
                currentSectionContent = [];
              }

              const text = sub.text_zh || sub.text_en || '';
              if (text.trim()) {
                currentSectionContent.push(text.trim());
              }
            }
          } else {
            // Use in-memory segments as fallback
            for (const seg of inMemorySegments) {
              const segTimestamp = seg.startTime / 1000;

              if (segTimestamp - currentSectionStart >= SECTION_DURATION_SEC && currentSectionContent.length > 0) {
                sections.push({
                  title: `Section ${sectionIndex}`,
                  content: currentSectionContent.join(' '),
                  timestamp: currentSectionStart,
                });
                sectionIndex++;
                currentSectionStart = segTimestamp;
                currentSectionContent = [];
              }

              const text = seg.displayTranslation || seg.roughTranslation || seg.displayText || seg.roughText || '';
              if (text.trim()) {
                currentSectionContent.push(text.trim());
              }
            }
          }

          // Save the last section
          if (currentSectionContent.length > 0) {
            sections.push({
              title: `Section ${sectionIndex}`,
              content: currentSectionContent.join(' '),
              timestamp: currentSectionStart,
            });
          }

          // Create and save the Note
          if (sections.length > 0) {
            const generatedNote: Note = {
              lecture_id: lecture.id,
              title: lecture.title,
              sections: sections,
              qa_records: [],
              generated_at: new Date().toISOString(),
            };

            try {
              await storageService.saveNote(generatedNote);
              setSelectedNote(generatedNote);
              console.log('[NotesView] Auto-generated notes with', sections.length, 'sections');
            } catch (noteError) {
              console.error('[NotesView] Failed to save auto-generated note:', noteError);
              // Still show the note in UI even if DB save failed (e.g., FK constraint)
              setSelectedNote(generatedNote);
            }
          } else {
            console.log('[NotesView] No sections generated, skipping note creation');
            setSelectedNote(null);
          }
        } else {
          setSelectedNote(note);
        }
        // ===== END AUTO-GENERATE NOTES =====
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
      if (!audioRecorderRef.current || !currentLectureData) return;

      transcriptionService.stop();
      // Stop recorder and get the WAV data
      // Get data BEFORE stopping to ensure we catch everything and buffers aren't cleared
      // (Though stop() logic should be safe, this is more robust)
      let wavBuffer: ArrayBuffer | null = null;
      try {
        wavBuffer = await audioRecorderRef.current.getWavData();
      } catch (err) {
        console.warn('Failed to get WAV data before stop:', err);
      }

      await audioRecorderRef.current.stop();

      // If wavBuffer failed, try again? OR rely on what we got.
      // If it failed, likely empty.

      setRecordingStatus("stopped");
      setVolume(0);

      if (!wavBuffer) {
        throw new Error('No audio data captured');
      }

      // Save Audio File
      let audioPath = currentLectureData.audio_path;
      try {
        console.log('[NotesView] Saving audio file...');
        const audioDir = await invoke<string>('get_audio_dir');
        const filename = `lecture_${currentLectureData.id}_${Date.now()}.wav`; // Saved as .wav (16Hz PCM) which is what AudioRecorder produces (mostly) 
        // Note: AudioRecorder produces WAV format in getWavData()

        // Ensure path separator
        const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';
        const fullPath = `${audioDir}${sep}${filename}`;

        await invoke('write_binary_file', {
          path: fullPath,
          data: Array.from(new Uint8Array(wavBuffer))
        });

        console.log('[NotesView] Audio saved to:', fullPath);
        audioPath = fullPath;
      } catch (e) {
        console.error('[NotesView] Failed to save audio file:', e);
        alert('Failed to save audio recording');
      }

      // Update lecture with audio path immediately for the UI to update
      const updatedLecture = {
        ...currentLectureData,
        audio_path: audioPath,
        status: 'completed' as const,
        updated_at: new Date().toISOString()
      };

      setCurrentLectureData(updatedLecture);
      await handleSaveLecture(updatedLecture);

    } catch (error) {
      console.error('Failed to stop recording:', error);
      setRecordingStatus("stopped"); // Ensure status is stopped even on error
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

  const handleSaveLecture = async (lectureOverride?: any) => {
    // Determine which lecture data to use (current state or override)
    // React Event objects might be passed as first arg if used in onClick
    let lectureToUse = currentLectureData;
    if (lectureOverride && typeof lectureOverride === 'object' && 'id' in lectureOverride) {
      lectureToUse = lectureOverride as Lecture;
    }

    if (!lectureToUse) return;

    try {
      setSaveStatus('saving');

      // ===== FIX: Ensure lecture exists in DB before FK-dependent operations =====
      // This prevents FOREIGN KEY constraint failures when saving notes/subtitles
      const existingLecture = await storageService.getLecture(lectureToUse.id);
      if (!existingLecture) {
        console.log('[NotesView] Lecture not in DB yet, saving first...');
        // Save the lecture first to establish FK reference
        await storageService.saveLecture(lectureToUse);
      }
      // ==========================================================================

      const segments = subtitleService.getSegments();
      const duration = recordingStartTime
        ? Math.floor((Date.now() - recordingStartTime) / 1000)
        : lectureToUse.duration;

      const updatedLecture: Lecture = {
        ...lectureToUse,
        duration,
        status: recordingStatus === "recording" ? "recording" : "completed",
        pdf_path: pdfPath || lectureToUse.pdf_path,
        updated_at: new Date().toISOString(),
      };

      await storageService.saveLecture(updatedLecture);

      if (segments.length > 0) {
        const now = new Date().toISOString();
        const subtitles = segments.map(seg => ({
          id: seg.id,
          lecture_id: updatedLecture.id,
          timestamp: seg.startTime / 1000,
          text_en: seg.displayText || seg.roughText || '',
          text_zh: seg.displayTranslation || seg.roughTranslation || undefined,
          type: (seg.source === 'fine' ? 'fine' : 'rough') as 'rough' | 'fine',
          confidence: undefined,
          created_at: now,
        }));
        await storageService.saveSubtitles(subtitles);

        // ===== AUTO-GENERATE NOTE FROM SUBTITLES =====
        // Group subtitles into sections (every 5 minutes or every 10 segments)
        const SECTION_DURATION_SEC = 300; // 5 minutes per section
        const sections: { title: string; content: string; timestamp: number }[] = [];

        let currentSectionStart = 0;
        let currentSectionContent: string[] = [];
        let sectionIndex = 1;

        for (const seg of segments) {
          const segTimestamp = seg.startTime / 1000;

          // Check if we need to start a new section
          if (segTimestamp - currentSectionStart >= SECTION_DURATION_SEC && currentSectionContent.length > 0) {
            // Save current section
            sections.push({
              title: `Section ${sectionIndex}`,
              content: currentSectionContent.join(' '),
              timestamp: currentSectionStart,
            });
            sectionIndex++;
            currentSectionStart = segTimestamp;
            currentSectionContent = [];
          }

          // Add text to current section (prefer Chinese if available)
          const text = seg.displayTranslation || seg.roughTranslation || seg.displayText || seg.roughText || '';
          if (text.trim()) {
            currentSectionContent.push(text.trim());
          }
        }

        // Save the last section
        if (currentSectionContent.length > 0) {
          sections.push({
            title: `Section ${sectionIndex}`,
            content: currentSectionContent.join(' '),
            timestamp: currentSectionStart,
          });
        }

        // Create and save the Note
        const note: Note = {
          lecture_id: updatedLecture.id,
          title: updatedLecture.title,
          sections: sections,
          qa_records: [], // Empty initially, can be populated later via AI Chat
          generated_at: now,
        };

        try {
          await storageService.saveNote(note);
          setSelectedNote(note);
          console.log('[NotesView] Note auto-generated with', sections.length, 'sections');
        } catch (noteError) {
          console.error('[NotesView] Failed to save auto-generated note:', noteError);
          // Still show the note in UI even if DB save failed
          setSelectedNote(note);
        }
        // ===== END AUTO-GENERATE NOTE =====
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

  const handleTextExtract = (text: string) => {
    // Save PDF text for AI Chat context
    if (text && text.trim().length > 0) {
      setPdfTextContent(text);
    }
    console.log('[NotesView] PDF text extracted for AI context.');

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

    if (onBack) {
      onBack();
    } else {
      // Fallback for direct routing usage (if any)
      const targetCourseId = courseId || currentLectureData?.course_id;
      navigate(targetCourseId ? `/course/${targetCourseId}` : '/');
    }
  };

  const handleGenerateSummary = async (language: 'zh' | 'en') => {
    if (!selectedNote || !currentLectureData) return;
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

      // Pre-flight: Sync metadata to server to ensure FK constraints
      try {
        const settings = await storageService.getAppSettings();
        // Default to localhost:3001 and 'default_user' if not configured to ensure Task works.
        const serverUrl = settings?.server?.url || 'http://localhost:3001';
        const username = settings?.sync?.username || 'default_user';

        console.log(`[NotesView] Syncing metadata to ${serverUrl} as ${username} before task...`);
        await syncService.pushData(serverUrl, username, { skipFiles: true });
      } catch (e) {
        console.warn('[NotesView] Pre-task sync failed, task might fail if lecture is missing on server:', e);
      }

      // Trigger generation on server
      const task = await taskService.triggerSummary(currentLectureData.id, language, content, pdfContext);

      if (!task) {
        alert("已離線，任務已加入佇列。");
        setIsGeneratingSummary(false);
        return;
      }

      console.log('[NotesView] Summary task started:', task.id);

      // Poll for result
      const completedTask = await taskService.pollUntilCompletion(task.id);

      if (completedTask.status === 'completed' && completedTask.result) {
        const summary = completedTask.result.summary;
        const updatedNote = { ...selectedNote, summary };
        await storageService.saveNote(updatedNote);
        setSelectedNote(updatedNote);
        alert('Summary generated successfully!');
      } else {
        throw new Error(completedTask.error || 'Task completed via unknown status');
      }

    } catch (error) {
      console.error('Failed to generate summary:', error);
      alert(`Failed to generate summary: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // ===== Note Editing Handlers =====
  const handleStartEditing = () => {
    if (!selectedNote) return;
    setEditedNote({ ...selectedNote });
    setIsEditingNote(true);
  };

  const handleCancelEditing = () => {
    setIsEditingNote(false);
    setEditedNote(null);
    setNoteSaveStatus('idle');
  };

  const handleSaveNote = async () => {
    if (!editedNote) return;
    setNoteSaveStatus('saving');
    try {
      await storageService.saveNote(editedNote);
      setSelectedNote(editedNote);
      setNoteSaveStatus('saved');
      setTimeout(() => setNoteSaveStatus('idle'), 1500);
    } catch (error) {
      console.error('[NotesView] Failed to save note:', error);
      setNoteSaveStatus('idle');
    }
  };

  const handleSaveAndExitEditing = async () => {
    await handleSaveNote();
    setIsEditingNote(false);
    setEditedNote(null);
  };

  const handleUpdateSummary = (newSummary: string) => {
    if (!editedNote) return;
    setEditedNote({ ...editedNote, summary: newSummary });
  };

  const handleUpdateSectionTitle = (index: number, newTitle: string) => {
    if (!editedNote) return;
    const newSections = [...editedNote.sections];
    newSections[index] = { ...newSections[index], title: newTitle };
    setEditedNote({ ...editedNote, sections: newSections });
  };

  const handleUpdateSectionContent = (index: number, newContent: string) => {
    if (!editedNote) return;
    const newSections = [...editedNote.sections];
    newSections[index] = { ...newSections[index], content: newContent };
    setEditedNote({ ...editedNote, sections: newSections });
  };
  // ===== End Note Editing Handlers =====

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
              const baseTime = currentLectureData?.created_at ? new Date(currentLectureData.created_at).getTime() / 1000 : section.timestamp;
              const relativeTime = Math.max(0, section.timestamp - baseTime);
              const minutes = Math.floor(relativeTime / 60);
              const seconds = Math.floor(relativeTime % 60);
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
              const baseTime = currentLectureData?.created_at ? new Date(currentLectureData.created_at).getTime() / 1000 : qa.timestamp;
              const relativeTime = Math.max(0, qa.timestamp - baseTime);
              const minutes = Math.floor(relativeTime / 60);
              const seconds = Math.floor(relativeTime % 60);
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

          {/* AI Chat Toggle Button */}
          <button
            onClick={() => setIsAIChatOpen(!isAIChatOpen)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isAIChatOpen
              ? 'bg-purple-500 text-white'
              : ollamaConnected
                ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            title={ollamaConnected ? 'AI 助教' : 'Ollama 未連線'}
          >
            <Bot size={18} />
            <span className="hidden sm:inline">AI 助教</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'recording' ? (
          // Recording Mode Layout (Split View with Resizable Panels)
          <div className="flex flex-col h-full">
            <PanelGroup direction="horizontal" className="flex-1">
              {/* Left Panel: PDF Viewer */}
              <Panel defaultSize={60} minSize={30}>
                <div className="flex flex-col h-full border-r border-gray-200 dark:border-gray-700">
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
                        onPageChange={setCurrentPage}
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
                      className="absolute bottom-20 right-1/2 translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-bounce z-50 hover:bg-blue-700 transition-colors"
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
              </Panel>

              <PanelResizeHandle className="w-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors cursor-col-resize z-50" />

              {/* Right Panel: Subtitles & Controls */}
              <Panel defaultSize={40} minSize={20}>
                <div className="flex flex-col h-full bg-white dark:bg-slate-800">
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
              </Panel>
            </PanelGroup>

            {/* Bottom Audio Player Bar (Optional position, currently integrating roughly where controls were but lets keep it separate if needed) 
                 Actually, the requirement was to put Audio Player broadly. 
                 For 'Recording Mode', we use the live controls above.
                 AudioPlayer is mostly for 'Review Mode' to play back recorded audio.
                 Let's stick to the plan: AudioPlayer helps in playback.
             */}
          </div>
        ) : (
          // Review Mode Layout (Split View with Audio Player)
          <div className="flex flex-col h-full overflow-hidden relative">
            <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
              {/* Left Panel: PDF Viewer (Ref Area) */}
              <Panel defaultSize={50} minSize={20} className="flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                {/* PDF Header? Maybe keep it simple */}
                <DragDropZone onFileDrop={handleFileDrop} className="flex-1 overflow-hidden">
                  {pdfPath || pdfData ? (
                    <PDFViewer
                      ref={pdfViewerRef}
                      filePath={pdfPath || undefined}
                      pdfData={pdfData || undefined}
                      onTextExtract={handleTextExtract}
                      onPageChange={setCurrentPage}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="text-center">
                        <BookOpen size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No PDF Reference</p>
                      </div>
                    </div>
                  )}
                </DragDropZone>
              </Panel>

              <PanelResizeHandle className="w-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors cursor-col-resize z-50" />

              {/* Right Panel: Note Editor & Subtitles */}
              <Panel defaultSize={50} minSize={30} className="flex flex-col bg-white dark:bg-gray-900">
                {/* Tab Switcher */}
                <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 px-4">
                  <button
                    onClick={() => setActiveTab('note')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'note' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                  >
                    Notes
                  </button>
                  <button
                    onClick={() => setActiveTab('subtitles')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'subtitles' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                  >
                    Subtitles & Audio
                  </button>
                </div>

                <div className="flex-1 overflow-hidden relative">
                  {activeTab === 'note' ? (
                    <div className="h-full overflow-auto p-6">
                      {selectedNote ? (
                        <div className="max-w-3xl mx-auto space-y-6 pb-20">
                          {/* Edit Controls */}
                          <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                              <FileText className="w-6 h-6 text-blue-500" />
                              Study Notes
                            </h2>
                            <div className="flex gap-2">
                              {isEditingNote ? (
                                <>
                                  <button onClick={handleSaveAndExitEditing} className="px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-1 text-sm"><Save size={14} /> Save</button>
                                  <button onClick={handleCancelEditing} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 text-sm">Cancel</button>
                                </>
                              ) : (
                                <button onClick={handleStartEditing} className="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1 text-sm"><Pencil size={14} /> Edit</button>
                              )}
                            </div>
                          </div>

                          {/* Summary */}
                          {(selectedNote.summary || isEditingNote) && (
                            <div className="p-5 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                              <h3 className="font-semibold text-indigo-800 dark:text-indigo-300 mb-3 uppercase text-xs tracking-wider">Summary</h3>
                              {isEditingNote ? (
                                <textarea
                                  value={editedNote?.summary || ''}
                                  onChange={e => handleUpdateSummary(e.target.value)}
                                  className="w-full h-40 p-3 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                                />
                              ) : (
                                <div className="prose prose-sm dark:prose-invert max-w-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{selectedNote.summary}</ReactMarkdown>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Sections */}
                          <div className="space-y-4">
                            {(isEditingNote ? editedNote?.sections : selectedNote.sections)?.map((section, idx) => (
                              <div key={idx} className="group relative pl-4 border-l-2 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-800 transition-colors">
                                {isEditingNote ? (
                                  <div className="space-y-2">
                                    <input
                                      value={section.title}
                                      onChange={e => handleUpdateSectionTitle(idx, e.target.value)}
                                      className="w-full font-bold bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-blue-500 outline-none py-1"
                                    />
                                    <textarea
                                      value={section.content}
                                      onChange={e => handleUpdateSectionContent(idx, e.target.value)}
                                      className="w-full h-24 bg-gray-50 dark:bg-gray-800 p-2 rounded border border-transparent focus:border-blue-500 outline-none text-sm"
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center justify-between mb-1">
                                      <h4 className="font-semibold text-gray-900 dark:text-gray-100">{section.title}</h4>
                                      {section.timestamp && (() => {
                                        const baseTime = currentLectureData?.created_at ? new Date(currentLectureData.created_at).getTime() / 1000 : section.timestamp;
                                        const relativeTime = Math.max(0, section.timestamp - baseTime);
                                        return (
                                          <button
                                            onClick={() => handleSeek(relativeTime)}
                                            className="text-xs text-blue-500 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                          >
                                            {Math.floor(relativeTime / 60)}:{Math.floor(relativeTime % 60).toString().padStart(2, '0')}
                                          </button>
                                        );
                                      })()}
                                    </div>
                                    <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{section.content}</p>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                          <p>No notes generated yet.</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Subtitles Tab
                    <div className="h-full flex flex-col">
                      <div className="flex-1 overflow-hidden">
                        <SubtitleDisplay
                          onSeek={handleSubtitleSeek}
                          currentTime={audioCurrentTime}
                          baseTime={currentLectureData?.created_at ? new Date(currentLectureData.created_at).getTime() : undefined}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>

            {/* Audio Player Bar */}
            {currentLectureData?.audio_path && (
              <AudioPlayer
                currentTime={audioCurrentTime}
                duration={audioDuration}
                isPlaying={isPlaying}
                volume={playbackVolume}
                onPlayPause={togglePlay}
                onSeek={handleSeek}
                onVolumeChange={setPlaybackVolume}
                onSkip={(sec) => handleSeek(audioCurrentTime + sec)}
              />
            )}

            {/* Hidden Audio Element */}
            <audio
              ref={audioRef}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
            />
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

      {/* AI Chat Panel */}
      {lectureId && (
        <AIChatPanel
          lectureId={lectureId}
          isOpen={isAIChatOpen}
          onClose={() => setIsAIChatOpen(false)}
          context={{
            pdfText: pdfTextContent,
            transcriptText: transcriptContent,
            pdfData: pdfData || undefined,
          }}
          ollamaConnected={ollamaConnected}
          currentPage={currentPage}
          onNavigateToPage={(page) => pdfViewerRef.current?.scrollToPage(page)}
        />
      )}
    </div >
  );
}
