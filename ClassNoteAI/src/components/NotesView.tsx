import { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Download, ArrowLeft, Pencil, Cpu, Loader2, FileText, Mic, MicOff, Pause, Square, Save, BookOpen, FolderOpen, Wand2, Bot, Film } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * ReactMarkdown + rehype-raw parses raw HTML inside markdown, which is
 * necessary because the app's own "[[頁碼:N]]" convention and some LLMs
 * use inline HTML for tables / details / sup / sub. BUT — the markdown
 * here comes from an LLM whose output we don't fully control, and
 * ReactMarkdown renders the result into the same DOM that holds
 * localStorage-backed chat history, OAuth access tokens, and the
 * Tauri invoke bridge. A stored-XSS payload like
 * `<img src=x onerror="invoke('reset_app_data')">` would be catastrophic.
 *
 * rehype-sanitize runs after rehype-raw and strips anything outside the
 * default schema (script/on* handlers/javascript: URIs/etc.) while
 * keeping all the formatting tags a normal study note needs. The
 * schema extension below re-allows the `<summary>` / `<details>` tags
 * some models use for collapsible sections.
 */
const markdownSanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
};
import { storageService } from "../services/storageService";
import { extractKeywords } from "../utils/pdfKeywordExtractor";
import { detectSectionBoundaries } from "../utils/topicSegmentation";
import { summarizeStream, usageTracker } from "../services/llm";
import { toastService } from "../services/toastService";
import { generateLocalEmbedding } from "../services/embeddingService";
import { embeddingStorageService } from "../services/embeddingStorageService";
import { openDetachedAiTutor } from "../services/aiTutorWindow";
import { videoImportService } from "../services/videoImportService";
import { subtitleImportService } from "../services/subtitleImportService";
import { selectVideoFile } from "../services/fileService";
import ImportModal, { PasteSubmission, VideoLanguage } from "./ImportModal";
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
import VideoPiP from "./VideoPiP";
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
  // v0.6.0 video import state
  const [isImportingVideo, setIsImportingVideo] = useState(false);
  const [importProgressMessage, setImportProgressMessage] = useState<string>('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [pdfTextContent, setPdfTextContent] = useState<string>('');
  const [transcriptContent, setTranscriptContent] = useState<string>('');
  // React-side mirror of autoAlignmentService.hasPageEmbeddings() so the
  // banner in the Auto-Follow row re-renders when alignment finishes.
  // The service is a plain singleton; calling its method inside JSX
  // doesn't subscribe React to its internal state, so without this
  // mirror the "PDF 索引尚未準備好" banner stays on screen forever
  // even after embeddings are populated.
  const [pageEmbeddingsReady, setPageEmbeddingsReady] = useState<boolean>(
    autoAlignmentService.hasPageEmbeddings()
  );
  // Bumped whenever the RAG index is rebuilt in the AI chat panel so
  // the Auto-Follow alignment useEffect re-runs and re-hydrates.
  const [alignmentRefreshTick, setAlignmentRefreshTick] = useState(0);
  // User-configurable AI 助教 chrome mode (Settings → 雲端 AI 助理).
  const [aiTutorMode, setAiTutorMode] = useState<'floating' | 'sidebar' | 'detached'>('floating');
  // v0.6.0 video+PDF layout. Loaded from settings (lectureLayout.videoPdfMode).
  const [videoPdfMode, setVideoPdfMode] = useState<'split' | 'pip'>('split');
  const [currentPage, setCurrentPage] = useState(1);
  // Pieces of the Whisper initial_prompt. Stored separately so
  // `handleTextExtract` (PDF side) and `loadLecture` (course side)
  // can each contribute without stomping on the other's contribution.
  // The combined prompt is assembled in `buildAndSetInitialPrompt`.
  const [courseContextPrompt, setCourseContextPrompt] = useState<string>('');
  const [courseAndLectureKeywords, setCourseAndLectureKeywords] = useState<string>('');
  const [pdfDerivedKeywords, setPdfDerivedKeywords] = useState<string>('');
  // Live progress surface for the map-reduce summariser. Empty string
  // means either idle or single-pass (in which case the old spinner is
  // enough). Populated during map phase as "第 3/5 段…".
  const [summaryProgress, setSummaryProgress] = useState<string>('');
  const [streamingSummary, setStreamingSummary] = useState<string>('');
  // v0.5.2 Auto Follow: during playback in Review mode, keep the PDF
  // viewer + subtitle list in sync with what was being said at the
  // current audio timestamp. Off = plain audio playback.
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  // Sorted (ascending by start time) timeline of page jumps. Built once
  // per playback session when autoFollow is on and pageEmbeddings have
  // loaded. Each entry is `{ t: seconds_into_lecture, page: 1-based }`.
  // Lookup is a binary search at each time-update so the sync is cheap.
  const [pageTimeline, setPageTimeline] = useState<{ t: number; page: number }[]>([]);
  const [isBuildingTimeline, setIsBuildingTimeline] = useState<boolean>(false);
  const [lastAutoFollowPage, setLastAutoFollowPage] = useState<number>(0);

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

        // Embedding Model: local Candle bge-small-en-v1.5 (shipped
        // via the embedding-model download flow in Settings). No remote
        // Ollama call — stale comment was fixed in v0.5.2.
        console.log('[NotesView] Using local Candle bge-small-en-v1.5 for auto-alignment');
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
  // v0.6.0: `audioRef` is now HTMLMediaElement so the same ref can
  // point at either the hidden <audio> (live-recorded lecture) or the
  // visible <video> (imported video lecture). All existing playback
  // helpers (togglePlay, handleSeek, handleTimeUpdate) work off
  // HTMLMediaElement members so the branch is purely render-side.
  const audioRef = useRef<HTMLMediaElement>(null);
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
      toastService.error('錄音錯誤', error.message);
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

  // Load the user's preferred AI 助教 chrome from settings. Default
  // floating matches v0.5.2 behavior for unupgraded users.
  useEffect(() => {
    (async () => {
      try {
        const settings = await storageService.getAppSettings();
        const mode = settings?.aiTutor?.displayMode ?? 'floating';
        setAiTutorMode(mode);
        const layout = settings?.lectureLayout?.videoPdfMode ?? 'split';
        setVideoPdfMode(layout);
      } catch { /* ignore */ }
    })();
  }, []);

  // Sidebar mode window resize is handled imperatively in the AI
  // 助教 button's onClick handler below rather than in a useEffect,
  // because React StrictMode + HMR re-fires effects and the
  // grow/shrink pair stops balancing (window drifts +400px per HMR).
  // Imperative "user clicked open -> grow once" / "user clicked close
  // -> shrink once" is symmetric by construction.

  // Initialize Auto Alignment. Prefer hydrating from the persisted RAG
  // chunk index (SQLite `embeddings` table) -- same embeddings are already
  // there, keyed by pageNumber. We just need to collapse chunks-per-page
  // down to one embedding-per-page by averaging. This gives us:
  //   - O(1 query) hydration vs. re-running pdfjs text extraction +
  //     30 × Candle embedding on every lecture re-open
  //   - "重建索引" button implicitly also refreshes Auto-Follow,
  //     because Auto-Follow now derives from the same SQLite rows
  //   - Auto-Follow works offline and across app restarts
  // Falls back to the old PDF-extraction path only if no RAG index
  // exists yet (user never clicked 重建索引).
  useEffect(() => {
    const initAlignment = async () => {
      if (!modelLoaded || !pdfData || !currentLectureData) return;
      try {
        // Stage 1: try to derive from the RAG index.
        const records = await embeddingStorageService.getEmbeddingsByLecture(
          currentLectureData.id
        );
        const pdfChunks = records.filter(
          (r) => r.sourceType === 'pdf' && typeof r.pageNumber === 'number'
        );
        if (pdfChunks.length > 0) {
          const byPage = new Map<number, { texts: string[]; sum: Float32Array; count: number }>();
          for (const c of pdfChunks) {
            const p = c.pageNumber as number;
            const existing = byPage.get(p);
            if (existing) {
              for (let i = 0; i < c.embedding.length; i++) existing.sum[i] += c.embedding[i];
              existing.texts.push(c.chunkText);
              existing.count += 1;
            } else {
              const sum = new Float32Array(c.embedding.length);
              for (let i = 0; i < c.embedding.length; i++) sum[i] = c.embedding[i];
              byPage.set(p, { texts: [c.chunkText], sum, count: 1 });
            }
          }
          const pageEmbeddings = Array.from(byPage.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([pageNumber, agg]) => {
              const avg = new Array<number>(agg.sum.length);
              for (let i = 0; i < agg.sum.length; i++) avg[i] = agg.sum[i] / agg.count;
              return { pageNumber, text: agg.texts.join('\n'), embedding: avg };
            });
          autoAlignmentService.setPageEmbeddings(pageEmbeddings);
          setPageEmbeddingsReady(pageEmbeddings.length > 0);
          console.log(
            `[NotesView] Hydrated ${pageEmbeddings.length} page embeddings from RAG index ` +
              `(${pdfChunks.length} PDF chunks averaged)`
          );
          return;
        }

        // Stage 2 fallback: no RAG index yet — compute from scratch.
        console.log('[NotesView] No RAG index; computing page embeddings from PDF directly...');
        const bufferCopy = pdfData.slice(0);
        const pages = await pdfService.extractAllPagesText(bufferCopy);
        const alignmentEmbeddings: Array<{ pageNumber: number; text: string; embedding: number[] }> = [];
        for (const p of pages) {
          if (!p.text?.trim()) continue;
          const embedding = await generateLocalEmbedding(p.text);
          alignmentEmbeddings.push({ pageNumber: p.page, text: p.text, embedding });
        }
        autoAlignmentService.setPageEmbeddings(alignmentEmbeddings);
        setPageEmbeddingsReady(alignmentEmbeddings.length > 0);
        console.log(`PDF alignment ready from PDF (${alignmentEmbeddings.length} pages)`);
      } catch (e) {
        console.error("Failed to init alignment", e);
      }
    };
    initAlignment();
  }, [pdfData, modelLoaded, currentLectureData?.id, alignmentRefreshTick]);

  // v0.5.2 Auto Follow — precompute a (timestamp, page) timeline.
  //
  // Runs when we're in Review mode, autoFollow is on, and both
  // subtitles + page embeddings are ready. For each subtitle segment,
  // we embed the text, ask autoAlignmentService which page best
  // matches, and record `{ t: startSec, page }`. The playback-side
  // effect below then binary-searches this sorted list at each time
  // update to scroll the PDF.
  //
  // Building once upfront (vs. per-tick similarity scoring) keeps the
  // playback path cheap. Typical cost: N embedding calls for N
  // subtitles. On a 90-min lecture with ~500 segments that's noticeable
  // (~30 s one-time), so we show a small spinner.
  useEffect(() => {
    // Off-path: clear the timeline AND the spinner state. Without the
    // explicit `setIsBuildingTimeline(false)` an in-flight build that
    // was cancelled mid-loop would leave the spinner stuck on "建立
    // 時間軸中..." until the next re-enable toggle.
    if (!autoFollow || viewMode !== 'review' || !autoAlignmentService.hasPageEmbeddings()) {
      setPageTimeline([]);
      setIsBuildingTimeline(false);
      return;
    }
    const segments = subtitleService.getSegments();
    if (segments.length === 0) {
      setIsBuildingTimeline(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsBuildingTimeline(true);
      try {
        const timeline: { t: number; page: number }[] = [];
        for (const seg of segments) {
          if (cancelled) return;
          const text = (seg.displayText || seg.roughText || seg.text || '').trim();
          if (!text) continue;
          try {
            const emb = await generateLocalEmbedding(text);
            const match = autoAlignmentService.findBestPage(emb);
            // Low-similarity matches are noise — skip so they don't
            // cause distracting "jump to page X for one second" flicker.
            if (match && match.similarity > 0.3) {
              timeline.push({ t: seg.startTime / 1000, page: match.page });
            }
          } catch {
            // Embedding failures are non-fatal; just drop that segment
            // from the timeline and keep going.
          }
        }
        // Deduplicate consecutive same-page entries — no point adding
        // a timeline marker at t=10s for "still on page 3" when t=5s
        // already said page 3.
        const deduped = timeline.filter((e, i, arr) => i === 0 || arr[i - 1].page !== e.page);
        if (!cancelled) setPageTimeline(deduped);
      } finally {
        if (!cancelled) setIsBuildingTimeline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoFollow, viewMode, pdfData, modelLoaded, currentLectureData?.id]);

  // Sync PDF to the current playback time when Auto Follow is on.
  // Debounced via "last page scrolled" so we don't thrash the PDF
  // viewer on every timeupdate (which fires ~4x/s).
  useEffect(() => {
    if (!autoFollow) return;
    if (viewMode !== 'review') return;
    if (!isPlaying) return;
    if (pageTimeline.length === 0) return;

    // Binary search for largest timeline entry with t <= currentTime.
    let lo = 0;
    let hi = pageTimeline.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pageTimeline[mid].t <= audioCurrentTime) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return;
    const targetPage = pageTimeline[best].page;
    if (targetPage === lastAutoFollowPage) return;
    setLastAutoFollowPage(targetPage);
    if (pdfViewerRef.current) {
      pdfViewerRef.current.scrollToPage(targetPage);
    }
  }, [audioCurrentTime, autoFollow, isPlaying, viewMode, pageTimeline, lastAutoFollowPage]);

  // Assemble the Whisper initial_prompt from three sources:
  //   1. Course context (topic from syllabus)
  //   2. Course-level + lecture-level keywords (from DB)
  //   3. PDF-derived keywords (extracted on text load)
  //
  // Whisper's initial_prompt caps at ~224 tokens and only applies to
  // the first 30 s of audio, so we keep the context tight — a dense
  // term list does more for ASR accuracy on technical English than a
  // verbose sentence would. This replaces the pre-v0.5.2 flow where
  // `extractKeywordsFromPDF` was commented out and only the course-
  // side context was used.
  useEffect(() => {
    const pieces: string[] = [];
    if (courseContextPrompt) pieces.push(courseContextPrompt);

    const kwList: string[] = [];
    if (courseAndLectureKeywords) kwList.push(courseAndLectureKeywords);
    if (pdfDerivedKeywords) kwList.push(pdfDerivedKeywords);
    if (kwList.length > 0) {
      // Rough budget: ~150 chars of keywords stays well under 224 tokens.
      const joined = kwList.join(', ').slice(0, 200);
      pieces.push(`Key terms include: ${joined}.`);
    }

    const combined = pieces.join(' ').trim();
    if (combined) {
      transcriptionService.setInitialPrompt(combined, kwList.join(', '));
    }
  }, [courseContextPrompt, courseAndLectureKeywords, pdfDerivedKeywords]);

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

        // Feed the two course-side pieces into state; a useEffect above
        // combines them with `pdfDerivedKeywords` and calls
        // `transcriptionService.setInitialPrompt`. Keeping the pieces
        // split means later PDF-text extraction can add its keywords
        // without clobbering the course context (v0.5.1 bug: PDF keyword
        // path was commented out because it overwrote the course prompt).
        setCourseContextPrompt(contextPrompt);
        setCourseAndLectureKeywords(
          [courseKeywords, lecture.keywords].filter(Boolean).join(', '),
        );

        // Load PDF if available
        if (lecture.pdf_path) {
          setPdfPath(lecture.pdf_path);

          // Loaf PDF data
          try {
            // ...
          } catch (e) { /* ... */ }
        } else {
          // v0.5.2 audit follow-up: attempt PDF recovery when DB column
          // is empty. `try_recover_pdf_path` looks for `lecture_<id>_*`
          // files in the lecture-pdfs dir (the filename convention
          // used for all newly-dropped PDFs since v0.5.2). If it finds
          // one, DB is relinked and we use the recovered path.
          try {
            const recoveredPdf = await invoke<string | null>('try_recover_pdf_path', { lectureId: lecture.id });
            if (recoveredPdf) {
              console.log('[NotesView] PDF path recovered:', recoveredPdf);
              lecture.pdf_path = recoveredPdf;
              setPdfPath(recoveredPdf);
              setCurrentLectureData({ ...lecture });
            }
          } catch (e) {
            console.warn('[NotesView] PDF recovery attempt failed (non-fatal):', e);
          }
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
        toastService.warning('請先到「設定 → 本地轉錄模型」下載 Whisper 模型');
        return;
      }

      // CRITICAL: Save lecture to DB BEFORE setting lectureId on transcription service
      // This ensures the lecture exists when auto-save tries to save subtitles
      const updatedLecture = { ...currentLectureData, status: 'recording' as const };
      await storageService.saveLecture(updatedLecture);
      setCurrentLectureData(updatedLecture);

      // Now it's safe to set lectureId and start transcription.
      transcriptionService.clear();
      transcriptionService.setLectureId(currentLectureData.id);

      // v0.5.1: wire the user's configured source/target languages and
      // pre-check whether the LLM fine-refinement queue should be active
      // for this session.
      try {
        const settings = await storageService.getAppSettings();
        const src = settings?.translation?.source_language || 'auto';
        const tgt = settings?.translation?.target_language || 'zh-TW';
        transcriptionService.setLanguages(src, tgt);
      } catch {
        transcriptionService.setLanguages('auto', 'zh-TW');
      }
      await transcriptionService.refreshFineRefinementAvailability();

      transcriptionService.start();

      // v0.5.2 crash-safe persistence: enable BEFORE start() so the first
      // audio chunk is already being captured to disk. If the app dies
      // after this point but before handleStopRecording, the .pcm file
      // is recoverable on next launch.
      audioRecorderRef.current.enablePersistence(currentLectureData.id);

      await audioRecorderRef.current.start();
      setRecordingStatus("recording");
      setRecordingStartTime(Date.now());
    } catch (error) {
      console.error('Failed to start recording:', error);
      toastService.error(
        '無法開始錄音',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleStopRecording = async () => {
    // v0.5.2 rewrite (audio-loss bug report):
    //
    // Prior version had a hard `throw` the moment `getWavData()` returned
    // empty — which bypassed the `.pcm` → .wav finalize path entirely.
    // An in-memory buffer being empty at Stop time (focus change, last
    // ScriptProcessor chunk hadn't fired, etc.) doesn't mean audio
    // doesn't exist: the 5-second .pcm flush runs throughout the session,
    // so the disk side could have 45 minutes of audio already. Skipping
    // finalize in that case left the .pcm orphaned in
    // `audio/in-progress/<lecture_id>.pcm`, invisible to
    // `try_recover_audio_path` (which only scans for
    // `lecture_<id>_*.wav`), and the lecture got saved with
    // `audio_path = null`. User-visible symptom: AudioPlayer shows
    // 00:00 / 00:00 in Review mode.
    //
    // New order of operations:
    //   1. Snapshot the in-memory WAV (no throw — null is fine).
    //   2. Stop the recorder.
    //   3. ALWAYS attempt finalize (.pcm → .wav). If persistence was
    //      enabled, this is the lossless path covering the full session.
    //   4. If finalize didn't produce a path, fall back to the in-memory
    //      WAV (covers users upgrading from v0.5.1 where persistence is
    //      disabled mid-session).
    //   5. Whatever we end up with, persist the lecture row to the DB.
    //      Status flips to 'completed' regardless so the row doesn't
    //      stay stuck at 'recording' — that triggers the orphan-recovery
    //      modal on next launch and becomes a loop.
    //   6. If BOTH paths produced nothing, toast a specific error with
    //      the underlying reason (file-not-found vs permission vs ...).
    try {
      if (!audioRecorderRef.current || !currentLectureData) return;

      transcriptionService.stop();

      // Step 1: snapshot in-memory WAV. Empty is NOT fatal.
      let wavBuffer: ArrayBuffer | null = null;
      try {
        wavBuffer = await audioRecorderRef.current.getWavData();
      } catch {
        // Silently accept — .pcm on disk may still have the real audio.
        // Worst case: steps 3 and 4 both fail, step 6 reports that.
      }

      await audioRecorderRef.current.stop();
      setRecordingStatus("stopped");
      setVolume(0);

      const audioDir = await invoke<string>('get_audio_dir');
      const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';
      const fullPath = `${audioDir}${sep}lecture_${currentLectureData.id}_${Date.now()}.wav`;

      let audioPath: string | undefined;
      let saveErrorDetail: string | null = null;

      // Step 3: finalize persisted .pcm → .wav (preferred — full session).
      try {
        const finalizedPath = await audioRecorderRef.current.finalizeToDisk(fullPath);
        if (finalizedPath) {
          audioPath = finalizedPath;
          console.log('[NotesView] Audio finalized from on-disk PCM:', audioPath);
        }
      } catch (finalizeErr) {
        saveErrorDetail = finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr);
        console.warn('[NotesView] finalize_recording failed, will try in-memory fallback:', saveErrorDetail);
      }

      // Step 4: fallback to in-memory WAV if finalize couldn't help.
      if (!audioPath && wavBuffer) {
        try {
          await invoke('write_binary_file', {
            path: fullPath,
            data: Array.from(new Uint8Array(wavBuffer))
          });
          audioPath = fullPath;
          saveErrorDetail = null;
          console.log('[NotesView] Audio saved via in-memory WAV fallback:', audioPath);
        } catch (fallbackErr) {
          saveErrorDetail = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          console.error('[NotesView] In-memory WAV fallback also failed:', saveErrorDetail);
        }
      }

      // Step 5: persist the lecture row — even on save failure. Flipping
      // status to 'completed' prevents the orphan-recovery modal from
      // showing for this lecture on every subsequent launch. Preserve
      // an existing audio_path if both save paths failed (better to
      // keep a stale reference than nuke it to null).
      const updatedLecture = {
        ...currentLectureData,
        audio_path: audioPath ?? currentLectureData.audio_path,
        status: 'completed' as const,
        updated_at: new Date().toISOString()
      };
      setCurrentLectureData(updatedLecture);
      await handleSaveLecture(updatedLecture);

      // Step 6: surface save-path failure AFTER the DB row is consistent.
      if (!audioPath) {
        toastService.error(
          '錄音儲存失敗',
          saveErrorDetail ?? '沒有可用的音訊資料（麥克風可能沒捕捉到任何聲音）',
        );
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      toastService.error(
        '停止錄音時出錯',
        error instanceof Error ? error.message : String(error),
      );
      setRecordingStatus("stopped");
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

  // v0.6.0: pick a video, copy it into app data, transcribe it,
  // translate, save subtitles, index for RAG. User can leave the
  // window; when they come back, Notes Review mode shows the video
  // with subtitles + AI 助教 fully indexed.
  const runVideoImport = async (sourcePath: string, language: VideoLanguage = 'auto') => {
    if (!lectureId || isImportingVideo) return;
    setIsImportingVideo(true);
    setImportProgressMessage('開始匯入…');
    try {
      const result = await videoImportService.importVideo(lectureId, sourcePath, {
        language,
        onProgress: (p) => setImportProgressMessage(p.message),
      });
      const fresh = await storageService.getLecture(lectureId);
      if (fresh) setCurrentLectureData(fresh);
      toastService.success(
        '影片匯入完成',
        `共 ${result.segmentCount} 段字幕，可到 Notes Review 看播放。`,
      );
      setIsImportModalOpen(false);
    } catch (err) {
      toastService.error('影片匯入失敗', err instanceof Error ? err.message : String(err));
    } finally {
      setIsImportingVideo(false);
      setImportProgressMessage('');
    }
  };

  const handlePickAndImportVideo = async (language: VideoLanguage) => {
    const sourcePath = await selectVideoFile();
    if (!sourcePath) return;
    await runVideoImport(sourcePath, language);
  };

  const handleImportPastedSubtitles = async (submission: PasteSubmission) => {
    if (!lectureId || isImportingVideo) return;
    setIsImportingVideo(true);
    setImportProgressMessage('解析字幕…');
    try {
      const result = await subtitleImportService.importPasted(
        lectureId,
        submission.rawText,
        {
          language: submission.language,
          translateToChinese: submission.translateToChinese,
          onProgress: (p) => setImportProgressMessage(p.message),
        },
      );
      const fresh = await storageService.getLecture(lectureId);
      if (fresh) setCurrentLectureData(fresh);
      toastService.success(
        '字幕匯入完成',
        `共 ${result.segmentCount} 段字幕，AI 助教可立即查閱。`,
      );
      setIsImportModalOpen(false);
    } catch (err) {
      toastService.error('字幕匯入失敗', err instanceof Error ? err.message : String(err));
    } finally {
      setIsImportingVideo(false);
      setImportProgressMessage('');
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
        // v0.5.2: topic-based section boundaries via embedding-similarity
        // dips (see utils/topicSegmentation). When embeddings aren't
        // available (no Candle model yet, or too few segments) it falls
        // back to fixed 5-minute splits — matching pre-v0.5.2 behaviour.
        //
        // We opportunistically reuse the page-timeline embeddings that
        // Auto Follow built, if the user had that feature active.
        // Otherwise we DON'T block on embedding here — note auto-gen
        // needs to be fast on Stop; uniform 5-min fallback is fine and
        // the user can re-generate later with map-reduce summary.
        const segInputs = segments.map((seg) => ({
          id: seg.id,
          startTime: seg.startTime,
          text:
            seg.displayText ||
            seg.roughText ||
            seg.displayTranslation ||
            seg.roughTranslation ||
            '',
        }));
        // pageTimeline from Auto Follow stores {t, page}; we'd need
        // segment-aligned embeddings to reuse it directly. For MVP,
        // just pass `null` — dim-check fallback kicks in, uniform
        // 5-min split. A follow-up can wire the Auto-Follow embeddings
        // through if we ever observe uniform-split being a pain point.
        const boundaries = detectSectionBoundaries(segInputs, null);

        const sections: { title: string; content: string; timestamp: number }[] =
          boundaries.map((b, i) => {
            const startIdx = b.startIdx;
            const endIdxExclusive =
              i + 1 < boundaries.length ? boundaries[i + 1].startIdx : segments.length;
            const content = segments
              .slice(startIdx, endIdxExclusive)
              .map(
                (s) =>
                  s.displayTranslation ||
                  s.roughTranslation ||
                  s.displayText ||
                  s.roughText ||
                  '',
              )
              .map((t) => t.trim())
              .filter(Boolean)
              .join(' ');
            return {
              title: `Section ${i + 1}`,
              content,
              timestamp: b.timestamp,
            };
          });

        // Create and save the Note
        const note: Note = {
          lecture_id: updatedLecture.id,
          title: updatedLecture.title,
          sections: sections,
          qa_records: [], // Empty initially, can be populated later via AI Chat
          generated_at: now,
        };

        // v0.5.2 audit follow-up: never show the user an in-UI note that
        // isn't actually in the DB. The old path did
        // `setSelectedNote(note)` in the catch block too, which meant
        // the user could edit a "note" they saw, close the app, and
        // the edits would vanish silently on reload. Now: if the save
        // fails, we retry once (network blip / lock contention), and
        // on second failure we toast an explicit error AND leave
        // `selectedNote` at its prior value (which may be null —
        // fine, the summary generator still works manually).
        let noteSaved = false;
        let lastSaveErr: unknown = null;
        for (let attempt = 0; attempt < 2 && !noteSaved; attempt++) {
          try {
            await storageService.saveNote(note);
            noteSaved = true;
          } catch (noteError) {
            lastSaveErr = noteError;
            console.warn(`[NotesView] Note save attempt ${attempt + 1} failed:`, noteError);
            if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
          }
        }
        if (noteSaved) {
          setSelectedNote(note);
          console.log('[NotesView] Note auto-generated with', sections.length, 'sections');
        } else {
          console.error('[NotesView] Auto-generated note save failed after retry:', lastSaveErr);
          toastService.error(
            '自動筆記儲存失敗',
            '錄音和字幕已保存；重新打開此課堂時系統會再次嘗試產生筆記。' +
              (lastSaveErr instanceof Error ? ` (${lastSaveErr.message})` : ''),
          );
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

  // v0.6.0 drag-drop now rides on Tauri's native `onDragDropEvent`,
  // which hands us real filesystem paths instead of HTML5 `File`
  // objects. That means we can route by extension and avoid the old
  // `File.arrayBuffer()` + `write_temp_file` round-trip — critical for
  // video files where that path would JSON-encode hundreds of MB.
  const handleFileDrop = async (paths: string[]) => {
    if (paths.length === 0) return;
    const path = paths[0];
    const lower = path.toLowerCase();

    const isVideo = /\.(mp4|m4v|mkv|webm|mov|avi)$/.test(lower);
    const isPdf = lower.endsWith('.pdf');
    const isConvertible =
      lower.endsWith('.ppt') ||
      lower.endsWith('.pptx') ||
      lower.endsWith('.doc') ||
      lower.endsWith('.docx');

    if (isVideo) {
      // Dragging a video onto the lecture area uses auto-detect by
      // default — the user hasn't been through the modal where they
      // could pick a language. If detection fails they can retry via
      // the 匯入 button and pick explicitly.
      await runVideoImport(path, 'auto');
      return;
    }

    if (isConvertible) {
      await convertAndLoadDocument(path);
      return;
    }

    if (!isPdf) {
      toastService.warning('請拖入影片、PDF、PPT 或 Word 檔案');
      return;
    }

    // Load PDF directly from its on-disk path — no temp copy needed.
    try {
      const pdfBytes = await invoke<number[]>('read_binary_file', { path });
      const arrayBuffer = new Uint8Array(pdfBytes).buffer;
      setPdfData(arrayBuffer);
      setPdfPath(path);
      try {
        await updateLecturePDF(path);
      } catch (dbErr) {
        console.error('[NotesView] PDF path loaded but DB save failed:', dbErr);
        toastService.error(
          'PDF 資料庫更新失敗',
          '下次開啟此課堂時系統會自動重新連結。' +
            (dbErr instanceof Error ? ` (${dbErr.message})` : ''),
        );
      }
    } catch (err) {
      console.error('[NotesView] Failed to read dropped PDF:', err);
      toastService.error('PDF 讀取失敗', err instanceof Error ? err.message : String(err));
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
      toastService.error('文件轉換失敗', String(error));
    } finally {
      setIsConverting(false);
    }
  };

  const handleTextExtract = (text: string) => {
    // Save PDF text for AI Chat / RAG context.
    if (text && text.trim().length > 0) {
      setPdfTextContent(text);

      // v0.5.2: derive Whisper-friendly keywords from the slides. These
      // feed the `initial_prompt` via the useEffect upstream — giving
      // whisper.cpp a 224-token hint with the lecture's technical
      // vocabulary significantly improves recognition of domain terms
      // (e.g. "heuristic evaluation", "affinity diagram") that the
      // base model otherwise slurs into phonetic neighbours.
      try {
        const kws = extractKeywords(text);
        if (kws.length > 0) {
          setPdfDerivedKeywords(kws.join(', '));
          console.log(
            `[NotesView] Extracted ${kws.length} keywords from PDF for Whisper prompt.`,
          );
        }
      } catch (e) {
        console.warn('[NotesView] PDF keyword extraction failed:', e);
      }
    }
    console.log('[NotesView] PDF text extracted for AI context.');
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

      // Generate summary via the map-reduce streaming path. For short
      // transcripts this degrades to a direct streaming call; for long
      // ones (>12k chars) the provider is asked to summarise each
      // section independently, then stitch, so we don't choke on a
      // 90-minute transcript in one prompt. Progress events go to
      // `summaryProgress` / `streamingSummary` so the UI shows live
      // output instead of freezing for 30-60 s.
      setSummaryProgress('準備摘要…');
      setStreamingSummary('');
      let summary = '';
      try {
        for await (const event of summarizeStream({
          content,
          language,
          pdfContext,
          title: selectedNote.title,
        })) {
          if (event.phase === 'map-start') {
            setSummaryProgress(`段落分割完成（${event.sectionCount} 段），並行摘要中…`);
          } else if (event.phase === 'map-section-done') {
            setSummaryProgress(`段落摘要 ${event.sectionIndex}/${event.sectionCount}…`);
          } else if (event.phase === 'reduce-start') {
            setSummaryProgress('正在整合段落為完整筆記…');
          } else if (event.phase === 'reduce-delta' && event.delta) {
            summary += event.delta;
            setStreamingSummary(summary);
          } else if (event.phase === 'done') {
            summary = event.fullText ?? summary;
          }
        }
      } finally {
        setSummaryProgress('');
      }

      const updatedNote = { ...selectedNote, summary };
      await storageService.saveNote(updatedNote);
      setSelectedNote(updatedNote);
      setStreamingSummary('');
      const usage = usageTracker.latest('summarize');
      // Non-blocking toast instead of a modal alert() — summary
      // completion is informational, not a decision point, so there's
      // no reason to freeze the UI until the user clicks OK.
      toastService.success(
        '摘要已生成',
        usage
          ? `in ${usage.inputTokens} · out ${usage.outputTokens} tokens`
          : undefined,
      );

    } catch (error) {
      console.error('Failed to generate summary:', error);
      toastService.error(
        '生成摘要失敗',
        error instanceof Error ? error.message : String(error),
      );
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
      toastService.error('無法導出', '數據不完整');
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
        toastService.info('PDF 導出功能尚未實現');
      }
    } catch (error) {
      console.error('導出失敗:', error);
      toastService.error(
        '導出失敗',
        error instanceof Error ? error.message : String(error),
      );
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

          {/* v0.6.0: Import Video button — runs the imported-video
              pipeline (ffmpeg → Whisper → subtitles → RAG index)
              and ends with the lecture ready to review in Notes
              Review mode. Shown only in recording mode, alongside
              Save. */}
          {viewMode === 'recording' && lectureId && (
            <button
              onClick={() => setIsImportModalOpen(true)}
              disabled={isImportingVideo}
              className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors disabled:opacity-50"
              title="匯入已錄製的影片或課程字幕"
            >
              {isImportingVideo ? <Loader2 size={18} className="animate-spin" /> : <Film size={18} />}
              <span className="hidden sm:inline">
                {isImportingVideo ? (importProgressMessage || '處理中…') : '匯入'}
              </span>
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
            onClick={async () => {
              const settings = await storageService.getAppSettings().catch(() => null);
              const freshMode = settings?.aiTutor?.displayMode ?? 'floating';
              setAiTutorMode(freshMode);
              if (freshMode === 'detached') {
                const theme = settings?.theme === 'dark' ? 'dark' : 'light';
                if (lectureId) await openDetachedAiTutor(lectureId, theme);
                return;
              }
              // sidebar and floating: just toggle in-app state. Sidebar
              // mode uses inline-push (content shrinks via PanelGroup)
              // rather than window resize, which matches VSCode /
              // Notion / Cursor and avoids the "window too wide to
              // read" problem from the earlier expand-window approach.
              setIsAIChatOpen(!isAIChatOpen);
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              (aiTutorMode !== 'detached' && isAIChatOpen)
              ? 'bg-purple-500 text-white'
              : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100'
              }`}
            title="AI 助教"
          >
            <Bot size={18} />
            <span className="hidden sm:inline">AI 助教</span>
          </button>
        </div>
      </div>

      {/* Content — main area + optional right sidebar in a resizable
          PanelGroup. `autoSaveId` persists the user's preferred ratio
          to localStorage so their chosen sidebar width sticks across
          sessions (Cursor / VSCode / Notion behavior). Nested
          PanelGroups are fine: the inner one splits PDF vs Notes
          inside the main Panel, the outer one splits main vs sidebar.
          Floating mode renders the panel elsewhere (fixed overlay)
          and detached lives in its own OS window. */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup
          direction="horizontal"
          autoSaveId="classnote-notesview-sidebar"
          className="h-full"
        >
          <Panel
            id="notesview-main"
            order={0}
            defaultSize={75}
            minSize={40}
            className="overflow-hidden"
          >
            <div className="h-full overflow-hidden">
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
                        {pdfPath ? (pdfPath.startsWith('blob:') ? 'Dropped File' : pdfPath.split('?')[0].split('#')[0].split(/[/\\]/).pop()) : 'Selected PDF'}
                      </span>
                      <button onClick={handleSelectPDF} className="px-3 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                        Change
                      </button>
                    </div>
                  )}
                  <DragDropZone onFileDrop={handleFileDrop} enabled={!isImportModalOpen} className="flex-1 overflow-hidden">
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
              {/* Left Panel: Reference Area. v0.6.0 — content depends
                  on which artifacts this lecture has:
                    - video only: full-panel <video>
                    - PDF only: full-panel PDFViewer (historical default)
                    - both + split: vertical resizable split (video top / PDF bottom)
                    - both + pip:   PDF fills, video floats as an overlay
                  Layout choice comes from settings.lectureLayout.videoPdfMode. */}
              <Panel defaultSize={50} minSize={20} className="flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <DragDropZone onFileDrop={handleFileDrop} enabled={!isImportModalOpen} className="flex-1 overflow-hidden">
                  {(() => {
                    const hasVideo = !!currentLectureData?.video_path;
                    const hasPdf = !!(pdfPath || pdfData);
                    const pdfPane = hasPdf ? (
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
                    );
                    const videoEl = hasVideo ? (
                      <video
                        ref={audioRef as React.RefObject<HTMLVideoElement>}
                        src={convertFileSrc(currentLectureData!.video_path!)}
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onEnded={() => setIsPlaying(false)}
                        controls
                        className="w-full h-full bg-black object-contain"
                      />
                    ) : null;

                    if (hasVideo && hasPdf && videoPdfMode === 'split') {
                      return (
                        <PanelGroup direction="vertical" autoSaveId="notesview-left-split">
                          <Panel defaultSize={40} minSize={20}>
                            <div className="w-full h-full bg-black">{videoEl}</div>
                          </Panel>
                          <PanelResizeHandle className="h-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors cursor-row-resize" />
                          <Panel defaultSize={60} minSize={20}>
                            {pdfPane}
                          </Panel>
                        </PanelGroup>
                      );
                    }
                    if (hasVideo && hasPdf && videoPdfMode === 'pip') {
                      return (
                        <div className="relative w-full h-full">
                          {pdfPane}
                          <VideoPiP
                            ref={audioRef as React.RefObject<HTMLVideoElement>}
                            src={convertFileSrc(currentLectureData!.video_path!)}
                            onTimeUpdate={handleTimeUpdate}
                            onLoadedMetadata={handleLoadedMetadata}
                            onEnded={() => setIsPlaying(false)}
                          />
                        </div>
                      );
                    }
                    if (hasVideo) {
                      return <div className="w-full h-full bg-black">{videoEl}</div>;
                    }
                    return pdfPane;
                  })()}
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

                          {/* Live progress from the map-reduce summariser (v0.5.2).
                              Renders only while generation is in flight; shows
                              the phase indicator + streamed partial markdown
                              instead of a frozen spinner. */}
                          {isGeneratingSummary && (summaryProgress || streamingSummary) && (
                            <div className="p-5 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-900/30">
                              <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-2 uppercase text-xs tracking-wider flex items-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                正在生成摘要
                              </h3>
                              {summaryProgress && (
                                <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">{summaryProgress}</p>
                              )}
                              {streamingSummary && (
                                <div className="prose prose-sm dark:prose-invert max-w-none opacity-90">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>{streamingSummary}</ReactMarkdown>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Summary */}
                          {(selectedNote.summary || isEditingNote) && !isGeneratingSummary && (
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
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>{selectedNote.summary}</ReactMarkdown>
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
              <div>
                {/* Auto Follow toggle — only shown in Review mode. On
                    enables PDF + subtitle sync to current playback
                    timestamp; off is plain audio playback. */}
                {viewMode === 'review' && (
                  <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoFollow}
                        onChange={(e) => setAutoFollow(e.target.checked)}
                        className="accent-blue-500 w-4 h-4"
                      />
                      <span className="text-gray-700 dark:text-gray-300 font-medium">
                        Auto Follow
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        播放時自動翻到對應 PDF 頁面與字幕
                      </span>
                    </label>
                    {autoFollow && isBuildingTimeline && (
                      <span className="text-xs text-blue-500 dark:text-blue-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        建立時間軸中...
                      </span>
                    )}
                    {autoFollow && !isBuildingTimeline && pageTimeline.length > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {pageTimeline.length} 個頁面切換點
                      </span>
                    )}
                    {autoFollow && !isBuildingTimeline && pageTimeline.length === 0 && !pageEmbeddingsReady && (
                      <span className="text-xs text-amber-500">
                        PDF 索引尚未準備好
                      </span>
                    )}
                  </div>
                )}
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
              </div>
            )}

            {/* Audio-only lectures keep the hidden <audio> ref here;
                video lectures render the <video> on the left panel
                (see the Review Mode left panel block above). The ref
                target switches based on `currentLectureData.video_path`
                — all playback wiring (togglePlay / handleSeek /
                subtitle sync) is media-type agnostic. */}
            {!currentLectureData?.video_path && (
              <audio
                ref={audioRef as React.RefObject<HTMLAudioElement>}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              />
            )}
          </div>
        )}
            </div>
          </Panel>
          {/* Sidebar Panel — only rendered in sidebar mode + open.
              react-resizable-panels tracks conditional panels by
              stable `id`; size persists via outer PanelGroup's
              autoSaveId. minSize 18% keeps it readable on small
              windows; maxSize 45% prevents it from crushing the PDF. */}
          {lectureId && aiTutorMode === 'sidebar' && isAIChatOpen && (
            <>
              <PanelResizeHandle className="w-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors cursor-col-resize" />
              <Panel
                id="notesview-sidebar"
                order={1}
                defaultSize={25}
                minSize={18}
                maxSize={45}
                className="shadow-xl"
              >
                <AIChatPanel
                  lectureId={lectureId}
                  isOpen
                  onClose={() => setIsAIChatOpen(false)}
                  context={{
                    pdfText: pdfTextContent,
                    transcriptText: transcriptContent,
                    pdfData: pdfData || undefined,
                  }}
                  currentPage={currentPage}
                  onNavigateToPage={(page) => pdfViewerRef.current?.scrollToPage(page)}
                  onIndexRebuilt={() => setAlignmentRefreshTick((t) => t + 1)}
                  displayMode="sidebar"
                />
              </Panel>
            </>
          )}
        </PanelGroup>
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
            entity="lecture"
          />
        )
      }

      {/* AI Chat Panel — floating mode only. Sidebar mode is rendered
          inline as a flex-row sibling inside the Content area above so
          it allocates the window's extra width cleanly instead of
          overlaying. Detached mode lives in its own OS window. */}
      {lectureId && aiTutorMode === 'floating' && (
        <AIChatPanel
          lectureId={lectureId}
          isOpen={isAIChatOpen}
          onClose={() => setIsAIChatOpen(false)}
          context={{
            pdfText: pdfTextContent,
            transcriptText: transcriptContent,
            pdfData: pdfData || undefined,
          }}
          currentPage={currentPage}
          onNavigateToPage={(page) => pdfViewerRef.current?.scrollToPage(page)}
          onIndexRebuilt={() => setAlignmentRefreshTick((t) => t + 1)}
          displayMode="floating"
        />
      )}

      <ImportModal
        open={isImportModalOpen}
        isBusy={isImportingVideo}
        progressMessage={importProgressMessage}
        onClose={() => setIsImportModalOpen(false)}
        onPickVideo={handlePickAndImportVideo}
        onDropVideo={(path, language) => runVideoImport(path, language)}
        onSubmitPaste={handleImportPastedSubtitles}
      />
    </div >
  );
}
